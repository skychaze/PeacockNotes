import * as FileSystem from 'expo-file-system/legacy';
import * as DocumentPicker from 'expo-document-picker';
import { BackupOperationCoordinator, SqliteBackupOperationStore, type BackupOperationHandler } from '../backup';
import { isWithinFullReplacementUndoWindow } from '../backup/undoPolicy';
import { closeDb, getDb, initDb } from '../database/schema';
import {
  commitFullReplacementArchiveImport,
  commitFullReplacementUndo,
  commitSelectiveArchiveImport,
  getFullReplacementUndo,
  hasArchiveImportReceipt,
  hasFullReplacementUndoReceipt,
  previewArchiveImport,
  recoverInterruptedFullReplacement,
  type FullReplacementResult,
  type FullReplacementUndo,
  type FullReplacementUndoResult,
  type ImportPreview,
  type ImportResult,
} from './archive';

type ImportMode = 'selective' | 'additive' | 'replacement' | 'undo';

type ImportPayload = Readonly<{
  version: 1;
  mode: ImportMode;
  archiveUri: string;
  archiveSha256: string;
  selectedNoteIds: readonly string[];
}>;

const selectiveOperationId = () => `import-${Date.now()}-${Math.random().toString(36).slice(2)}`;
const additiveOperationId = (archiveSha256: string) => `import-additive-${archiveSha256}`;
const replacementOperationId = (archiveSha256: string) => `import-replacement-${archiveSha256}`;

const parsePayload = (value: string): ImportPayload => {
  const parsed: unknown = JSON.parse(value);
  if (
    typeof parsed !== 'object' || parsed === null ||
    !('version' in parsed) || parsed.version !== 1 ||
    !('mode' in parsed) ||
      (parsed.mode !== 'selective' && parsed.mode !== 'additive' && parsed.mode !== 'replacement' && parsed.mode !== 'undo') ||
    !('archiveUri' in parsed) || typeof parsed.archiveUri !== 'string' ||
    !('archiveSha256' in parsed) || typeof parsed.archiveSha256 !== 'string' ||
    !('selectedNoteIds' in parsed) || !Array.isArray(parsed.selectedNoteIds) ||
    !parsed.selectedNoteIds.every((id): id is string => typeof id === 'string')
  ) {
    throw new Error('INVALID_IMPORT_OPERATION');
  }
  return {
    version: 1,
    mode: parsed.mode,
    archiveUri: parsed.archiveUri,
    archiveSha256: parsed.archiveSha256,
    selectedNoteIds: parsed.selectedNoteIds,
  };
};

const liveDatabaseUri = async () => `file://${(await getDb()).databasePath}`;

class ImportOperationHandler implements BackupOperationHandler {
  result: ImportResult | FullReplacementResult | FullReplacementUndoResult | null = null;

  async nextStep(operation: Parameters<BackupOperationHandler['nextStep']>[0]) {
    if (operation.checkpoint) return null;
    const payload = parsePayload(operation.payload);
    return {
      name: payload.mode === 'undo'
        ? 'verify_and_undo_replacement'
        : payload.mode === 'replacement'
          ? 'validate_snapshot_and_replace'
          : payload.mode === 'additive' ? 'validate_and_commit_additive' : 'validate_and_commit_selected',
    };
  }

  async runStep({ operation, idempotencyKey }: Parameters<BackupOperationHandler['runStep']>[0]) {
    const mediaDirectoryUri = FileSystem.documentDirectory;
    if (!mediaDirectoryUri) {
      return { outcome: 'failed', code: 'STORAGE_UNAVAILABLE', message: 'App storage is unavailable.' } as const;
    }
    try {
      const payload = parsePayload(operation.payload);
      if (payload.mode === 'undo') {
        const snapshotId = payload.archiveSha256;
        await closeDb();
        try {
          this.result = await commitFullReplacementUndo(snapshotId);
        } finally {
          await initDb();
        }
        return { outcome: 'committed', checkpoint: 'full_replacement_undone', done: true } as const;
      }
      if (payload.mode === 'replacement') {
        const databaseUri = await liveDatabaseUri();
        await closeDb();
        try {
          this.result = await commitFullReplacementArchiveImport({
            archiveUri: payload.archiveUri,
            archiveSha256: payload.archiveSha256,
            databaseUri,
            mediaDirectoryUri,
            operationKey: idempotencyKey,
          });
        } finally {
          await initDb();
        }
        return { outcome: 'committed', checkpoint: 'full_replacement_committed', done: true } as const;
      }
      this.result = await commitSelectiveArchiveImport({
        archiveUri: payload.archiveUri,
        archiveSha256: payload.archiveSha256,
        selectedNoteIds: payload.selectedNoteIds,
        databaseUri: await liveDatabaseUri(),
        mediaDirectoryUri,
        operationKey: idempotencyKey,
      });
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
    const payload = parsePayload(operation.payload);
    if (payload.mode === 'replacement' || payload.mode === 'undo') {
      await closeDb();
      try {
        await recoverInterruptedFullReplacement();
      } finally {
        await initDb();
      }
    }
    const committed = payload.mode === 'undo'
      ? await hasFullReplacementUndoReceipt(payload.archiveSha256)
      : await hasArchiveImportReceipt(await liveDatabaseUri(), idempotencyKey);
    if (committed) {
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

const unavailableHandler: BackupOperationHandler = {
  async nextStep() { return null; },
  async runStep() { return { outcome: 'failed', code: 'UNAVAILABLE', message: 'Operation is unavailable.' }; },
  async recoverInterruptedStep() {
    return { outcome: 'unknown', code: 'OTHER_OPERATION_INTERRUPTED', message: 'Another backup operation needs review.' };
  },
};

const store = new SqliteBackupOperationStore();
const importHandler = new ImportOperationHandler();
const coordinator = new BackupOperationCoordinator(store, {
  export: unavailableHandler,
  import: importHandler,
  managed_retention: unavailableHandler,
  automatic_backup: unavailableHandler,
}, { maxAttemptsPerStep: 1 });

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
  preview: ImportPreview,
  selectedNoteIds: readonly string[],
  mode: ImportMode,
): Promise<ImportResult | FullReplacementResult | FullReplacementUndoResult> => {
  const active = await store.getActive();
  if (active?.kind === 'import') await coordinator.resume();
  importHandler.result = null;
  const payload: ImportPayload = {
    version: 1,
    mode,
    archiveUri: preview.archiveUri,
    archiveSha256: preview.archiveSha256,
    selectedNoteIds: [...new Set(selectedNoteIds)].sort(),
  };
  const id = mode === 'additive'
    ? additiveOperationId(preview.archiveSha256)
    : mode === 'replacement' ? replacementOperationId(preview.archiveSha256)
      : mode === 'undo' ? `undo-replacement-${preview.archiveSha256}` : selectiveOperationId();
  const existing = await store.get(id);
  const operation = existing?.state === 'failed' || existing?.state === 'interrupted'
    ? await coordinator.retry(id)
    : existing ?? await coordinator.start(id, 'import', JSON.stringify(payload));
  if (operation.state !== 'succeeded') {
    const error = new Error(operation.errorMessage ?? 'IMPORT_FAILED');
    Object.assign(error, { code: operation.errorCode ?? 'IMPORT_FAILED' });
    throw error;
  }
  if (importHandler.result) return importHandler.result;

  if (mode === 'undo') return commitFullReplacementUndo(payload.archiveSha256);
  if (mode === 'replacement') {
    const databaseUri = await liveDatabaseUri();
    await closeDb();
    try {
      return await commitFullReplacementArchiveImport({
        archiveUri: payload.archiveUri,
        archiveSha256: payload.archiveSha256,
        databaseUri,
        mediaDirectoryUri: FileSystem.documentDirectory ?? '',
        operationKey: `${id}:start:validate_snapshot_and_replace`,
      });
    } finally {
      await initDb();
    }
  }
  if (mode === 'additive') {
    return commitSelectiveArchiveImport({
      archiveUri: payload.archiveUri,
      archiveSha256: payload.archiveSha256,
      selectedNoteIds: payload.selectedNoteIds,
      databaseUri: await liveDatabaseUri(),
      mediaDirectoryUri: FileSystem.documentDirectory ?? '',
      operationKey: `${id}:start:validate_and_commit_additive`,
    });
  }
  return {
    alreadyCommitted: true,
    importedCount: 0,
    recoveredCount: 0,
    skippedCount: 0,
    restrictedAudioCount: 0,
    restrictedFileCount: 0,
    recoveryComplete: true,
  };
};

const requireNonDestructiveResult = (result: ImportResult | FullReplacementResult | FullReplacementUndoResult): ImportResult => {
  if (!('importedCount' in result)) throw new Error('IMPORT_RESULT_MISSING');
  return result;
};

export const importSelectedNotes = async (preview: ImportPreview, selectedNoteIds: readonly string[]): Promise<ImportResult> =>
  requireNonDestructiveResult(await importNotes(preview, selectedNoteIds, 'selective'));

export const importAllNotesAdditively = async (preview: ImportPreview): Promise<ImportResult> =>
  requireNonDestructiveResult(await importNotes(preview, preview.notes.map((note) => note.portableId), 'additive'));

export const importAllNotesByReplacement = async (preview: ImportPreview): Promise<FullReplacementResult> => {
  const result = await importNotes(preview, [], 'replacement');
  if (!('restoredNoteCount' in result)) throw new Error('FULL_REPLACEMENT_RESULT_MISSING');
  return result;
};

export const loadFullReplacementUndo = (): Promise<FullReplacementUndo> => getFullReplacementUndo();

export const isFullReplacementUndoAvailable = (undo: FullReplacementUndo, now: number): boolean =>
  undo.state === 'available' && undo.expiresAt !== null && isWithinFullReplacementUndoWindow(undo.expiresAt, now);

export const undoFullReplacement = async (undo: FullReplacementUndo): Promise<FullReplacementUndoResult> => {
  if (!undo.snapshotId || !isFullReplacementUndoAvailable(undo, Date.now())) throw new Error('UNDO_UNAVAILABLE');
  const syntheticPreview = {
    archiveUri: '', archiveSha256: undo.snapshotId, createdAt: '', notes: [],
  } satisfies ImportPreview;
  const result = await importNotes(syntheticPreview, [], 'undo');
  if (!('alreadyUndone' in result)) throw new Error('UNDO_RESULT_MISSING');
  return result;
};
