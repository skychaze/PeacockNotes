import { BackupOperationCoordinator } from './coordinator';
import type {
  BackupOperation,
  BackupOperationHandler,
  BackupOperationKind,
  BackupOperationStore,
  NewBackupOperation,
  OperationPatch,
} from './types';

const assert = (condition: boolean, message: string) => {
  if (!condition) throw new Error(message);
};

class MemoryStore implements BackupOperationStore {
  readonly rows = new Map<string, BackupOperation>();

  async create(input: NewBackupOperation, now: string) {
    if ([...this.rows.values()].some((row) => row.state === 'pending' || row.state === 'running')) {
      throw new Error('active operation exists');
    }
    const row: BackupOperation = {
      ...input, state: 'pending', checkpoint: null, activeStep: null, activeStepKey: null,
      attempt: 0, cancelRequested: false, errorCode: null, errorMessage: null,
      createdAt: now, updatedAt: now, finishedAt: null, version: 0,
    };
    this.rows.set(row.id, row);
    return row;
  }

  async get(id: string) { return this.rows.get(id) ?? null; }

  async getActive() {
    return [...this.rows.values()].find((row) => row.state === 'pending' || row.state === 'running') ?? null;
  }

  async update(id: string, version: number, patch: OperationPatch, now: string) {
    const row = this.rows.get(id);
    if (!row || row.version !== version) return null;
    const updated: BackupOperation = { ...row, ...patch, updatedAt: now, version: version + 1 };
    this.rows.set(id, updated);
    return updated;
  }
}

const handlers = (handler: BackupOperationHandler) => ({
  export: handler,
  import: handler,
  managed_retention: handler,
  automatic_backup: handler,
}) satisfies Readonly<Record<BackupOperationKind, BackupOperationHandler>>;

export async function testSerializedOperations() {
  const store = new MemoryStore();
  let active = 0;
  let maximum = 0;
  const handler: BackupOperationHandler = {
    async nextStep(operation) { return operation.checkpoint ? null : { name: 'mutate' }; },
    async runStep() {
      active += 1;
      maximum = Math.max(maximum, active);
      await Promise.resolve();
      active -= 1;
      return { outcome: 'committed', checkpoint: 'done', done: true };
    },
    async recoverInterruptedStep() { return { outcome: 'not_committed' }; },
  };
  const coordinator = new BackupOperationCoordinator(store, handlers(handler));
  await Promise.all([coordinator.start('one', 'export', '{}'), coordinator.start('two', 'import', '{}')]);
  assert(maximum === 1, 'mutating operations overlapped');
}

export async function testRetriesReuseIdempotencyKey() {
  const store = new MemoryStore();
  const keys: string[] = [];
  const handler: BackupOperationHandler = {
    async nextStep(operation) { return operation.checkpoint ? null : { name: 'publish' }; },
    async runStep(context) {
      keys.push(context.idempotencyKey);
      return keys.length === 1
        ? { outcome: 'retry', code: 'offline', message: 'try later' }
        : { outcome: 'committed', checkpoint: 'published', done: true };
    },
    async recoverInterruptedStep() { return { outcome: 'not_committed' }; },
  };
  const result = await new BackupOperationCoordinator(store, handlers(handler)).start('retry', 'export', '{}');
  assert(result.state === 'succeeded', 'retry did not succeed');
  assert(keys.length === 2 && keys[0] === keys[1], 'retry changed its idempotency key');
}

export async function testExplicitRetryReusesIdempotencyKey() {
  const store = new MemoryStore();
  const keys: string[] = [];
  let shouldFail = true;
  const handler: BackupOperationHandler = {
    async nextStep(operation) { return operation.checkpoint ? null : { name: 'import_all' }; },
    async runStep(context) {
      keys.push(context.idempotencyKey);
      if (shouldFail) return { outcome: 'failed', code: 'interrupted', message: 'not committed' };
      return { outcome: 'committed', checkpoint: 'imported', done: true };
    },
    async recoverInterruptedStep() { return { outcome: 'not_committed' }; },
  };
  const coordinator = new BackupOperationCoordinator(store, handlers(handler));
  const failed = await coordinator.start('additive', 'import', '{}');
  assert(failed.state === 'failed', 'initial import did not fail');
  shouldFail = false;
  const retried = await coordinator.retry('additive');
  assert(retried.state === 'succeeded', 'explicit retry did not succeed');
  assert(keys.length === 2 && keys[0] === keys[1], 'explicit retry changed the import receipt key');
}

export async function testCancellationWaitsForBoundary() {
  const store = new MemoryStore();
  let release: () => void = () => {};
  const boundary = new Promise<void>((resolve) => { release = resolve; });
  const handler: BackupOperationHandler = {
    async nextStep(operation) { return operation.checkpoint ? { name: 'second' } : { name: 'first' }; },
    async runStep(context) {
      if (context.step.name === 'first') await boundary;
      return { outcome: 'committed', checkpoint: context.step.name };
    },
    async recoverInterruptedStep() { return { outcome: 'not_committed' }; },
  };
  const coordinator = new BackupOperationCoordinator(store, handlers(handler));
  const running = coordinator.start('cancel', 'import', '{}');
  await Promise.resolve();
  await Promise.resolve();
  await coordinator.requestCancellation('cancel');
  release();
  const result = await running;
  assert(result.state === 'cancelled', 'cancellation was not applied at the boundary');
  assert(result.checkpoint === 'first', 'committed work was lost during cancellation');
}

export async function testRestartRecoversWithoutRepeatingStep() {
  const store = new MemoryStore();
  const created = await store.create({ id: 'restart', kind: 'automatic_backup', payload: '{}' }, 'now');
  await store.update(created.id, created.version, {
    state: 'running', activeStep: 'publish', activeStepKey: 'stable-key', attempt: 1,
  }, 'later');
  let executions = 0;
  const handler: BackupOperationHandler = {
    async nextStep() { return null; },
    async runStep() { executions += 1; return { outcome: 'committed', checkpoint: 'wrong' }; },
    async recoverInterruptedStep(context) {
      assert(context.idempotencyKey === 'stable-key', 'restart lost the persisted key');
      return { outcome: 'committed', checkpoint: 'published', done: true };
    },
  };
  const result = await new BackupOperationCoordinator(store, handlers(handler)).resume();
  assert(result?.state === 'succeeded', 'restart recovery did not complete');
  assert(executions === 0, 'restart repeated a possibly committed step');
}

export async function testInterruptedReplacementRollsBackBeforeRetry() {
  const store = new MemoryStore();
  const created = await store.create({ id: 'replacement', kind: 'import', payload: '{"mode":"replacement"}' }, 'now');
  await store.update(created.id, created.version, {
    state: 'running', activeStep: 'validate_snapshot_and_replace', activeStepKey: 'replacement:start:validate_snapshot_and_replace', attempt: 1,
  }, 'later');
  const events: string[] = [];
  const handler: BackupOperationHandler = {
    async nextStep(operation) { return operation.checkpoint ? null : { name: 'validate_snapshot_and_replace' }; },
    async runStep(context) {
      events.push(`commit:${context.idempotencyKey}`);
      return { outcome: 'committed', checkpoint: 'full_replacement_committed', done: true };
    },
    async recoverInterruptedStep(context) {
      events.push(`rollback:${context.idempotencyKey}`);
      return { outcome: 'not_committed' };
    },
  };
  const result = await new BackupOperationCoordinator(store, handlers(handler)).resume();
  assert(result?.state === 'succeeded', 'replacement did not resume');
  assert(
    events.join(',') === 'rollback:replacement:start:validate_snapshot_and_replace,commit:replacement:start:validate_snapshot_and_replace',
    'replacement retried before rollback or changed its key',
  );
}

export async function runCoordinatorTests() {
  await testSerializedOperations();
  await testRetriesReuseIdempotencyKey();
  await testExplicitRetryReusesIdempotencyKey();
  await testCancellationWaitsForBoundary();
  await testRestartRecoversWithoutRepeatingStep();
  await testInterruptedReplacementRollsBackBeforeRetry();
}
