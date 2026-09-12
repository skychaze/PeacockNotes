export const AUTOMATIC_BACKUP_INTERVAL_MS = 24 * 60 * 60 * 1000;
export const MAX_AUTOMATIC_BACKUP_ATTEMPTS = 3;

const TRANSIENT_EXPORT_CODES = new Set([
  'ARCHIVE_OPERATION_FAILED',
  'BACKUP_OFFLINE',
  'DESTINATION_VERIFICATION_FAILED',
  'OUTPUT_RENAMED',
  'PARTIAL_WRITE',
  'PROVIDER_SCAN_FAILED',
  'PROVIDER_WRITE_FAILED',
  'SOURCE_UNAVAILABLE',
]);

export const shouldRetryAutomaticBackup = (code: string, completedAttempts: number): boolean =>
  TRANSIENT_EXPORT_CODES.has(code) && completedAttempts < MAX_AUTOMATIC_BACKUP_ATTEMPTS;

export type AutomaticBackupDueInput = Readonly<{
  currentRevision: number;
  lastVerifiedRevision: number | null;
  lastVerifiedAt: number | null;
  now: number;
}>;

export const isAutomaticBackupDue = ({
  currentRevision,
  lastVerifiedRevision,
  lastVerifiedAt,
  now,
}: AutomaticBackupDueInput): boolean => {
  const contentChanged = lastVerifiedRevision === null
    ? currentRevision > 0
    : currentRevision !== lastVerifiedRevision;
  if (!contentChanged) return false;
  return lastVerifiedAt === null || now - lastVerifiedAt >= AUTOMATIC_BACKUP_INTERVAL_MS;
};
