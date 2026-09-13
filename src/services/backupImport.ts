import * as FileSystem from 'expo-file-system/legacy';
import * as DocumentPicker from 'expo-document-picker';
import {
  createBackupOperationStepKey,
  type BackupOperation,
  type BackupOperationHandler,
} from '../backup';
import { createImportOperationId, isRetryableImportState } from '../backup/importAttempt';
import {
  createArchiveImportPayload,
  createUndoImportPayload,
  importStepName,
  parseImportPayload,
  type ImportPayload,
} from '../backup/importPayload';
import { isWithinFullReplacementUndoWindow } from '../backup/undoPolicy';
import { getDb, initDb, withDatabaseSuspended } from '../database/schema';
import {
  backupOperationCoordinator as coordinator,
  backupOperationStore as store,
  registerBackupOperationHandler,
} from './backupOperations';
import {
  commitFullReplacementArchiveImport,
  commitFullReplacementUndo,
  commitSelectiveArchiveImport,
  getFullReplacementUndo,
  hasFullReplacementUndoReceipt,
  getArchiveImportReceiptResult,
  previewArchiveImport,
  recoverInterruptedFullReplacement,
  type FullReplacementResult,
  type FullReplacementUndo,
  type FullReplacementUndoResult,
  type ImportPreview,
  type ImportResult,
} from './archive';

const liveDatabaseUri = async () => `file://${(await getDb()).databasePath}`;

const importOperationKey = (operation: BackupOperation, payload: ImportPayload) =>
  createBackupOperationStepKey(operation.id, null, importStepName(payload));

class ImportOperationHandler implements BackupOperationHandler {
  result: ImportResult | FullReplacementResult | FullReplacementUndoResult | null = null;

  async nextStep(operation: Parameters<BackupOperationHandler['nextStep']>[0]) {
    if (operation.checkpoint) return null;
    return { name: importStepName(parseImportPayload(operation.payload)) };
  }

  async runStep({ operation, idempotencyKey }: Parameters<BackupOperationHandler['runStep']>[0]) {
    const mediaDirectoryUri = FileSystem.documentDirectory;
    if (!mediaDirectoryUri) {
      return { outcome: 'failed', code: 'STORAGE_UNAVAILABLE', message: 'App storage is unavailable.' } as const;
    }
    try {
      const payload = parseImportPayload(operation.payload);
      if (payload.mode === 'undo') {
        try {
          this.result = await withDatabaseSuspended(() => commitFullReplacementUndo(payload.snapshotId));
        } finally {
          await initDb();
        }
        return { outcome: 'committed', checkpoint: 'full_replacement_undone', done: true } as const;
      }
      if (payload.mode === 'replacement') {
        const databaseUri = await liveDatabaseUri();
        try {
          this.result = await withDatabaseSuspended(() => commitFullReplacementArchiveImport({
            archiveUri: payload.archiveUri,
            archiveSha256: payload.archiveSha256,
            databaseUri,
            mediaDirectoryUri,
            operationKey: idempotencyKey,
          }));
        } finally {
          await initDb();
        }
        return { outcome: 'committed', checkpoint: 'full_replacement_committed', done: true } as const;
      }
      // The native importer opens the live database through Android's SQLite
      // API. Close Expo's connection before that write so no prepared JS
      // statements or WAL state survive an external transaction; reopen it
      // before the durable operation store advances its checkpoint.
      const databaseUri = await liveDatabaseUri();
      try {
        this.result = await withDatabaseSuspended(() => commitSelectiveArchiveImport({
          archiveUri: payload.archiveUri,
          archiveSha256: payload.archiveSha256,
          selectedNoteIds: payload.selectedNoteIds,
          databaseUri,
          mediaDirectoryUri,
          operationKey: idempotencyKey,
        }));
      } finally {
        await initDb();
      }
      return { outcome: 'committed', checkpoint: 'selected_batch_committed', done: true } as const;
    } catch (error: unknown) {
      const code = typeof error === 'object' && error !== null && 'code' in error
        ? String(error.code)
        : error instanceof Error ? error.message : 'IMPORT_FAILED';
      const message = error instanceof Error ? error.message : 'Import failed.';
      return { outcome: 'failed', code, message } as const;
    }
  }

  async recoverInterruptedStep({ operation, idempotencyKey }: Parameters<BackupOperationHandler['recoverInterruptedStep']>[0]) {
    const payload = parseImportPayload(operation.payload);
    if (payload.mode === 'replacement' || payload.mode === 'undo') {
      try {
        await withDatabaseSuspended(() => recoverInterruptedFullReplacement());
      } finally {
        await initDb();
      }
    }
    const recoveredResult = payload.mode === 'undo'
      ? await hasFullReplacementUndoReceipt(payload.snapshotId).then((committed) =>
        committed ? { alreadyUndone: true } satisfies FullReplacementUndoResult : null)
      : await getArchiveImportReceiptResult(await liveDatabaseUri(), idempotencyKey);
    if (recoveredResult) {
      this.result = recoveredResult;
      return {
        outcome: 'committed',
        checkpoint: payload.mode === 'undo'
          ? 'full_replacement_undone'
          : payload.mode === 'replacement' ? 'full_replacement_committed' : 'selected_batch_committed',
        done: true,
      } as const;
    }
    return { outcome: 'not_committed' } as const;
  }
}

const importHandler = new ImportOperationHandler();
registerBackupOperationHandler('import', importHandler);

export const resumePendingImportOperation = async () => {
  const active = await store.getActive();
  if (!active || active.kind !== 'import') return null;
  importHandler.result = null;
  return coordinator.resume(['import']);
};

export const browseArchiveForImport = async (): Promise<ImportPreview | null> => {
  const result = await DocumentPicker.getDocumentAsync({
    type: 'application/octet-stream',
    copyToCacheDirectory: false,
  });
  if (result.canceled) return null;
  return previewArchiveImport(result.assets[0].uri);
};

export const previewNewestArchive = (archiveUri: string): Promise<ImportPreview> =>
  previewArchiveImport(archiveUri);

const importNotes = async (
  payload: ImportPayload,
): Promise<ImportResult | FullReplacementResult | FullReplacementUndoResult> => {
  const serializedPayload = JSON.stringify(payload);
  importHandler.result = null;

  const active = await store.getActive();
  let operation: BackupOperation | null = null;
  if (active?.kind === 'import') {
    // If the caller is attaching to the same in-flight request, keep that
    // attempt's ID through recovery. A different request waits for the active
    // import, then receives its own fresh ID below.
    const sameAttempt = active.payload === serializedPayload;
    const resumed = await coordinator.resume(['import']);
    if (sameAttempt) {
      operation = resumed ?? await store.get(active.id);
      if (operation && isRetryableImportState(operation.state)) {
        operation = await coordinator.retry(operation.id);
      }
    } else {
      importHandler.result = null;
    }
  }
  if (!operation) {
    // A completed archive import is not a deduplication key: the same archive
    // may be intentionally restored again after the user has edited the live
    // notes. Reuse an ID only for a retryable record from this exact attempt so
    // an uncertain native mutation keeps its receipt/idempotency key.
    const retryable = await store.getLatestByKindAndPayload?.('import', serializedPayload) ?? null;
    operation = retryable && isRetryableImportState(retryable.state)
      ? await coordinator.retry(retryable.id)
      : await coordinator.start(createImportOperationId(), 'import', serializedPayload);
  }
  if (operation.state !== 'succeeded') {
    const error = new Error(operation.errorMessage ?? 'IMPORT_FAILED');
    Object.assign(error, { code: operation.errorCode ?? 'IMPORT_FAILED' });
    throw error;
  }
  if (importHandler.result) return importHandler.result;
  const recoveredResult = payload.mode === 'undo'
    ? await hasFullReplacementUndoReceipt(payload.snapshotId).then((committed) =>
      committed ? { alreadyUndone: true } satisfies FullReplacementUndoResult : null)
    : await getArchiveImportReceiptResult(await liveDatabaseUri(), importOperationKey(operation, payload));
  if (recoveredResult) return recoveredResult;
  const error = new Error('IMPORT_RESULT_UNAVAILABLE');
  Object.assign(error, { code: 'IMPORT_RESULT_UNAVAILABLE' });
  throw error;
};

const requireNonDestructiveResult = (result: ImportResult | FullReplacementResult | FullReplacementUndoResult): ImportResult => {
  if (!('importedCount' in result)) throw new Error('IMPORT_RESULT_MISSING');
  return result;
};

export const importSelectedNotes = async (preview: ImportPreview, selectedNoteIds: readonly string[]): Promise<ImportResult> =>
  requireNonDestructiveResult(await importNotes(createArchiveImportPayload(
    'selective', preview.archiveUri, preview.archiveSha256, selectedNoteIds,
  )));

export const importAllNotesAdditively = async (preview: ImportPreview): Promise<ImportResult> =>
  requireNonDestructiveResult(await importNotes(createArchiveImportPayload(
    'additive', preview.archiveUri, preview.archiveSha256, preview.notes.map((note) => note.portableId),
  )));

export const importAllNotesByReplacement = async (preview: ImportPreview): Promise<FullReplacementResult> => {
  const result = await importNotes(createArchiveImportPayload(
    'replacement', preview.archiveUri, preview.archiveSha256, [],
  ));
  if (!('restoredNoteCount' in result)) throw new Error('FULL_REPLACEMENT_RESULT_MISSING');
  return result;
};

export const loadFullReplacementUndo = (): Promise<FullReplacementUndo> => getFullReplacementUndo();

export const isFullReplacementUndoAvailable = (undo: FullReplacementUndo, now: number): boolean =>
  undo.state === 'available' && undo.expiresAt !== null && isWithinFullReplacementUndoWindow(undo.expiresAt, now);

export const undoFullReplacement = async (undo: FullReplacementUndo): Promise<FullReplacementUndoResult> => {
  if (!undo.snapshotId || !isFullReplacementUndoAvailable(undo, Date.now())) throw new Error('UNDO_UNAVAILABLE');
  const result = await importNotes(createUndoImportPayload(undo.snapshotId));
  if (!('alreadyUndone' in result)) throw new Error('UNDO_RESULT_MISSING');
  return result;
};
