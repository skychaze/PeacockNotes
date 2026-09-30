import type { BackupOperation } from '../backup';
import { backupOperationStore as store } from './backupOperations';
import { resumePendingExportOperation } from './backupExport';
import { startAutomaticBackupForegroundService } from './automaticBackup';
import { startBackupForegroundService, releaseBackupForegroundService } from './backupFolder';
import { resumePendingImportOperation } from './backupImport';

let resumeInFlight: Promise<BackupOperation | null> | null = null;

export const getActiveBackupOperation = () => store.getActive();

export const getLatestBackupOperation = () => store.getLatest();

/**
 * Reconcile the single durable backup operation after a process restart.
 * The in-process promise prevents App startup and a headless task from
 * starting two recovery drives at once in the same JS runtime.
 */
export const resumePendingBackupOperation = (): Promise<BackupOperation | null> => {
  if (resumeInFlight) return resumeInFlight;
  resumeInFlight = (async () => {
    const active = await store.getActive();
    if (!active) return null;
    const automatic = active.kind === 'automatic_backup';
    if (automatic) await startAutomaticBackupForegroundService();
    else await startBackupForegroundService();
    try {
      return await (active.kind === 'import'
        ? resumePendingImportOperation()
        : resumePendingExportOperation());
    } finally {
      if (!automatic) await releaseBackupForegroundService(true);
    }
  })().finally(() => {
    resumeInFlight = null;
  });
  return resumeInFlight;
};
