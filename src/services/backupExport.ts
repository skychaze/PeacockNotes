import AsyncStorage from '@react-native-async-storage/async-storage';
import * as FileSystem from 'expo-file-system/legacy';
import { backupDatabaseAsync, deleteDatabaseAsync, openDatabaseAsync } from 'expo-sqlite';
import type { BackupOperationHandler } from '../backup';
import { getDb } from '../database/schema';
import {
  backupOperationCoordinator as coordinator,
  backupOperationStore as operationStore,
  registerBackupOperationHandler,
} from './backupOperations';
import {
  applyManagedArchiveRetention,
  createArchive,
  pinMedia,
  scanBackupCollection,
  validateArchive,
  type ArchiveMediaSource,
  type ArchiveSummary,
  type ManagedRetentionResult,
} from './archive';
import {
  acquireBackupForegroundServiceLease,
  getBackupFolderState,
  publishBackupArchive,
  releaseBackupForegroundService,
  type PublishedBackup,
} from './backupFolder';
import { refreshBackupDiscovery } from './backupDiscovery';
import { withMediaDeletionPaused } from '../utils/mediaFiles';
import { beginBackupProgress, finishBackupProgress, type BackupProgressOwner } from './backupProgress';

export type ExportProgress =
  | 'capturing'
  | 'building'
  | 'publishing'
  | 'verifying';

export type VerifiedBackup = Readonly<{
  name: string;
  uri: string;
  folderUri?: string;
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
const safeIdentity = (value: string) => value.replace(/[^a-zA-Z0-9_-]/g, '-');
const operationId = () => `${Date.now()}-${Math.random().toString(36).slice(2)}`;

const captureContent = async (directoryUri: string, progress?: BackupProgressOwner): Promise<Capture> =>
  withMediaDeletionPaused(async () => {
    const db = await getDb();
    const databaseName = `${operationId()}.db`;
    const snapshot = await openDatabaseAsync(databaseName, { useNewConnection: true });
    try {
      // SQLite's online backup creates a consistent snapshot without holding an
      // exclusive transaction on the live database. Read the media inventory
      // from that snapshot so note edits remain responsive during pinning.
      await backupDatabaseAsync({ sourceDatabase: db, destDatabase: snapshot });
      const revisionRow = await snapshot.getFirstAsync<{ revision: number }>(
        'SELECT revision FROM ContentMetadata WHERE id = 1;',
      );
      const rows = await snapshot.getAllAsync<MediaRow>(`
        SELECT portableId, uri, 'audio' AS kind FROM NoteAudios
        UNION ALL
        SELECT portableId, uri, 'file' AS kind FROM NoteFiles;
      `);
      const pinned = await pinMedia({ directoryUri, media: rows.map((row) => ({
        portableId: row.portableId,
        sourceUri: row.uri,
        kind: row.kind,
      })), ...progress });
      return {
        databaseName,
        databaseUri: `file://${snapshot.databasePath}`,
        media: pinned,
        revision: Number(revisionRow?.revision ?? 0),
      };
    } finally {
      await snapshot.closeAsync();
    }
  });

const sameInventory = (left: ArchiveSummary, right: ArchiveSummary) =>
  left.archiveSha256 === right.archiveSha256 &&
  left.archiveBytes === right.archiveBytes &&
  left.inventory.length === right.inventory.length &&
  left.inventory.every((entry, index) => {
    const candidate = right.inventory[index];
    return candidate?.path === entry.path && candidate.sha256 === entry.sha256 && candidate.size === entry.size;
  });

const executeExport = async (
  onProgress: (progress: ExportProgress) => void = () => {},
  identity?: Readonly<{ key: string; createdAt: string; operationId: string; operationKind: string }>,
): Promise<VerifiedBackup> => {
  const root = FileSystem.cacheDirectory;
  if (!root) throw new Error('STAGING_UNAVAILABLE');
  const work = `${root}backup-export-${operationId()}/`;
  const archiveUri = `${work}staged.pnbak`;
  const createdAt = identity?.createdAt ?? new Date().toISOString();
  const identitySuffix = identity ? `-${safeIdentity(identity.key)}` : '';
  const name = `peacock-notes-${safeTimestamp(createdAt)}${identitySuffix}.pnbak`;
  await FileSystem.makeDirectoryAsync(work, { intermediates: true });
  let capture: Capture | null = null;
  const progress = identity ? {
    operationId: identity.operationId,
    operationKind: identity.operationKind,
  } satisfies BackupProgressOwner : null;
  try {
    if (progress) await beginBackupProgress({ ...progress, phase: 'capture', step: 'capture' });
    console.info(`[BR-EXPORT] started name=${name}`);
    onProgress('capturing');
    capture = await captureContent(work, progress ?? undefined);
    onProgress('building');
    const staged = await createArchive({
      databaseUri: capture.databaseUri,
      destinationUri: archiveUri,
      media: capture.media,
      contentRevision: capture.revision,
      createdAt,
      ...progress,
    });
    onProgress('publishing');
    const folder = await getBackupFolderState();
    if (folder.status !== 'connected' || !folder.uri) throw new Error('FOLDER_NOT_CONNECTED');
    const published: PublishedBackup = await publishBackupArchive({
      stagedUri: archiveUri,
      displayName: name,
      expectedBytes: staged.archiveBytes,
      ...progress,
    });
    onProgress('verifying');
    const readback = await validateArchive({ archiveUri: published.uri, mode: 'verify_only', ...progress });
    if (!sameInventory(staged, readback)) throw new Error('DESTINATION_VERIFICATION_FAILED');
    const verified = {
      name: published.name,
      uri: published.uri,
      folderUri: folder.uri,
      createdAt,
      bytes: staged.archiveBytes,
      contentRevision: capture.revision,
    } satisfies VerifiedBackup;
    await AsyncStorage.setItem('backup.lastVerified', JSON.stringify(verified));
    if (progress) finishBackupProgress({ ...progress, state: 'succeeded' });
    console.info(`[BR-EXPORT] verified uri=${verified.uri} bytes=${verified.bytes}`);
    return verified;
  } catch (error) {
    if (progress) finishBackupProgress({ ...progress, state: 'failed' });
    console.warn('[BR-EXPORT] failed after remote publication may have occurred:', error);
    throw error;
  } finally {
    if (capture) await deleteDatabaseAsync(capture.databaseName);
    await FileSystem.deleteAsync(work, { idempotent: true });
  }
};

class ExportOperationHandler implements BackupOperationHandler {
  constructor(private readonly retryTransientFailures = false) {}

  progress: ((progress: ExportProgress) => void) | null = null;
  verified: VerifiedBackup | null = null;

  async nextStep(operation: Parameters<BackupOperationHandler['nextStep']>[0]) {
    return operation.checkpoint ? null : { name: 'export_and_verify' };
  }

  async runStep({ operation, idempotencyKey }: Parameters<BackupOperationHandler['runStep']>[0]) {
    try {
      this.verified = await executeExport(this.progress ?? undefined, {
        key: idempotencyKey,
        createdAt: operation.createdAt,
        operationId: operation.id,
        operationKind: operation.kind,
      });
      return { outcome: 'committed', checkpoint: 'verified', done: true } as const;
    } catch (error: unknown) {
      const code = typeof error === 'object' && error !== null && 'code' in error
        ? String(error.code)
        : error instanceof Error ? error.message : 'EXPORT_FAILED';
      const message = error instanceof Error ? error.message : 'Backup export failed.';
      const transient = code === 'BACKUP_OFFLINE';
      return this.retryTransientFailures && transient
        ? { outcome: 'retry', code, message } as const
        : { outcome: 'failed', code, message } as const;
    }
  }

  async recoverInterruptedStep({ operation, idempotencyKey }: Parameters<BackupOperationHandler['recoverInterruptedStep']>[0]) {
    try {
      const expectedName = `peacock-notes-${safeTimestamp(operation.createdAt)}-${safeIdentity(idempotencyKey)}.pnbak`;
      // Recovery is the exceptional path where every candidate must be
      // trusted. Normal screen discovery uses the lightweight cached scan.
      const collection = await scanBackupCollection(true);
      const candidate = collection.archives.find((archive) => archive.name === expectedName && archive.state === 'valid');
      if (!candidate) return { outcome: 'not_committed' } as const;
      const summary = await validateArchive({
        archiveUri: candidate.uri,
        mode: 'verify_only',
        operationId: operation.id,
        operationKind: operation.kind,
      });
      const folder = await getBackupFolderState().catch(() => null);
      const verified = {
        name: candidate.name,
        uri: candidate.uri,
        folderUri: folder?.uri ?? undefined,
        createdAt: summary.createdAt || operation.createdAt,
        bytes: summary.archiveBytes,
        contentRevision: summary.contentRevision,
      } satisfies VerifiedBackup;
      await AsyncStorage.setItem('backup.lastVerified', JSON.stringify(verified));
      this.verified = verified;
      return { outcome: 'committed', checkpoint: 'verified', done: true } as const;
    } catch (error: unknown) {
      return {
        outcome: 'unknown',
        code: 'EXPORT_RECOVERY_UNKNOWN',
        message: error instanceof Error ? error.message : 'The prior export state could not be verified.',
      } as const;
    }
  }
}

const exportHandler = new ExportOperationHandler();
const automaticExportHandler = new ExportOperationHandler(true);
class ManagedRetentionHandler implements BackupOperationHandler {
  result: ManagedRetentionResult | null = null;

  async nextStep(operation: Parameters<BackupOperationHandler['nextStep']>[0]) {
    return operation.checkpoint ? null : { name: 'scan_and_prune' };
  }

  async runStep({ operation }: Parameters<BackupOperationHandler['runStep']>[0]) {
    const progress = {
      operationId: operation.id,
      operationKind: operation.kind,
    } satisfies BackupProgressOwner;
    await beginBackupProgress({ ...progress, phase: 'scan', step: 'scan_archives' });
    let failed = false;
    try {
      this.result = await applyManagedArchiveRetention(progress);
      return { outcome: 'committed', checkpoint: 'retention_applied', done: true } as const;
    } catch (error) {
      failed = true;
      const code = typeof error === 'object' && error !== null && 'code' in error
        ? String(error.code)
        : error instanceof Error ? error.message : 'RETENTION_FAILED';
      const message = error instanceof Error ? error.message : 'Managed retention failed.';
      return { outcome: 'failed', code, message } as const;
    } finally {
      finishBackupProgress({ ...progress, state: failed ? 'failed' : 'succeeded' });
    }
  }

  async recoverInterruptedStep() {
    // Archive deletion is idempotent. A fresh complete scan safely identifies
    // only older valid archives that still remain beyond the seven-item cap.
    return { outcome: 'not_committed' } as const;
  }
}
const managedRetentionHandler = new ManagedRetentionHandler();
registerBackupOperationHandler('export', exportHandler);
registerBackupOperationHandler('automatic_backup', automaticExportHandler);
registerBackupOperationHandler('managed_retention', managedRetentionHandler);

export type ManagedRetentionState = Readonly<{
  status: 'applied' | 'nothing_to_prune' | 'scan_incomplete' | 'policy_restricted' | 'provider_failed' | 'failed';
  deletedCount: number;
  updatedAt: string;
}>;

const storeRetentionState = async (state: ManagedRetentionState) => {
  await AsyncStorage.setItem('backup.retentionState', JSON.stringify(state));
  return state;
};

export const getManagedRetentionState = async (): Promise<ManagedRetentionState | null> => {
  const stored = await AsyncStorage.getItem('backup.retentionState');
  if (!stored) return null;
  try {
    const parsed = JSON.parse(stored) as Partial<ManagedRetentionState>;
    return typeof parsed.status === 'string' && typeof parsed.deletedCount === 'number' && typeof parsed.updatedAt === 'string'
      ? parsed as ManagedRetentionState
      : null;
  } catch {
    return null;
  }
};

export const getLastVerifiedBackup = async (): Promise<VerifiedBackup | null> => {
  const stored = await AsyncStorage.getItem('backup.lastVerified');
  if (!stored) return null;
  try {
    const parsed = JSON.parse(stored) as Partial<VerifiedBackup>;
    return typeof parsed.name === 'string' && typeof parsed.uri === 'string' &&
      typeof parsed.createdAt === 'string' && typeof parsed.bytes === 'number' &&
      typeof parsed.contentRevision === 'number'
      ? parsed as VerifiedBackup
      : null;
  } catch {
    return null;
  }
};

/**
 * Remove the persisted success pointer when its remote archive is deleted.
 * The Drive collection is independently cached, so leaving this pointer in
 * AsyncStorage would resurrect a deleted archive's success banner after a
 * process restart and could also make automatic-backup policy treat it as a
 * current recovery point.
 */
export const clearLastVerifiedBackupIfDeleted = async (deletedUris: readonly string[]) => {
  if (deletedUris.length === 0) return;
  const lastVerified = await getLastVerifiedBackup();
  if (lastVerified && deletedUris.includes(lastVerified.uri)) {
    await AsyncStorage.removeItem('backup.lastVerified');
    console.info(`[BR-EXPORT] cleared deleted lastVerified uri=${lastVerified.uri}`);
  }
};

export const resumePendingExportOperation = async () => {
  const active = await operationStore.getActive();
  if (!active || (active.kind !== 'export' && active.kind !== 'automatic_backup' && active.kind !== 'managed_retention')) {
    return null;
  }
  exportHandler.progress = null;
  exportHandler.verified = null;
  automaticExportHandler.verified = null;
  managedRetentionHandler.result = null;
  return coordinator.resume(['export', 'automatic_backup', 'managed_retention']);
};

export const runManagedRetention = async (): Promise<ManagedRetentionState> => {
  console.info('[BR-RETENTION] started');
  await coordinator.resume(['export', 'automatic_backup', 'managed_retention']);
  managedRetentionHandler.result = null;
  const operation = await coordinator.start(operationId(), 'managed_retention', '{"version":1}');
  const result = managedRetentionHandler.result as ManagedRetentionResult | null;
  const updatedAt = new Date().toISOString();
  if (operation.state === 'succeeded' && result) {
    console.info(`[BR-RETENTION] completed deleted=${result.deletedCount}`);
    return storeRetentionState({
      status: result.status,
      deletedCount: result.deletedCount,
      updatedAt,
    });
  }
  const status = operation.errorCode === 'RETENTION_SCAN_INCOMPLETE'
    ? 'scan_incomplete'
    : operation.errorCode === 'RETENTION_POLICY_RESTRICTED'
      ? 'policy_restricted'
      : operation.errorCode === 'PROVIDER_DELETE_FAILED'
        ? 'provider_failed'
        : 'failed';
  return storeRetentionState({ status, deletedCount: 0, updatedAt });
};

export const runAutomaticExport = async (): Promise<VerifiedBackup> => {
  await coordinator.resume(['export', 'automatic_backup', 'managed_retention']);
  automaticExportHandler.verified = null;
  const operation = await coordinator.start(operationId(), 'automatic_backup', '{"version":1}');
  if (operation.state !== 'succeeded' || !automaticExportHandler.verified) {
    const error = new Error(operation.errorMessage ?? 'EXPORT_FAILED');
    Object.assign(error, { code: operation.errorCode ?? 'EXPORT_FAILED' });
    throw error;
  }
  const verified = automaticExportHandler.verified;
  // The remote archive is already read-back verified at this point. Retention
  // and discovery are follow-up housekeeping and must not turn that committed
  // automatic backup into a failed/stuck operation when Drive metadata or a
  // later scan is temporarily unavailable.
  try {
    await runManagedRetention();
  } catch (error) {
    console.warn('[BR-AUTO] retention after verified export failed:', error);
  }
  try {
    await refreshBackupDiscovery();
  } catch (error) {
    console.warn('[BR-AUTO] discovery refresh after verified export failed:', error);
  }
  return verified;
};

export const exportBackup = async (
  onProgress: (progress: ExportProgress) => void,
): Promise<VerifiedBackup> => {
  console.info('[BR-EXPORT] coordinator start');
  await coordinator.resume(['export', 'automatic_backup', 'managed_retention']);
  exportHandler.progress = onProgress;
  exportHandler.verified = null;
  try {
    const operation = await coordinator.start(operationId(), 'export', '{"version":1}');
    if (operation.state !== 'succeeded' || !exportHandler.verified) {
      const error = new Error(operation.errorMessage ?? 'EXPORT_FAILED');
      Object.assign(error, { code: operation.errorCode ?? 'EXPORT_FAILED' });
      throw error;
    }
    const verified = exportHandler.verified;
    console.info('[BR-EXPORT] coordinator committed; retention detached');
    // Retention validates every existing remote archive. It is important, but
    // it must not make a completed, read-back-verified backup look stuck.
    // Retention is intentionally asynchronous so the verified export can be
    // shown immediately, but it still belongs to the same foreground work.
    // Hold a lease across the gap before its durable row is created; otherwise
    // the export wrapper could stop the shared service between phases.
    acquireBackupForegroundServiceLease();
    void runManagedRetention()
      .then(() => refreshBackupDiscovery())
      .catch((error: unknown) => {
        console.warn('Managed retention after export failed:', error);
      })
      .finally(() => releaseBackupForegroundService(true).catch((error: unknown) => {
        console.warn('Failed to finish backup notification:', error);
      }));
    return verified;
  } finally {
    exportHandler.progress = null;
  }
};
