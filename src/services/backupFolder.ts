import { NativeModules, Platform } from 'react-native';

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
};

const nativeModule = NativeModules.BackupFolder as BackupFolderNativeModule | undefined;

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
