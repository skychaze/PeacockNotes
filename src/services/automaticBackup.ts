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
const stateListeners = new Set<(state: AutomaticBackupState) => void>();
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

const publishState = (state: AutomaticBackupState) => stateListeners.forEach((listener) => listener(state));

export const getAutomaticBackupState = async (): Promise<AutomaticBackupState> => {
  return requireModule().getState();
};

export const subscribeAutomaticBackupState = (listener: (state: AutomaticBackupState) => void) => {
  stateListeners.add(listener);
  return () => stateListeners.delete(listener);
};

export const setAutomaticBackupEnabled = async (enabled: boolean): Promise<AutomaticBackupState> => {
  const state = await requireModule().setEnabled(enabled);
  publishState(state);
  return state;
};

const setAutomaticBackupStatus = async (
  native: AutomaticBackupNativeModule,
  phase: AutomaticBackupPhase,
  attempt: number,
  code: string | null,
) => {
  await native.setStatus(phase, attempt, code);
  const state = await getAutomaticBackupState();
  publishState(state);
  return state;
};

let activeAttempt: Promise<AutomaticBackupState> | null = null;
let driveAuthorizationInProgress = false;
let automaticCatchUpSuppressedUntil = 0;

/**
 * OAuth temporarily backgrounds/resumes the JS app. Treat that lifecycle
 * transition as authentication plumbing, not as a signal to start a backup.
 * A short post-auth cooldown also covers the ordering where AppState's active
 * event is delivered just after the authorization promise resolves.
 */
export const setAutomaticBackupAuthorizationInProgress = (inProgress: boolean) => {
  driveAuthorizationInProgress = inProgress;
  if (!inProgress) automaticCatchUpSuppressedUntil = Date.now() + 5_000;
};

const runAutomaticBackupAttempt = async (): Promise<AutomaticBackupState> => {
  const native = requireModule();
  let state = await getAutomaticBackupState();
  if (!state.enabled || driveAuthorizationInProgress) return state;

  const [revision, verified] = await Promise.all([getContentRevision(), readLastVerified()]);
  state = await getAutomaticBackupState();
  if (!state.enabled || driveAuthorizationInProgress) return state;

  const lastVerifiedAt = verified ? Date.parse(verified.createdAt) : null;
  if (!isAutomaticBackupDue({
    currentRevision: revision,
    lastVerifiedRevision: verified?.contentRevision ?? null,
    lastVerifiedAt: lastVerifiedAt !== null && Number.isFinite(lastVerifiedAt) ? lastVerifiedAt : null,
    now: Date.now(),
  })) {
    return setAutomaticBackupStatus(native, 'not_due', 0, null);
  }

  await setAutomaticBackupStatus(native, 'due', 0, null);
  const [folder, constraints] = await Promise.all([
    getBackupFolderState(), native.constraintsMet(),
  ]);
  state = await getAutomaticBackupState();
  if (!state.enabled || driveAuthorizationInProgress) return state;
  if (folder.status !== 'connected') {
    const phase = folder.status === 'unavailable' ? 'provider' : 'permission';
    return setAutomaticBackupStatus(native, phase, 0, folder.status);
  }
  if (!constraints.connected) {
    return setAutomaticBackupStatus(native, 'connectivity', 0, 'BACKUP_OFFLINE');
  }
  if (!constraints.batteryOkay) {
    return setAutomaticBackupStatus(native, 'retrying', 0, 'BATTERY_CONSTRAINT');
  }

  for (let attempt = 1; attempt <= MAX_AUTOMATIC_BACKUP_ATTEMPTS; attempt += 1) {
    state = await getAutomaticBackupState();
    if (!state.enabled || driveAuthorizationInProgress) return state;
    await setAutomaticBackupStatus(native, 'running', attempt, null);
    try {
      await runAutomaticExport();
      return setAutomaticBackupStatus(native, 'verified', 0, null);
    } catch (error: unknown) {
      const code = errorCode(error);
      if (code === 'BACKUP_OPERATION_BUSY') {
        // A manual import/export (or another automatic worker) owns the
        // single durable slot. Do not report this as a permanent provider
        // failure and do not start a second job; leave a recoverable status
        // for the next lifecycle/WorkManager attempt.
        return setAutomaticBackupStatus(native, 'retrying', attempt, code);
      }
      const willRetry = shouldRetryAutomaticBackup(code, attempt);
      if (!willRetry) {
        return setAutomaticBackupStatus(native, failurePhase(code), attempt, code);
      }
      await setAutomaticBackupStatus(native, 'retrying', attempt, code);
      await delay(RETRY_DELAYS_MS[attempt - 1]);
    }
  }
  return getAutomaticBackupState();
};

export const attemptAutomaticBackup = (): Promise<AutomaticBackupState> => {
  if (activeAttempt) return activeAttempt;
  activeAttempt = runAutomaticBackupAttempt().finally(() => { activeAttempt = null; });
  return activeAttempt;
};

const attemptWithoutUnhandledRejection = () => {
  if (driveAuthorizationInProgress || Date.now() < automaticCatchUpSuppressedUntil) {
    console.info('[BR-AUTO] skipped AppState catch-up during Drive authorization transition');
    return;
  }
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
