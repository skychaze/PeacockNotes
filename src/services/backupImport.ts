import * as FileSystem from 'expo-file-system/legacy';
import * as DocumentPicker from 'expo-document-picker';
import { BackupOperationCoordinator, SqliteBackupOperationStore, type BackupOperationHandler } from '../backup';
import { getDb } from '../database/schema';
import {
  commitSelectiveArchiveImport,
  hasArchiveImportReceipt,
  previewArchiveImport,
  type ImportPreview,
  type ImportResult,
} from './archive';

type ImportMode = 'selective' | 'additive';

type ImportPayload = Readonly<{
  version: 1;
  mode: ImportMode;
  archiveUri: string;
  archiveSha256: string;
  selectedNoteIds: readonly string[];
}>;

const selectiveOperationId = () => `import-${Date.now()}-${Math.random().toString(36).slice(2)}`;
const additiveOperationId = (archiveSha256: string) => `import-additive-${archiveSha256}`;

const parsePayload = (value: string): ImportPayload => {
  const parsed: unknown = JSON.parse(value);
  if (
    typeof parsed !== 'object' || parsed === null ||
    !('version' in parsed) || parsed.version !== 1 ||
    !('mode' in parsed) || (parsed.mode !== 'selective' && parsed.mode !== 'additive') ||
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
  result: ImportResult | null = null;

  async nextStep(operation: Parameters<BackupOperationHandler['nextStep']>[0]) {
    if (operation.checkpoint) return null;
    const payload = parsePayload(operation.payload);
    return { name: payload.mode === 'additive' ? 'validate_and_commit_additive' : 'validate_and_commit_selected' };
  }

  async runStep({ operation, idempotencyKey }: Parameters<BackupOperationHandler['runStep']>[0]) {
    const mediaDirectoryUri = FileSystem.documentDirectory;
    if (!mediaDirectoryUri) {
      return { outcome: 'failed', code: 'STORAGE_UNAVAILABLE', message: 'App storage is unavailable.' } as const;
    }
    try {
      const payload = parsePayload(operation.payload);
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
    const committed = await hasArchiveImportReceipt(await liveDatabaseUri(), idempotencyKey);
    if (committed) return { outcome: 'committed', checkpoint: 'selected_batch_committed', done: true } as const;
    parsePayload(operation.payload);
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
): Promise<ImportResult> => {
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
  const id = mode === 'additive' ? additiveOperationId(preview.archiveSha256) : selectiveOperationId();
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
  return { alreadyCommitted: true, importedCount: 0, recoveredCount: 0, skippedCount: 0 };
};

export const importSelectedNotes = (preview: ImportPreview, selectedNoteIds: readonly string[]) =>
  importNotes(preview, selectedNoteIds, 'selective');

export const importAllNotesAdditively = (preview: ImportPreview) =>
  importNotes(preview, preview.notes.map((note) => note.portableId), 'additive');
