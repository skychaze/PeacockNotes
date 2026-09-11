import AsyncStorage from '@react-native-async-storage/async-storage';
import * as FileSystem from 'expo-file-system/legacy';
import { backupDatabaseAsync, deleteDatabaseAsync, openDatabaseAsync } from 'expo-sqlite';
import { BackupOperationCoordinator, SqliteBackupOperationStore, type BackupOperationHandler } from '../backup';
import { getDb } from '../database/schema';
import { createArchive, pinMedia, validateArchive, type ArchiveMediaSource, type ArchiveSummary } from './archive';
import { publishBackupArchive, type PublishedBackup } from './backupFolder';

export type ExportProgress =
  | 'capturing'
  | 'building'
  | 'publishing'
  | 'verifying';

export type VerifiedBackup = Readonly<{
  name: string;
  uri: string;
  createdAt: string;
  bytes: number;
  contentRevision: number;
}>;

type MediaRow = Readonly<{ portableId: string; uri: string; kind: 'audio' | 'file' }>;

type Capture = Readonly<{
  databaseName: string;
  databaseUri: string;
  media: readonly ArchiveMediaSource[];
  revision: number;
}>;

const safeTimestamp = (value: string) => value.replace(/[:.]/g, '-');
const operationId = () => `${Date.now()}-${Math.random().toString(36).slice(2)}`;

const captureContent = async (directoryUri: string): Promise<Capture> => {
  const db = await getDb();
  const databaseName = `${operationId()}.db`;
  const snapshot = await openDatabaseAsync(databaseName, { useNewConnection: true });
  try {
    let capture: Capture | null = null;
    await db.withExclusiveTransactionAsync(async (transaction) => {
      const revisionRow = await transaction.getFirstAsync<{ revision: number }>(
        'SELECT revision FROM ContentMetadata WHERE id = 1;',
      );
      const rows = await transaction.getAllAsync<MediaRow>(`
        SELECT portableId, uri, 'audio' AS kind FROM NoteAudios
        UNION ALL
        SELECT portableId, uri, 'file' AS kind FROM NoteFiles;
      `);
      const pinned = await pinMedia({ directoryUri, media: rows.map((row) => ({
        portableId: row.portableId,
        sourceUri: row.uri,
        kind: row.kind,
      })) });
      await backupDatabaseAsync({ sourceDatabase: db, destDatabase: snapshot });
      capture = {
        databaseName,
        databaseUri: `file://${snapshot.databasePath}`,
        media: pinned,
        revision: Number(revisionRow?.revision ?? 0),
      };
    });
    if (!capture) throw new Error('CAPTURE_FAILED');
    return capture;
  } finally {
    await snapshot.closeAsync();
  }
};

const sameInventory = (left: ArchiveSummary, right: ArchiveSummary) =>
  left.archiveSha256 === right.archiveSha256 &&
  left.archiveBytes === right.archiveBytes &&
  left.inventory.length === right.inventory.length &&
  left.inventory.every((entry, index) => {
    const candidate = right.inventory[index];
    return candidate?.path === entry.path && candidate.sha256 === entry.sha256 && candidate.size === entry.size;
  });

const executeExport = async (
  onProgress: (progress: ExportProgress) => void,
): Promise<VerifiedBackup> => {
  const root = FileSystem.cacheDirectory;
  if (!root) throw new Error('STAGING_UNAVAILABLE');
  const work = `${root}backup-export-${operationId()}/`;
  const archiveUri = `${work}staged.pnbak`;
  const createdAt = new Date().toISOString();
  const name = `peacock-notes-${safeTimestamp(createdAt)}.pnbak`;
  await FileSystem.makeDirectoryAsync(work, { intermediates: true });
  let capture: Capture | null = null;
  try {
    onProgress('capturing');
    capture = await captureContent(work);
    onProgress('building');
    const staged = await createArchive({
      databaseUri: capture.databaseUri,
      destinationUri: archiveUri,
      media: capture.media,
      contentRevision: capture.revision,
      createdAt,
    });
    onProgress('publishing');
    const published: PublishedBackup = await publishBackupArchive({
      stagedUri: archiveUri,
      displayName: name,
      expectedBytes: staged.archiveBytes,
    });
    onProgress('verifying');
    const readback = await validateArchive({ archiveUri: published.uri });
    if (!sameInventory(staged, readback)) throw new Error('DESTINATION_VERIFICATION_FAILED');
    const verified = {
      name: published.name,
      uri: published.uri,
      createdAt,
      bytes: staged.archiveBytes,
      contentRevision: capture.revision,
    } satisfies VerifiedBackup;
    await AsyncStorage.setItem('backup.lastVerified', JSON.stringify(verified));
    return verified;
  } finally {
    if (capture) await deleteDatabaseAsync(capture.databaseName);
    await FileSystem.deleteAsync(work, { idempotent: true });
  }
};

class ExportOperationHandler implements BackupOperationHandler {
  progress: ((progress: ExportProgress) => void) | null = null;
  verified: VerifiedBackup | null = null;

  async nextStep(operation: Parameters<BackupOperationHandler['nextStep']>[0]) {
    return operation.checkpoint ? null : { name: 'export_and_verify' };
  }

  async runStep() {
    if (!this.progress) return { outcome: 'failed', code: 'EXPORT_INTERRUPTED', message: 'Export context was lost.' } as const;
    try {
      this.verified = await executeExport(this.progress);
      return { outcome: 'committed', checkpoint: 'verified', done: true } as const;
    } catch (error: unknown) {
      const code = typeof error === 'object' && error !== null && 'code' in error
        ? String(error.code)
        : error instanceof Error ? error.message : 'EXPORT_FAILED';
      const message = error instanceof Error ? error.message : 'Backup export failed.';
      return { outcome: 'failed', code, message } as const;
    }
  }

  async recoverInterruptedStep() {
    return {
      outcome: 'unknown',
      code: 'EXPORT_INTERRUPTED',
      message: 'The app stopped before provider verification completed.',
    } as const;
  }
}

const exportHandler = new ExportOperationHandler();
const unavailableHandler: BackupOperationHandler = {
  async nextStep() { return null; },
  async runStep() { return { outcome: 'failed', code: 'UNAVAILABLE', message: 'Operation is unavailable.' }; },
  async recoverInterruptedStep() { return { outcome: 'not_committed' }; },
};
const coordinator = new BackupOperationCoordinator(new SqliteBackupOperationStore(), {
  export: exportHandler,
  import: unavailableHandler,
  managed_retention: unavailableHandler,
  automatic_backup: unavailableHandler,
}, { maxAttemptsPerStep: 1 });

export const exportBackup = async (
  onProgress: (progress: ExportProgress) => void,
): Promise<VerifiedBackup> => {
  await coordinator.resume();
  exportHandler.progress = onProgress;
  exportHandler.verified = null;
  try {
    const operation = await coordinator.start(operationId(), 'export', '{"version":1}');
    if (operation.state !== 'succeeded' || !exportHandler.verified) {
      const error = new Error(operation.errorMessage ?? 'EXPORT_FAILED');
      Object.assign(error, { code: operation.errorCode ?? 'EXPORT_FAILED' });
      throw error;
    }
    return exportHandler.verified;
  } finally {
    exportHandler.progress = null;
  }
};
