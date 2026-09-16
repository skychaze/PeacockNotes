export const AUTOMATIC_BACKUP_INTERVAL_HOURS = [1, 3, 6, 12, 24] as const;
export type AutomaticBackupIntervalHours = typeof AUTOMATIC_BACKUP_INTERVAL_HOURS[number];
export const DEFAULT_AUTOMATIC_BACKUP_INTERVAL_HOURS: AutomaticBackupIntervalHours = 24;
export const MAX_AUTOMATIC_BACKUP_ATTEMPTS = 3;

export const isAutomaticBackupIntervalHours = (value: unknown): value is AutomaticBackupIntervalHours =>
  typeof value === 'number' && AUTOMATIC_BACKUP_INTERVAL_HOURS.some((hours) => hours === value);

export const automaticBackupIntervalMs = (hours: AutomaticBackupIntervalHours): number =>
  hours * 60 * 60 * 1000;

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
  currentFolderUri?: string | null;
  lastVerifiedFolderUri?: string | null;
  intervalHours?: AutomaticBackupIntervalHours;
  now: number;
}>;

export const isAutomaticBackupDue = ({
  currentRevision,
  lastVerifiedRevision,
  lastVerifiedAt,
  currentFolderUri,
  lastVerifiedFolderUri,
  intervalHours = DEFAULT_AUTOMATIC_BACKUP_INTERVAL_HOURS,
  now,
}: AutomaticBackupDueInput): boolean => {
  const recoveryPointMatchesFolder = Boolean(
    currentFolderUri && lastVerifiedFolderUri && currentFolderUri === lastVerifiedFolderUri,
  );
  const contentChanged = !recoveryPointMatchesFolder || lastVerifiedRevision === null
    ? currentRevision > 0
    : currentRevision !== lastVerifiedRevision;
  if (!contentChanged) return false;
  return lastVerifiedAt === null || now - lastVerifiedAt >= automaticBackupIntervalMs(intervalHours);
};
