import { NativeModules, Platform } from 'react-native';
import { backupOperationStore } from './backupOperations';

export type BackupFolderStatus = 'disconnected' | 'connected' | 'revoked' | 'unavailable';

export type BackupFolderState = {
  status: BackupFolderStatus;
  uri: string | null;
  name: string | null;
};

export type PublishBackupRequest = Readonly<{
  stagedUri: string;
  displayName: string;
  expectedBytes: number;
}>;

export type PublishedBackup = Readonly<{
  uri: string;
  name: string;
}>;

type BackupFolderNativeModule = {
  getFolderState(): Promise<BackupFolderState>;
  chooseFolder(): Promise<BackupFolderState>;
  disconnect(): Promise<BackupFolderState>;
  publishArchive(request: PublishBackupRequest): Promise<PublishedBackup>;
  startBackupForegroundService(): Promise<void>;
  updateBackupNotification(message: string, progress: number): void;
  finishBackupNotification(success: boolean): void;
};

const nativeModule = NativeModules.BackupFolder as BackupFolderNativeModule | undefined;
let foregroundServiceLeases = 0;

const requireAndroidModule = (): BackupFolderNativeModule => {
  if (Platform.OS !== 'android' || !nativeModule) {
    throw new Error('BACKUP_FOLDER_UNAVAILABLE');
  }
  return nativeModule;
};

export const getBackupFolderState = () => requireAndroidModule().getFolderState();

export const chooseBackupFolder = () => requireAndroidModule().chooseFolder();

export const disconnectBackupFolder = () => requireAndroidModule().disconnect();

export const publishBackupArchive = (request: PublishBackupRequest) =>
  requireAndroidModule().publishArchive(request);

export const startBackupForegroundService = async () => {
  // Keep ownership in JS as well as in the durable operation row. The service
  // is shared by export, retention, and recovery, so a cleanup from one phase
  // must not stop it while another phase has already started.
  foregroundServiceLeases += 1;
  try {
    await requireAndroidModule().startBackupForegroundService();
  } catch (error) {
    foregroundServiceLeases = Math.max(0, foregroundServiceLeases - 1);
    throw error;
  }
};

export const acquireBackupForegroundServiceLease = () => {
  foregroundServiceLeases += 1;
};

export const updateBackupNotification = (message: string, progress: number) =>
  requireAndroidModule().updateBackupNotification(message, progress);

export const finishBackupNotification = (success: boolean) =>
  requireAndroidModule().finishBackupNotification(success);

/** Stop the shared manual service only when no durable operation still owns it. */
export const finishBackupNotificationIfIdle = async (success: boolean) => {
  if (Platform.OS !== 'android') return;
  if (foregroundServiceLeases > 0) return;
  const active = await backupOperationStore.getActive();
  if (!active && foregroundServiceLeases === 0) finishBackupNotification(success);
};

export const releaseBackupForegroundService = async (success: boolean) => {
  foregroundServiceLeases = Math.max(0, foregroundServiceLeases - 1);
  await finishBackupNotificationIfIdle(success);
};
