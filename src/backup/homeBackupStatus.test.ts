import { deriveHomeBackupStatus } from './homeBackupStatus';

const automatic = { enabled: true, phase: 'verified', attempt: 0, errorCode: null, updatedAt: null } as const;
const destination = { status: 'connected', uri: 'x', name: 'x' } as const;
const backup = { name: 'x', uri: 'x', bytes: 1, createdAt: '2026-01-01T00:00:00.000Z', contentRevision: 2 } as const;
const statusInput = { automatic, destination, archivePresence: 'present' as const };

const assert = (condition: boolean, message: string) => { if (!condition) throw new Error(message); };

assert(deriveHomeBackupStatus({ contentRevision: 2, verifiedBackup: backup, ...statusInput }).level === 'current', 'current verified backup must be green');
assert(deriveHomeBackupStatus({ contentRevision: 3, verifiedBackup: backup, ...statusInput }).level === 'pending', 'stale backup must be pending');
assert(deriveHomeBackupStatus({ contentRevision: 0, verifiedBackup: null, ...statusInput }).message === 'No verified backup yet', 'missing backup must not invent a timestamp');
const missingArchive = deriveHomeBackupStatus({ contentRevision: 2, verifiedBackup: backup, ...statusInput, archivePresence: 'missing' });
assert(missingArchive.level === 'pending', 'a deleted archive must never be green');
assert(missingArchive.message.includes(backup.createdAt) && missingArchive.message.includes('unavailable'), 'a missing archive must retain its last-success timestamp');
assert(deriveHomeBackupStatus({ contentRevision: 2, verifiedBackup: backup, ...statusInput, archivePresence: 'unknown' }).level === 'pending', 'an unconfirmed archive must never be green');
assert(deriveHomeBackupStatus({ contentRevision: 2, verifiedBackup: backup, ...statusInput, automatic: { ...automatic, enabled: false } }).level === 'action_required', 'disabled backup must be red');
assert(deriveHomeBackupStatus({ contentRevision: 2, verifiedBackup: backup, ...statusInput, automatic: { ...automatic, phase: 'provider' } }).level === 'action_required', 'provider failure must be red even with a connected destination');
