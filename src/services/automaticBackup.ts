import AsyncStorage from '@react-native-async-storage/async-storage';
import { AppState, NativeModules, Platform } from 'react-native';
import {
  MAX_AUTOMATIC_BACKUP_ATTEMPTS,
  isAutomaticBackupDue,
  shouldRetryAutomaticBackup,
} from '../backup/automaticPolicy';
import { getContentRevision } from '../database/schema';
import { runAutomaticExport, type VerifiedBackup } from './backupExport';
import { getBackupFolderState } from './backupFolder';

export type AutomaticBackupPhase =
  | 'disabled'
  | 'not_due'
  | 'due'
  | 'running'
  | 'retrying'
  | 'permission'
  | 'provider'
  | 'connectivity'
  | 'failed'
  | 'verified';

export type AutomaticBackupState = Readonly<{
  enabled: boolean;
  phase: AutomaticBackupPhase;
  attempt: number;
  errorCode: string | null;
  updatedAt: number | null;
}>;

type AutomaticBackupNativeModule = {
  getState(): Promise<AutomaticBackupState>;
  setEnabled(enabled: boolean): Promise<AutomaticBackupState>;
  setStatus(phase: AutomaticBackupPhase, attempt: number, errorCode: string | null): Promise<void>;
  constraintsMet(): Promise<{ connected: boolean; batteryOkay: boolean }>;
};

const nativeModule = NativeModules.AutomaticBackup as AutomaticBackupNativeModule | undefined;
const requireModule = (): AutomaticBackupNativeModule => {
  if (Platform.OS !== 'android' || !nativeModule) throw new Error('AUTOMATIC_BACKUP_UNAVAILABLE');
  return nativeModule;
};

const readLastVerified = async (): Promise<VerifiedBackup | null> => {
  const stored = await AsyncStorage.getItem('backup.lastVerified');
  if (!stored) return null;
  try {
    const parsed: unknown = JSON.parse(stored);
    if (typeof parsed !== 'object' || parsed === null) return null;
    const value = parsed as Partial<VerifiedBackup>;
    return typeof value.createdAt === 'string' && typeof value.contentRevision === 'number'
      ? value as VerifiedBackup
      : null;
  } catch {
    return null;
  }
};

const failurePhase = (code: string): AutomaticBackupPhase => {
  if (code === 'BACKUP_OFFLINE') return 'connectivity';
  if (code.includes('PERMISSION') || code === 'FOLDER_NOT_CONNECTED') return 'permission';
  if (code.includes('PROVIDER') || code === 'OUTPUT_RENAMED') return 'provider';
  return 'failed';
};

const RETRY_DELAYS_MS = [15_000, 60_000] as const;

const errorCode = (error: unknown) => typeof error === 'object' && error !== null && 'code' in error
  ? String(error.code)
  : error instanceof Error ? error.message : 'EXPORT_FAILED';

const delay = (milliseconds: number) => new Promise<void>((resolve) => {
  setTimeout(resolve, milliseconds);
});

export const getAutomaticBackupState = () => requireModule().getState();
export const setAutomaticBackupEnabled = (enabled: boolean) => requireModule().setEnabled(enabled);

let activeAttempt: Promise<AutomaticBackupState> | null = null;

const runAutomaticBackupAttempt = async (): Promise<AutomaticBackupState> => {
  const native = requireModule();
  let state = await native.getState();
  if (!state.enabled) return state;

  const [revision, verified] = await Promise.all([getContentRevision(), readLastVerified()]);
  state = await native.getState();
  if (!state.enabled) return state;

  const lastVerifiedAt = verified ? Date.parse(verified.createdAt) : null;
  if (!isAutomaticBackupDue({
    currentRevision: revision,
    lastVerifiedRevision: verified?.contentRevision ?? null,
    lastVerifiedAt: lastVerifiedAt !== null && Number.isFinite(lastVerifiedAt) ? lastVerifiedAt : null,
    now: Date.now(),
  })) {
    await native.setStatus('not_due', 0, null);
    return native.getState();
  }

  await native.setStatus('due', 0, null);
  const [folder, constraints] = await Promise.all([
    getBackupFolderState(), native.constraintsMet(),
  ]);
  state = await native.getState();
  if (!state.enabled) return state;
  if (folder.status !== 'connected') {
    const phase = folder.status === 'unavailable' ? 'provider' : 'permission';
    await native.setStatus(phase, 0, folder.status);
    return native.getState();
  }
  if (!constraints.connected) {
    await native.setStatus('connectivity', 0, 'BACKUP_OFFLINE');
    return native.getState();
  }
  if (!constraints.batteryOkay) {
    await native.setStatus('retrying', 0, 'BATTERY_CONSTRAINT');
    return native.getState();
  }

  for (let attempt = 1; attempt <= MAX_AUTOMATIC_BACKUP_ATTEMPTS; attempt += 1) {
    state = await native.getState();
    if (!state.enabled) return state;
    await native.setStatus('running', attempt, null);
    try {
      await runAutomaticExport();
      await native.setStatus('verified', 0, null);
      return native.getState();
    } catch (error: unknown) {
      const code = errorCode(error);
      const willRetry = shouldRetryAutomaticBackup(code, attempt);
      if (!willRetry) {
        await native.setStatus(failurePhase(code), attempt, code);
        return native.getState();
      }
      await native.setStatus('retrying', attempt, code);
      await delay(RETRY_DELAYS_MS[attempt - 1]);
    }
  }
  return native.getState();
};

export const attemptAutomaticBackup = (): Promise<AutomaticBackupState> => {
  if (activeAttempt) return activeAttempt;
  activeAttempt = runAutomaticBackupAttempt().finally(() => { activeAttempt = null; });
  return activeAttempt;
};

const attemptWithoutUnhandledRejection = () => {
  void attemptAutomaticBackup().catch((error: unknown) => {
    console.warn('Automatic backup catch-up failed:', error);
  });
};

export const installAutomaticBackupCatchUp = (): (() => void) => {
  if (Platform.OS !== 'android') return () => {};
  attemptWithoutUnhandledRejection();
  const subscription = AppState.addEventListener('change', (nextState) => {
    if (nextState === 'active') attemptWithoutUnhandledRejection();
  });
  return () => subscription.remove();
};
