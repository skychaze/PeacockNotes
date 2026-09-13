import {
  BackupOperationCoordinator,
  SqliteBackupOperationStore,
  type BackupOperationHandler,
  type BackupOperationKind,
} from '../backup';

/**
 * The durable backup row is a process-wide mutex. Keep its coordinator and
 * handler registry process-wide as well so an import, export, retention run,
 * or automatic backup can never drive the same row through a different
 * service's placeholder handler.
 */
const unavailableHandler = (kind: BackupOperationKind): BackupOperationHandler => ({
  async nextStep() {
    throw new Error(`Backup operation handler is unavailable: ${kind}`);
  },
  async runStep() {
    return {
      outcome: 'failed',
      code: 'BACKUP_HANDLER_UNAVAILABLE',
      message: `Backup operation handler is unavailable: ${kind}`,
    } as const;
  },
  async recoverInterruptedStep() {
    return {
      outcome: 'unknown',
      code: 'BACKUP_HANDLER_UNAVAILABLE',
      message: `Backup operation handler is unavailable: ${kind}`,
    } as const;
  },
});

const handlers: Record<BackupOperationKind, BackupOperationHandler> = {
  export: unavailableHandler('export'),
  import: unavailableHandler('import'),
  managed_retention: unavailableHandler('managed_retention'),
  automatic_backup: unavailableHandler('automatic_backup'),
};

export const backupOperationStore = new SqliteBackupOperationStore();

export const backupOperationCoordinator = new BackupOperationCoordinator(
  backupOperationStore,
  handlers,
  { maxAttemptsPerStep: 3 },
);

/** Register the concrete handler owned by each backup service. */
export const registerBackupOperationHandler = (
  kind: BackupOperationKind,
  handler: BackupOperationHandler,
) => {
  handlers[kind] = handler;
};
