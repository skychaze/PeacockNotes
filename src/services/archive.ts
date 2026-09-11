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

type NativeArchiveModule = {
  pinMedia(request: PinMediaRequest): Promise<readonly ArchiveMediaSource[]>;
  createArchive(request: CreateArchiveRequest): Promise<ArchiveSummary>;
  validateArchive(request: ValidateArchiveRequest): Promise<ArchiveSummary>;
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
