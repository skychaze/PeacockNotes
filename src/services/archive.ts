import { NativeModules, Platform } from 'react-native';
import type { BackupProgressOwner } from './backupProgress';

export const ARCHIVE_FORMAT_VERSION = 1 as const;
export const ARCHIVE_DATABASE_VERSION = 2 as const;

export type ArchiveMediaKind = 'audio' | 'file';

export type ArchiveMediaSource = Readonly<{
  portableId: string;
  sourceUri: string;
  kind: ArchiveMediaKind;
}>;

export type CreateArchiveRequest = Readonly<{
  databaseUri: string;
  destinationUri: string;
  media: readonly ArchiveMediaSource[];
  contentRevision: number;
  createdAt: string;
  operationId?: string;
  operationKind?: string;
}>;

export type ArchiveLimits = Readonly<{
  maxArchiveBytes?: number;
  maxExpandedBytes?: number;
  maxDatabaseBytes?: number;
  maxMediaBytes?: number;
  maxMediaItemBytes?: number;
  maxMediaItems?: number;
  maxEntries?: number;
}>;

export type ArchiveInventoryEntry = Readonly<{
  path: string;
  sha256: string;
  size: number;
}>;

export type ArchiveSummary = Readonly<{
  formatVersion: number;
  databaseVersion: number;
  createdAt: string;
  contentRevision: number;
  archiveSha256: string;
  archiveBytes: number;
  expandedBytes: number;
  mediaItems: number;
  inventory: readonly ArchiveInventoryEntry[];
}>;

export type PinMediaRequest = Readonly<{
  directoryUri: string;
  media: readonly ArchiveMediaSource[];
  operationId?: string;
  operationKind?: string;
}>;

export type ValidateArchiveRequest = Readonly<{
  archiveUri: string;
  stagingDirectoryUri?: string;
  limits?: ArchiveLimits;
  mode?: ArchiveValidationMode;
  operationId?: string;
  operationKind?: string;
}>;

export type ArchiveValidationMode = 'stage' | 'verify_only';

export type ArchiveHealth = 'valid' | 'incompatible' | 'damaged' | 'uncertain';
export type ArchiveVerification = 'verified' | 'failed' | 'not_verified';
export type ArchiveCompatibility = 'compatible' | 'incompatible' | 'unknown';

export type BackupCollectionArchive = Readonly<{
  uri: string;
  name: string;
  bytes: number | null;
  createdAt: string | null;
  providerModifiedAt: number | null;
  state: ArchiveHealth;
  verification: ArchiveVerification;
  compatibility: ArchiveCompatibility;
}>;

export type BackupCollectionScan = Readonly<{
  complete: boolean;
  archives: readonly BackupCollectionArchive[];
}>;

export type ManagedRetentionResult = Readonly<{
  status: 'applied' | 'nothing_to_prune';
  deletedCount: number;
  retainedVerifiedCount: number;
}>;

export type ArchivedNotePreview = Readonly<{
  portableId: string;
  folderPortableId: string;
  // Only present in previews from binaries that predate the folder tree.
  folderName?: string;
  title: string;
  contentPreview: string;
  updatedAt: string;
  audioCount: number;
  fileCount: number;
}>;

export type ArchivedFolderPreview = Readonly<{
  portableId: string;
  parentPortableId: string | null;
  name: string;
  path: readonly string[];
  sortOrder: number;
}>;

export type ImportPreview = Readonly<{
  archiveUri: string;
  archiveSha256: string;
  createdAt: string;
  folders: readonly ArchivedFolderPreview[];
  notes: readonly ArchivedNotePreview[];
}>;

export type CommitSelectiveImportRequest = Readonly<{
  archiveUri: string;
  archiveSha256: string;
  databaseUri: string;
  mediaDirectoryUri: string;
  operationKey: string;
  selectedNoteIds: readonly string[];
  recoveredTitleSuffix?: string;
  operationId?: string;
  operationKind?: string;
}>;

export type RecoveryRestriction = Readonly<{
  restrictedAudioCount: number;
  restrictedFileCount: number;
  recoveryComplete: boolean;
}>;

export type ImportResult = Readonly<{
  alreadyCommitted: boolean;
  importedCount: number;
  recoveredCount: number;
  skippedCount: number;
}> & RecoveryRestriction;

export type FullReplacementRequest = Readonly<{
  archiveUri: string;
  archiveSha256: string;
  databaseUri: string;
  mediaDirectoryUri: string;
  operationKey: string;
  operationId?: string;
  operationKind?: string;
}>;

export type FullReplacementResult = Readonly<{
  alreadyCommitted: boolean;
  restoredNoteCount: number;
  safetySnapshotId: string;
}> & RecoveryRestriction;

export type FullReplacementUndo = Readonly<{
  state: 'none' | 'available' | 'expired' | 'unavailable' | 'damaged';
  snapshotId: string | null;
  expiresAt: number | null;
}>;

export type FullReplacementUndoResult = Readonly<{ alreadyUndone: boolean }>;

type NativeArchiveModule = {
  pinMedia(request: PinMediaRequest): Promise<readonly ArchiveMediaSource[]>;
  createArchive(request: CreateArchiveRequest): Promise<ArchiveSummary>;
  validateArchive(request: ValidateArchiveRequest): Promise<ArchiveSummary>;
  scanConnectedFolder(): Promise<BackupCollectionScan>;
  scanConnectedFolderDeep(): Promise<BackupCollectionScan>;
  deleteArchives(request: Readonly<{ uris: readonly string[] }>): Promise<Readonly<{ deletedCount: number }>>;
  applyManagedRetention(request: Partial<BackupProgressOwner>): Promise<ManagedRetentionResult>;
  previewImport(request: Readonly<{ archiveUri: string } & Partial<BackupProgressOwner>>): Promise<ImportPreview>;
  commitSelectiveImport(request: CommitSelectiveImportRequest): Promise<ImportResult>;
  commitFullReplacement(request: FullReplacementRequest): Promise<FullReplacementResult>;
  recoverFullReplacement(): Promise<Readonly<{ rolledBack: boolean }>>;
  getFullReplacementUndo(): Promise<FullReplacementUndo>;
  undoFullReplacement(request: Readonly<{ snapshotId: string }>): Promise<FullReplacementUndoResult>;
  hasFullReplacementUndoReceipt(request: Readonly<{ snapshotId: string }>): Promise<Readonly<{ committed: boolean }>>;
  getImportReceiptResult(request: Readonly<{ databaseUri: string; operationKey: string }>): Promise<ImportResult | FullReplacementResult | null>;
};

const nativeArchive = NativeModules.Archive as NativeArchiveModule | undefined;

const moduleOrThrow = (): NativeArchiveModule => {
  if (Platform.OS !== 'android' || !nativeArchive) {
    throw new Error('The archive engine is available only in the Android development build.');
  }
  return nativeArchive;
};

export const pinMedia = (request: PinMediaRequest): Promise<readonly ArchiveMediaSource[]> =>
  moduleOrThrow().pinMedia(request);

export const createArchive = (request: CreateArchiveRequest): Promise<ArchiveSummary> =>
  moduleOrThrow().createArchive(request);

export const validateArchive = (request: ValidateArchiveRequest): Promise<ArchiveSummary> =>
  moduleOrThrow().validateArchive(request);

export const scanBackupCollection = (deepValidation = false): Promise<BackupCollectionScan> =>
  deepValidation ? moduleOrThrow().scanConnectedFolderDeep() : moduleOrThrow().scanConnectedFolder();

export const deleteBackupArchives = async (uris: readonly string[]): Promise<number> => {
  if (uris.length === 0) return 0;
  const result = await moduleOrThrow().deleteArchives({ uris });
  return result.deletedCount;
};

export const applyManagedArchiveRetention = (progress?: BackupProgressOwner): Promise<ManagedRetentionResult> =>
  moduleOrThrow().applyManagedRetention({ ...progress });

export const previewArchiveImport = (archiveUri: string, progress?: BackupProgressOwner): Promise<ImportPreview> =>
  moduleOrThrow().previewImport({ archiveUri, ...progress });

export const commitSelectiveArchiveImport = (request: CommitSelectiveImportRequest): Promise<ImportResult> =>
  moduleOrThrow().commitSelectiveImport(request);

export const commitFullReplacementArchiveImport = (request: FullReplacementRequest): Promise<FullReplacementResult> =>
  moduleOrThrow().commitFullReplacement(request);

export const recoverInterruptedFullReplacement = (): Promise<boolean> =>
  moduleOrThrow().recoverFullReplacement().then((result) => result.rolledBack);

export const getFullReplacementUndo = (): Promise<FullReplacementUndo> =>
  moduleOrThrow().getFullReplacementUndo();

export const commitFullReplacementUndo = (snapshotId: string): Promise<FullReplacementUndoResult> =>
  moduleOrThrow().undoFullReplacement({ snapshotId });

export const hasFullReplacementUndoReceipt = (snapshotId: string): Promise<boolean> =>
  moduleOrThrow().hasFullReplacementUndoReceipt({ snapshotId }).then((result) => result.committed);

export const getArchiveImportReceiptResult = (
  databaseUri: string,
  operationKey: string,
): Promise<ImportResult | FullReplacementResult | null> =>
  moduleOrThrow().getImportReceiptResult({ databaseUri, operationKey });
