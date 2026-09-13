import {
  BackupOperationBusyError,
  type BackupOperation,
  type BackupOperationHandler,
  type BackupOperationKind,
  type BackupOperationStore,
  createBackupOperationStepKey,
  type CoordinatorOptions,
  type OperationPatch,
  type StepContext,
} from './types';

const terminal = (operation: BackupOperation) =>
  operation.state === 'succeeded' ||
  operation.state === 'failed' ||
  operation.state === 'cancelled' ||
  operation.state === 'interrupted';

export class BackupOperationCoordinator {
  private serial: Promise<void> = Promise.resolve();
  private readonly maxAttempts: number;
  private readonly now: () => string;

  constructor(
    private readonly store: BackupOperationStore,
    private readonly handlers: Readonly<Record<BackupOperationKind, BackupOperationHandler>>,
    options: CoordinatorOptions = {},
  ) {
    this.maxAttempts = Math.max(1, options.maxAttemptsPerStep ?? 3);
    this.now = options.now ?? (() => new Date().toISOString());
  }

  async start(id: string, kind: BackupOperationKind, payload: string): Promise<BackupOperation> {
    return this.exclusive(async () => {
      if (await this.store.getActive()) throw new BackupOperationBusyError();
      const operation = await this.store.create({ id, kind, payload }, this.now());
      return this.drive(operation);
    });
  }

  /** Resume the sole durable operation after app/process startup. */
  async resume(allowedKinds?: readonly BackupOperationKind[]): Promise<BackupOperation | null> {
    return this.exclusive(async () => {
      const operation = await this.store.getActive();
      if (operation && allowedKinds && !allowedKinds.includes(operation.kind)) {
        throw new BackupOperationBusyError();
      }
      return operation ? this.drive(operation) : null;
    });
  }

  /** Cancellation is a request and is observed only between durable steps. */
  async requestCancellation(id: string): Promise<BackupOperation | null> {
    // Deliberately does not wait for `serial`: a running external step is not
    // aborted, but the durable request becomes visible at its next boundary.
    let operation = await this.store.get(id);
    while (operation && !terminal(operation)) {
      const updated = await this.store.update(
        operation.id,
        operation.version,
        { cancelRequested: true },
        this.now(),
      );
      if (updated) return updated;
      operation = await this.store.get(id);
    }
    return operation;
  }

  /** Retry only truthful failed/interrupted records; committed checkpoints remain intact. */
  async retry(id: string): Promise<BackupOperation> {
    return this.exclusive(async () => {
      const current = await this.store.get(id);
      if (!current) throw new Error(`Backup operation ${id} does not exist`);
      if (current.state !== 'failed' && current.state !== 'interrupted') {
        throw new Error(`Backup operation ${id} is not retryable`);
      }
      if (await this.store.getActive()) throw new BackupOperationBusyError();
      const restartingUncertainStep = current.state === 'interrupted' && current.activeStep !== null;
      const operation = await this.change(current, {
        state: 'pending',
        activeStep: restartingUncertainStep ? current.activeStep : null,
        activeStepKey: restartingUncertainStep ? current.activeStepKey : null,
        attempt: restartingUncertainStep ? current.attempt : 0,
        cancelRequested: false,
        errorCode: null,
        errorMessage: null,
        finishedAt: null,
      });
      return this.drive(operation);
    });
  }

  private async drive(initial: BackupOperation): Promise<BackupOperation> {
    let operation = initial;
    const handler = this.handlers[operation.kind];

    if (operation.activeStep && operation.activeStepKey) {
      const context: StepContext = {
        operation,
        step: { name: operation.activeStep },
        idempotencyKey: operation.activeStepKey,
      };
      let resolution;
      try {
        resolution = await handler.recoverInterruptedStep(context);
      } catch (error: unknown) {
        // Recovery is allowed to be inconclusive, but a thrown handler error
        // must still leave a truthful terminal record.  Otherwise a process
        // restart can strand the row in `running` forever with no retry path.
        return this.finish(operation, 'interrupted', 'recovery_threw', errorMessage(error));
      }
      if (resolution.outcome === 'unknown') {
        return this.finish(operation, 'interrupted', resolution.code, resolution.message);
      }
      operation = resolution.outcome === 'committed'
        ? await this.commitStep(operation, resolution.checkpoint)
        : await this.change(operation, { activeStep: null, activeStepKey: null });
      if (resolution.outcome === 'committed' && resolution.done) {
        return this.finish(operation, 'succeeded');
      }
    }

    while (!terminal(operation)) {
      if (operation.cancelRequested) return this.finish(operation, 'cancelled');

      let step;
      try {
        step = await handler.nextStep(operation);
      } catch (error: unknown) {
        return this.finish(operation, 'failed', 'step_planning_failed', errorMessage(error));
      }
      if (!step) return this.finish(operation, 'succeeded');

      const attempt = operation.attempt + 1;
      // The key identifies the logical transition, not an attempt. Retries
      // therefore reuse it and downstream implementations can deduplicate.
      const idempotencyKey = createBackupOperationStepKey(operation.id, operation.checkpoint, step.name);
      operation = await this.change(operation, {
        state: 'running',
        activeStep: step.name,
        activeStepKey: idempotencyKey,
        attempt,
        errorCode: null,
        errorMessage: null,
      });

      let result;
      try {
        result = await handler.runStep({ operation, step, idempotencyKey });
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : 'Unexpected operation error';
        return this.finish(operation, 'interrupted', 'step_threw', message);
      }

      if (result.outcome === 'committed') {
        operation = await this.commitStep(operation, result.checkpoint);
        if (result.done) return this.finish(operation, 'succeeded');
        continue;
      }
      if (result.outcome === 'failed') {
        return this.finish(operation, 'failed', result.code, result.message);
      }

      // A retry result explicitly guarantees that no mutation committed.
      operation = await this.change(operation, {
        activeStep: null,
        activeStepKey: null,
        errorCode: result.code,
        errorMessage: result.message,
      });
      if (attempt >= this.maxAttempts) {
        return this.finish(operation, 'failed', 'retry_limit', result.message);
      }
    }
    return operation;
  }

  private commitStep(operation: BackupOperation, checkpoint: string) {
    return this.change(operation, {
      checkpoint,
      activeStep: null,
      activeStepKey: null,
      attempt: 0,
      errorCode: null,
      errorMessage: null,
    });
  }

  private finish(
    operation: BackupOperation,
    state: 'succeeded' | 'failed' | 'cancelled' | 'interrupted',
    errorCode: string | null = null,
    errorMessage: string | null = null,
  ) {
    return this.change(operation, {
      state,
      errorCode,
      errorMessage,
      finishedAt: this.now(),
    });
  }

  private async change(operation: BackupOperation, patch: OperationPatch) {
    let current = operation;
    for (let tries = 0; tries < 3; tries += 1) {
      const updated = await this.store.update(current.id, current.version, patch, this.now());
      if (updated) return updated;
      const refreshed = await this.store.get(current.id);
      if (!refreshed || terminal(refreshed)) {
        throw new Error(`Backup operation ${current.id} changed concurrently`);
      }
      current = refreshed;
    }
    throw new Error(`Backup operation ${operation.id} changed concurrently`);
  }

  private async exclusive<T>(work: () => Promise<T>): Promise<T> {
    const previous = this.serial;
    let release: () => void = () => {};
    this.serial = new Promise<void>((resolve) => { release = resolve; });
    await previous;
    try {
      return await work();
    } finally {
      release();
    }
  }
}

const errorMessage = (error: unknown) =>
  error instanceof Error ? error.message : typeof error === 'string' ? error : 'Unexpected backup operation error';
