import {
  automaticBackupIntervalMs,
  isAutomaticBackupDue,
  shouldRetryAutomaticBackup,
} from './automaticPolicy';

const assert = (condition: boolean, message: string) => {
  if (!condition) throw new Error(message);
};

const now = Date.UTC(2026, 0, 2);
const folderUri = 'drive://folder-a';
const intervalHours = 3;
const intervalMs = automaticBackupIntervalMs(intervalHours);

assert(!isAutomaticBackupDue({
  currentRevision: 2,
  lastVerifiedRevision: 1,
  lastVerifiedAt: now - intervalMs + 1,
  currentFolderUri: folderUri,
  lastVerifiedFolderUri: folderUri,
  intervalHours,
  now,
}), 'changed content must not be due before the selected interval');

assert(isAutomaticBackupDue({
  currentRevision: 2,
  lastVerifiedRevision: 1,
  lastVerifiedAt: now - intervalMs,
  currentFolderUri: folderUri,
  lastVerifiedFolderUri: folderUri,
  intervalHours,
  now,
}), 'changed content must be due at the selected interval boundary');

assert(!isAutomaticBackupDue({
  currentRevision: 2,
  lastVerifiedRevision: 2,
  lastVerifiedAt: now - intervalMs,
  currentFolderUri: folderUri,
  lastVerifiedFolderUri: folderUri,
  intervalHours,
  now,
}), 'unchanged content must not be due');

assert(isAutomaticBackupDue({
  currentRevision: 1,
  lastVerifiedRevision: null,
  lastVerifiedAt: null,
  currentFolderUri: folderUri,
  now,
}), 'content without a verified archive must be due');

assert(!isAutomaticBackupDue({
  currentRevision: 0,
  lastVerifiedRevision: null,
  lastVerifiedAt: null,
  currentFolderUri: folderUri,
  now,
}), 'an empty unchanged database must not be due');

assert(isAutomaticBackupDue({
  currentRevision: 2,
  lastVerifiedRevision: 2,
  lastVerifiedAt: now - intervalMs,
  currentFolderUri: 'drive://folder-b',
  lastVerifiedFolderUri: folderUri,
  intervalHours,
  now,
}), 'a different connected folder must require a fresh recovery point');

assert(!isAutomaticBackupDue({
  currentRevision: 2,
  lastVerifiedRevision: 1,
  lastVerifiedAt: now - automaticBackupIntervalMs(24) + 1,
  currentFolderUri: folderUri,
  lastVerifiedFolderUri: folderUri,
  now,
}), 'missing interval must fall back to 24 hours');

assert(shouldRetryAutomaticBackup('PROVIDER_WRITE_FAILED', 1), 'a transient provider failure should retry');
assert(shouldRetryAutomaticBackup('PROVIDER_WRITE_FAILED', 2), 'the final bounded retry should be allowed');
assert(!shouldRetryAutomaticBackup('PROVIDER_WRITE_FAILED', 3), 'automatic backup exceeded its retry limit');
assert(!shouldRetryAutomaticBackup('FOLDER_PERMISSION_REVOKED', 1), 'permission failures must wait for user action');
