import { createImportOperationId, isRetryableImportState } from './importAttempt';

const assert = (condition: boolean, message: string) => {
  if (!condition) throw new Error(message);
};

export function testNewImportAttemptsHaveFreshIds() {
  const first = createImportOperationId(100, 0.1);
  const second = createImportOperationId(100, 0.2);
  assert(first !== second, 'new imports reused an operation id');
  assert(first.startsWith('import-100-') && second.startsWith('import-100-'), 'import ids lost their operation prefix');
}

export function testOnlyRetryableAttemptsReuseTheirId() {
  assert(isRetryableImportState('failed'), 'failed imports were not retryable');
  assert(isRetryableImportState('interrupted'), 'interrupted imports were not retryable');
  assert(!isRetryableImportState('succeeded'), 'successful imports were treated as retries');
  assert(!isRetryableImportState('cancelled'), 'cancelled imports were treated as retries');
}

export function runImportAttemptTests() {
  testNewImportAttemptsHaveFreshIds();
  testOnlyRetryableAttemptsReuseTheirId();
}

void Promise.resolve(runImportAttemptTests()).catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
