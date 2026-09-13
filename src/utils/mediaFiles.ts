import * as FileSystem from 'expo-file-system/legacy';

const MANAGED_DIRECTORIES = ['audio', 'files'] as const;

const getManagedRoots = () => {
  const documentDirectory = FileSystem.documentDirectory;
  if (!documentDirectory) {
    return [];
  }
  return MANAGED_DIRECTORIES.map((directory) => `${documentDirectory}${directory}/`);
};

const isManagedMediaUri = (uri: string) => {
  return getManagedRoots().some((root) => uri.startsWith(root));
};

let mediaDeletionPauseDepth = 0;
const deferredMediaUris = new Set<string>();
let mediaDeletionQueue: Promise<void> = Promise.resolve();

const normalizeMediaUris = (uris: Iterable<string | null | undefined>): string[] => {
  const uniqueUris = new Set<string>();
  for (const uri of uris) {
    if (uri && isManagedMediaUri(uri)) {
      uniqueUris.add(uri);
    }
  }
  return [...uniqueUris];
};

const deleteImmediately = async (uris: readonly string[]): Promise<void> => {
  for (const uri of uris) {
    try {
      await FileSystem.deleteAsync(uri, { idempotent: true });
    } catch (error) {
      console.warn('Failed to delete media file:', uri, error);
    }
  }
};

const enqueueDeletion = (uris: readonly string[]): Promise<void> => {
  const next = mediaDeletionQueue.then(() => deleteImmediately(uris));
  mediaDeletionQueue = next.catch(() => undefined);
  return next;
};

/** Keeps app-owned media until a backup has captured both its database row and file. */
export const withMediaDeletionPaused = async <T>(work: () => Promise<T>): Promise<T> => {
  mediaDeletionPauseDepth += 1;
  try {
    await mediaDeletionQueue;
    return await work();
  } finally {
    mediaDeletionPauseDepth -= 1;
    if (mediaDeletionPauseDepth === 0 && deferredMediaUris.size > 0) {
      const uris = [...deferredMediaUris];
      deferredMediaUris.clear();
      await enqueueDeletion(uris);
    }
  }
};

/** Deletes app-owned audio/files; ignores URIs outside the app's media folders. */
export const deleteMediaFiles = async (uris: Iterable<string | null | undefined>): Promise<void> => {
  const normalizedUris = normalizeMediaUris(uris);
  if (normalizedUris.length === 0) return;
  if (mediaDeletionPauseDepth > 0) {
    normalizedUris.forEach((uri) => deferredMediaUris.add(uri));
    return;
  }
  await enqueueDeletion(normalizedUris);
};
