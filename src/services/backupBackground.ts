import { backupNotificationOwner, type BackupNotificationOwner } from '../backup/notificationOwner';
import { parseImportPayload } from '../backup/importPayload';
import { pruneArchiveImportSessions } from './archive';
import type { BackupOperation } from '../backup';
import { backupOperationStore as store } from './backupOperations';
import { getRecoverableExportOperation, resumePendingExportOperation } from './backupExport';
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
export const resumePendingBackupOperation = (owner?: BackupNotificationOwner): Promise<BackupOperation | null> => {
  if (resumeInFlight) return owner
    ? resumeInFlight.then(() => resumePendingBackupOperation(owner))
    : resumeInFlight;
  resumeInFlight = (async () => {
    const active = await store.getActive() ?? await getRecoverableExportOperation();
    const payload = active?.kind === 'import' ? parseImportPayload(active.payload) : null;
    await pruneArchiveImportSessions(payload && payload.mode !== 'undo' ? payload.importSessionId : undefined);
    if (!active || (owner && backupNotificationOwner(active) !== owner)) return null;
    const automatic = backupNotificationOwner(active) === 'automatic';
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
