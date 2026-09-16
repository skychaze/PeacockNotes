import {
  createArchiveImportPayload,
  createUndoImportPayload,
  importStepName,
  parseImportPayload,
} from './importPayload';
import { createBackupOperationStepKey } from './types';

const assert = (condition: boolean, message: string) => {
  if (!condition) throw new Error(message);
};

export function testUndoPayloadUsesSnapshotId() {
  const payload = createUndoImportPayload('snapshot-123');
  assert(payload.snapshotId === 'snapshot-123', 'undo payload lost its snapshot id');
  assert(!('archiveSha256' in payload), 'undo snapshot id was stored as an archive hash');
  assert(importStepName(payload) === 'verify_and_undo_replacement', 'undo step changed');
  assert(
    createBackupOperationStepKey('import-1', null, importStepName(payload)) ===
      'import-1:start:verify_and_undo_replacement',
    'receipt lookup did not use the undo step idempotency key',
  );
}

export function testLegacyUndoPayloadCanStillRecover() {
  const payload = parseImportPayload(JSON.stringify({
    version: 1,
    mode: 'undo',
    archiveUri: '',
    archiveSha256: 'legacy-snapshot',
    selectedNoteIds: [],
  }));
  assert(payload.mode === 'undo' && payload.snapshotId === 'legacy-snapshot', 'legacy undo payload cannot recover');
}

export function testRecoveredTitleSuffixSurvivesRetries() {
  const payload = createArchiveImportPayload('selective', 'file://archive', 'hash', ['note'], ' (রিকভার্ড কপি)');
  const parsed = parseImportPayload(JSON.stringify(payload));
  assert(parsed.mode !== 'undo' && parsed.recoveredTitleSuffix === ' (রিকভার্ড কপি)', 'recovered title suffix was not persisted');
}

export function runImportPayloadTests() {
  testUndoPayloadUsesSnapshotId();
  testLegacyUndoPayloadCanStillRecover();
  testRecoveredTitleSuffixSurvivesRetries();
}

void Promise.resolve(runImportPayloadTests()).catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
