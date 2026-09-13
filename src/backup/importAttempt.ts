import type { BackupOperationState } from './types';

/** A user-requested import gets a new durable identity. */
export const createImportOperationId = (
  now: number = Date.now(),
  random: number = Math.random(),
) => `import-${now}-${random.toString(36).slice(2)}`;

/** Only an unfinished/uncertain attempt may retain its idempotency key. */
export const isRetryableImportState = (state: BackupOperationState): boolean =>
  state === 'failed' || state === 'interrupted';
