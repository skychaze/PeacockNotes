import { createDiscoveryCache, type DiscoveryCacheSnapshot } from '../backup/discoveryCache';
import { getBackupFolderState, type BackupFolderState } from './backupFolder';
import { scanBackupCollection, type BackupCollectionScan } from './archive';

export type BackupDiscoveryValue = Readonly<{
  folder: BackupFolderState;
  collection: BackupCollectionScan | null;
  scanError: unknown | null;
}>;

const initialValue: BackupDiscoveryValue = {
  folder: { status: 'disconnected', uri: null, name: null },
  collection: null,
  scanError: null,
};

const cache = createDiscoveryCache(initialValue, async () => {
  const folder = await getBackupFolderState();
  if (folder.status !== 'connected') {
    return { folder, collection: null, scanError: null };
  }
  try {
    return { folder, collection: await scanBackupCollection(), scanError: null };
  } catch (error: unknown) {
    // Folder authorization is still useful even when a provider scan fails.
    // Keep the folder state ready and let the UI show the scan-specific error.
    return { folder, collection: null, scanError: error };
  }
});

export const getBackupDiscoverySnapshot = (): DiscoveryCacheSnapshot<BackupDiscoveryValue> =>
  cache.getSnapshot();

export const subscribeBackupDiscovery = (listener: (snapshot: DiscoveryCacheSnapshot<BackupDiscoveryValue>) => void) =>
  cache.subscribe(listener);

export const initializeBackupDiscovery = () => cache.ensure();

export const refreshBackupDiscovery = () => cache.refresh();

export const invalidateBackupDiscovery = () => cache.invalidate();

/** Remove deleted immutable archive IDs immediately, before eventual-consistency refresh. */
export const removeBackupDiscoveryArchives = (uris: readonly string[]) => {
  const removed = new Set(uris);
  cache.update((value) => value.collection
    ? {
        ...value,
        collection: {
          ...value.collection,
          archives: value.collection.archives.filter((archive) => !removed.has(archive.uri)),
        },
      }
    : value);
};
