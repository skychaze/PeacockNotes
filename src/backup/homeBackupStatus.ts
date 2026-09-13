import type { AutomaticBackupState } from '../services/automaticBackup';
import type { BackupFolderState } from '../services/backupFolder';
import type { VerifiedBackup } from '../services/backupExport';

export type HomeBackupStatus = Readonly<{
  level: 'current' | 'pending' | 'action_required';
  message: string;
}>;

export type ArchivePresence = 'present' | 'missing' | 'unknown';

type Input = Readonly<{
  contentRevision: number;
  verifiedBackup: VerifiedBackup | null;
  automatic: AutomaticBackupState | null;
  destination: BackupFolderState | null;
  archivePresence: ArchivePresence;
}>;

export const deriveHomeBackupStatus = ({ contentRevision, verifiedBackup, automatic, destination, archivePresence }: Input): HomeBackupStatus => {
  const enabled = automatic?.enabled === true;
  const destinationAvailable = destination?.status === 'connected';
  const needsAction = automatic?.phase === 'permission' || automatic?.phase === 'provider' || automatic?.phase === 'connectivity' || automatic?.phase === 'failed';
  const timestamp = verifiedBackup?.createdAt ?? 'No verified backup yet';
  const archiveUnavailable = verifiedBackup !== null && archivePresence === 'missing';
  const recoveryMessage = archiveUnavailable
    ? `Latest verified archive is unavailable. Last successful: ${timestamp}`
    : timestamp;

  if (!enabled || !destinationAvailable || needsAction) {
    return { level: 'action_required', message: needsAction ? `Backup needs attention. ${recoveryMessage}` : `Backup needs setup. ${recoveryMessage}` };
  }

  const current = archivePresence === 'present' && verifiedBackup !== null && verifiedBackup.contentRevision >= contentRevision;
  const busy = automatic?.phase === 'due' || automatic?.phase === 'running' || automatic?.phase === 'retrying';
  if (current && !busy && (automatic?.phase === 'verified' || automatic?.phase === 'not_due')) return { level: 'current', message: `Verified backup: ${timestamp}` };
  return { level: 'pending', message: verifiedBackup ? `Backup pending. ${recoveryMessage}` : timestamp };
};
