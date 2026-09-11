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

type ImportPayload = Readonly<{
  version: 1;
  archiveUri: string;
  archiveSha256: string;
  selectedNoteIds: readonly string[];
}>;

const operationId = () => `import-${Date.now()}-${Math.random().toString(36).slice(2)}`;

const parsePayload = (value: string): ImportPayload => {
  const parsed: unknown = JSON.parse(value);
  if (
    typeof parsed !== 'object' || parsed === null ||
    !('version' in parsed) || parsed.version !== 1 ||
    !('archiveUri' in parsed) || typeof parsed.archiveUri !== 'string' ||
    !('archiveSha256' in parsed) || typeof parsed.archiveSha256 !== 'string' ||
    !('selectedNoteIds' in parsed) || !Array.isArray(parsed.selectedNoteIds) ||
    !parsed.selectedNoteIds.every((id): id is string => typeof id === 'string')
  ) {
    throw new Error('INVALID_IMPORT_OPERATION');
  }
  return {
    version: 1,
    archiveUri: parsed.archiveUri,
    archiveSha256: parsed.archiveSha256,
    selectedNoteIds: parsed.selectedNoteIds,
  };
};

const liveDatabaseUri = async () => `file://${(await getDb()).databasePath}`;

class ImportOperationHandler implements BackupOperationHandler {
  result: ImportResult | null = null;

  async nextStep(operation: Parameters<BackupOperationHandler['nextStep']>[0]) {
    return operation.checkpoint ? null : { name: 'validate_and_commit_selected' };
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
      const message = error instanceof Error ? error.message : 'Selective import failed.';
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

export const importSelectedNotes = async (
  preview: ImportPreview,
  selectedNoteIds: readonly string[],
): Promise<ImportResult> => {
  const active = await store.getActive();
  if (active?.kind === 'import') await coordinator.resume();
  importHandler.result = null;
  const payload: ImportPayload = {
    version: 1,
    archiveUri: preview.archiveUri,
    archiveSha256: preview.archiveSha256,
    selectedNoteIds: [...new Set(selectedNoteIds)].sort(),
  };
  const operation = await coordinator.start(operationId(), 'import', JSON.stringify(payload));
  if (operation.state !== 'succeeded') {
    const error = new Error(operation.errorMessage ?? 'IMPORT_FAILED');
    Object.assign(error, { code: operation.errorCode ?? 'IMPORT_FAILED' });
    throw error;
  }
  return importHandler.result ?? { alreadyCommitted: true, importedCount: 0, recoveredCount: 0 };
};
