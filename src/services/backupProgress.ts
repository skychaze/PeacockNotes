import { NativeEventEmitter, NativeModules, Platform } from 'react-native';

export type BackupProgressSnapshot = Readonly<{
  operationId: string;
  operationKind: string;
  phase: string;
  step: string;
  state: 'running' | 'pending' | 'succeeded' | 'failed' | 'cancelled' | 'interrupted';
  bytesDone: number;
  bytesTotal: number | null;
  itemsDone: number;
  itemsTotal: number | null;
  updatedAt: number;
}>;

export type BackupProgressOwner = Readonly<{
  operationId: string;
  operationKind: string;
}>;

type BeginBackupProgressRequest = BackupProgressOwner & Readonly<{
  phase?: string;
  step?: string;
  bytesTotal?: number | null;
  itemsTotal?: number | null;
}>;

type FinishBackupProgressRequest = BackupProgressOwner & Readonly<{
  state?: Exclude<BackupProgressSnapshot['state'], 'running' | 'pending'>;
}>;

type NativeBackupProgressModule = {
  getBackupProgressSnapshot(): Promise<BackupProgressSnapshot | null>;
  beginBackupProgress(request: BeginBackupProgressRequest): Promise<boolean>;
  finishBackupProgress(request: FinishBackupProgressRequest): void;
  addListener(eventName: string): void;
  removeListeners(count: number): void;
};

const nativeModule = NativeModules.BackupFolder as NativeBackupProgressModule | undefined;

const requireModule = (): NativeBackupProgressModule => {
  if (Platform.OS !== 'android' || !nativeModule) throw new Error('BACKUP_PROGRESS_UNAVAILABLE');
  return nativeModule;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

const parseSnapshot = (value: unknown): BackupProgressSnapshot | null => {
  if (value === null) return null;
  if (!isRecord(value) || typeof value.operationId !== 'string' || typeof value.operationKind !== 'string' ||
    typeof value.phase !== 'string' || typeof value.step !== 'string' || typeof value.state !== 'string' ||
    typeof value.bytesDone !== 'number' || typeof value.itemsDone !== 'number' || typeof value.updatedAt !== 'number') {
    return null;
  }
  const state = value.state;
  if (!['running', 'pending', 'succeeded', 'failed', 'cancelled', 'interrupted'].includes(state)) return null;
  const bytesTotal = value.bytesTotal;
  const itemsTotal = value.itemsTotal;
  if (bytesTotal !== null && typeof bytesTotal !== 'number') return null;
  if (itemsTotal !== null && typeof itemsTotal !== 'number') return null;
  return {
    operationId: value.operationId,
    operationKind: value.operationKind,
    phase: value.phase,
    step: value.step,
    state: state as BackupProgressSnapshot['state'],
    bytesDone: value.bytesDone,
    bytesTotal,
    itemsDone: value.itemsDone,
    itemsTotal,
    updatedAt: value.updatedAt,
  };
};

export const getBackupProgressSnapshot = (): Promise<BackupProgressSnapshot | null> =>
  requireModule().getBackupProgressSnapshot().then(parseSnapshot);

export const beginBackupProgress = (request: BeginBackupProgressRequest): Promise<boolean> =>
  requireModule().beginBackupProgress(request);

export const finishBackupProgress = (request: FinishBackupProgressRequest) =>
  requireModule().finishBackupProgress(request);

export const subscribeBackupProgress = (listener: (snapshot: BackupProgressSnapshot | null) => void): (() => void) => {
  if (Platform.OS !== 'android' || !nativeModule) return () => {};
  const emitter = new NativeEventEmitter(nativeModule);
  const subscription = emitter.addListener('backupProgress', (value: unknown) => listener(parseSnapshot(value)));
  return () => subscription.remove();
};

export const createBackupProgressOperationId = () =>
  `progress-${Date.now()}-${Math.random().toString(36).slice(2)}`;
