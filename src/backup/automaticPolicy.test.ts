import {
  AUTOMATIC_BACKUP_INTERVAL_MS,
  isAutomaticBackupDue,
  shouldRetryAutomaticBackup,
} from './automaticPolicy';

const assert = (condition: boolean, message: string) => {
  if (!condition) throw new Error(message);
};

const now = Date.UTC(2026, 0, 2);

assert(!isAutomaticBackupDue({
  currentRevision: 2,
  lastVerifiedRevision: 1,
  lastVerifiedAt: now - AUTOMATIC_BACKUP_INTERVAL_MS + 1,
  now,
}), 'changed content must not be due before 24 hours');

assert(isAutomaticBackupDue({
  currentRevision: 2,
  lastVerifiedRevision: 1,
  lastVerifiedAt: now - AUTOMATIC_BACKUP_INTERVAL_MS,
  now,
}), 'changed content must be due at the exact 24-hour boundary');

assert(!isAutomaticBackupDue({
  currentRevision: 2,
  lastVerifiedRevision: 2,
  lastVerifiedAt: now - AUTOMATIC_BACKUP_INTERVAL_MS,
  now,
}), 'unchanged content must not be due');

assert(isAutomaticBackupDue({
  currentRevision: 1,
  lastVerifiedRevision: null,
  lastVerifiedAt: null,
  now,
}), 'content without a verified archive must be due');

assert(!isAutomaticBackupDue({
  currentRevision: 0,
  lastVerifiedRevision: null,
  lastVerifiedAt: null,
  now,
}), 'an empty unchanged database must not be due');

assert(shouldRetryAutomaticBackup('PROVIDER_WRITE_FAILED', 1), 'a transient provider failure should retry');
assert(shouldRetryAutomaticBackup('PROVIDER_WRITE_FAILED', 2), 'the final bounded retry should be allowed');
assert(!shouldRetryAutomaticBackup('PROVIDER_WRITE_FAILED', 3), 'automatic backup exceeded its retry limit');
assert(!shouldRetryAutomaticBackup('FOLDER_PERMISSION_REVOKED', 1), 'permission failures must wait for user action');
