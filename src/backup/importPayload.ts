export type ArchiveImportMode = 'selective' | 'additive' | 'replacement';

export type ArchiveImportPayload = Readonly<{
  version: 1;
  mode: ArchiveImportMode;
  archiveUri: string;
  archiveSha256: string;
  selectedNoteIds: readonly string[];
  recoveredTitleSuffix?: string;
}>;

export type UndoImportPayload = Readonly<{
  version: 1;
  mode: 'undo';
  snapshotId: string;
}>;

export type ImportPayload = ArchiveImportPayload | UndoImportPayload;

const isStringArray = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every((item): item is string => typeof item === 'string');

const invalidPayload = (): never => {
  throw new Error('INVALID_IMPORT_OPERATION');
};

export const parseImportPayload = (value: string): ImportPayload => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    return invalidPayload();
  }
  if (typeof parsed !== 'object' || parsed === null || !('version' in parsed) || parsed.version !== 1 || !('mode' in parsed)) {
    return invalidPayload();
  }
  if (parsed.mode === 'undo') {
    if ('snapshotId' in parsed && typeof parsed.snapshotId === 'string') {
      return { version: 1, mode: 'undo', snapshotId: parsed.snapshotId };
    }
    if ('archiveSha256' in parsed && typeof parsed.archiveSha256 === 'string') {
      return { version: 1, mode: 'undo', snapshotId: parsed.archiveSha256 };
    }
    return invalidPayload();
  }
  if (
    (parsed.mode !== 'selective' && parsed.mode !== 'additive' && parsed.mode !== 'replacement') ||
    !('archiveUri' in parsed) || typeof parsed.archiveUri !== 'string' ||
    !('archiveSha256' in parsed) || typeof parsed.archiveSha256 !== 'string' ||
    !('selectedNoteIds' in parsed) || !isStringArray(parsed.selectedNoteIds)
  ) {
    return invalidPayload();
  }
  return {
    version: 1,
    mode: parsed.mode,
    archiveUri: parsed.archiveUri,
    archiveSha256: parsed.archiveSha256,
    selectedNoteIds: parsed.selectedNoteIds,
    recoveredTitleSuffix: 'recoveredTitleSuffix' in parsed && typeof parsed.recoveredTitleSuffix === 'string'
      ? parsed.recoveredTitleSuffix
      : undefined,
  };
};

export const createArchiveImportPayload = (
  mode: ArchiveImportMode,
  archiveUri: string,
  archiveSha256: string,
  selectedNoteIds: readonly string[],
  recoveredTitleSuffix?: string,
): ArchiveImportPayload => ({
  version: 1,
  mode,
  archiveUri,
  archiveSha256,
  selectedNoteIds: [...new Set(selectedNoteIds)].sort(),
  ...(recoveredTitleSuffix ? { recoveredTitleSuffix } : {}),
});

export const createUndoImportPayload = (snapshotId: string): UndoImportPayload => ({
  version: 1,
  mode: 'undo',
  snapshotId,
});

export const importStepName = (payload: ImportPayload): string =>
  payload.mode === 'undo'
    ? 'verify_and_undo_replacement'
    : payload.mode === 'replacement'
      ? 'validate_snapshot_and_replace'
      : payload.mode === 'additive' ? 'validate_and_commit_additive' : 'validate_and_commit_selected';
