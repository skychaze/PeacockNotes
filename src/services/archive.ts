import { NativeModules, Platform } from 'react-native';

export const ARCHIVE_FORMAT_VERSION = 1 as const;
export const ARCHIVE_DATABASE_VERSION = 1 as const;

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
}>;

export type ValidateArchiveRequest = Readonly<{
  archiveUri: string;
  stagingDirectoryUri?: string;
  limits?: ArchiveLimits;
}>;

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

export type ArchivedNotePreview = Readonly<{
  portableId: string;
  title: string;
  contentPreview: string;
  updatedAt: string;
  folderName: string;
  audioCount: number;
  fileCount: number;
}>;

export type ImportPreview = Readonly<{
  archiveUri: string;
  archiveSha256: string;
  createdAt: string;
  notes: readonly ArchivedNotePreview[];
}>;

export type CommitSelectiveImportRequest = Readonly<{
  archiveUri: string;
  archiveSha256: string;
  databaseUri: string;
  mediaDirectoryUri: string;
  operationKey: string;
  selectedNoteIds: readonly string[];
}>;

export type ImportResult = Readonly<{
  alreadyCommitted: boolean;
  importedCount: number;
  recoveredCount: number;
  skippedCount: number;
}>;

type NativeArchiveModule = {
  pinMedia(request: PinMediaRequest): Promise<readonly ArchiveMediaSource[]>;
  createArchive(request: CreateArchiveRequest): Promise<ArchiveSummary>;
  validateArchive(request: ValidateArchiveRequest): Promise<ArchiveSummary>;
  scanConnectedFolder(): Promise<BackupCollectionScan>;
  previewImport(request: Readonly<{ archiveUri: string }>): Promise<ImportPreview>;
  commitSelectiveImport(request: CommitSelectiveImportRequest): Promise<ImportResult>;
  hasImportReceipt(request: Readonly<{ databaseUri: string; operationKey: string }>): Promise<Readonly<{ committed: boolean }>>;
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

export const scanBackupCollection = (): Promise<BackupCollectionScan> =>
  moduleOrThrow().scanConnectedFolder();

export const previewArchiveImport = (archiveUri: string): Promise<ImportPreview> =>
  moduleOrThrow().previewImport({ archiveUri });

export const commitSelectiveArchiveImport = (request: CommitSelectiveImportRequest): Promise<ImportResult> =>
  moduleOrThrow().commitSelectiveImport(request);

export const hasArchiveImportReceipt = (databaseUri: string, operationKey: string): Promise<boolean> =>
  moduleOrThrow().hasImportReceipt({ databaseUri, operationKey }).then((result) => result.committed);
