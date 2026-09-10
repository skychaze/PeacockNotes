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

/** Deletes app-owned audio/files; ignores URIs outside the app's media folders. */
export const deleteMediaFiles = async (uris: Iterable<string | null | undefined>): Promise<void> => {
  const uniqueUris = new Set<string>();
  for (const uri of uris) {
    if (uri && isManagedMediaUri(uri)) {
      uniqueUris.add(uri);
    }
  }

  for (const uri of uniqueUris) {
    try {
      await FileSystem.deleteAsync(uri, { idempotent: true });
    } catch (error) {
      console.warn('Failed to delete media file:', uri, error);
    }
  }
};
