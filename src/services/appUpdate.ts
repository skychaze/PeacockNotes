import { AppState, NativeModules } from 'react-native';
import Constants from 'expo-constants';
import * as FileSystem from 'expo-file-system/legacy';
import * as IntentLauncher from 'expo-intent-launcher';
import {
  downloadFileName,
  isUpdateAvailable,
  parseInstalledVersion,
  parseLatestRelease,
  type InstalledAppVersion,
  type ReleasedApk,
} from '../update/release';

const LATEST_RELEASE_API_URL =
  'https://api.github.com/repos/skychaze/PeacockNotes/releases/latest';

const RELEASE_REQUEST_HEADERS = {
  Accept: 'application/vnd.github+json',
  'User-Agent': 'PeacockNotes',
};
const RELEASE_REQUEST_TIMEOUT_MS = 15_000;
const APK_MIME_TYPE = 'application/vnd.android.package-archive';
const APK_VIEW_ACTION = 'android.intent.action.VIEW';
const FLAG_GRANT_READ_URI_PERMISSION = 1;
const DEFAULT_ANDROID_PACKAGE = 'com.roy.peacocknotes';

export type AppUpdatePhase =
  | 'idle'
  | 'checking'
  | 'current'
  | 'available'
  | 'downloading'
  | 'ready'
  | 'error';

export type AppUpdateError = 'check' | 'download';

export type AppUpdateSnapshot = Readonly<{
  phase: AppUpdatePhase;
  installed: InstalledAppVersion | null;
  release: ReleasedApk | null;
  progress: number;
  waitingFor: 'wifi' | 'network' | null;
  error: AppUpdateError | null;
}>;

type AppUpdaterNativeModule = {
  canRequestPackageInstalls?: () => Promise<boolean>;
  startDownload?: (url: string, fileName: string, versionCode: number, sizeBytes: number) => Promise<NativeDownloadStatus>;
  getDownloadStatus?: () => Promise<NativeDownloadStatus>;
};

type NativeDownloadStatus = {
  state: 'missing' | 'downloading' | 'paused' | 'ready' | 'failed';
  versionCode?: number;
  progress?: number;
  reason?: 'wifi' | 'network';
  uri?: string;
};

const nativeAppUpdater = NativeModules.AppUpdater as AppUpdaterNativeModule | undefined;

let snapshot: AppUpdateSnapshot = {
  phase: 'idle',
  installed: parseInstalledVersion(Constants.expoConfig),
  release: null,
  progress: 0,
  waitingFor: null,
  error: null,
};
let inFlightCheck: Promise<AppUpdateSnapshot> | null = null;
let inFlightDownload: Promise<AppUpdateSnapshot> | null = null;
let downloadedFileUri: string | null = null;
let awaitingInstallPermission = false;
let installInFlight = false;
let downloadPoll: ReturnType<typeof setInterval> | null = null;
const listeners = new Set<(next: AppUpdateSnapshot) => void>();

const setSnapshot = (partial: Partial<AppUpdateSnapshot>) => {
  snapshot = { ...snapshot, ...partial };
  listeners.forEach((listener) => listener(snapshot));
};

export const getAppUpdateSnapshot = () => snapshot;

export const hasAppUpdate = (current: AppUpdateSnapshot) => current.release !== null;

export const subscribeAppUpdate = (listener: (next: AppUpdateSnapshot) => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

const isDownloadedApkName = (name: string) =>
  name.startsWith('peacocknotes-v') && name.endsWith('.apk');

/** Keeps at most the advertised APK in the cache directory across restarts. */
const pruneCachedApks = async (keepName: string | null) => {
  if (!FileSystem.cacheDirectory) {
    return;
  }
  const cacheDirectory = FileSystem.cacheDirectory;
  try {
    const names = await FileSystem.readDirectoryAsync(cacheDirectory);
    const stale = names.filter((name) => isDownloadedApkName(name) && name !== keepName);
    if (downloadedFileUri && stale.some((name) => `${cacheDirectory}${name}` === downloadedFileUri)) {
      downloadedFileUri = null;
    }
    await Promise.all(
      stale.map((name) =>
        FileSystem.deleteAsync(`${cacheDirectory}${name}`, { idempotent: true }).catch(
          () => undefined
        )
      )
    );
  } catch {
    // Cache pruning is best-effort.
  }
};

/** Finds an already verified APK so a completed download survives restarts. */
const findDownloadedApk = async (release: ReleasedApk): Promise<string | null> => {
  if (!FileSystem.cacheDirectory) {
    return null;
  }
  const uri = `${FileSystem.cacheDirectory}${downloadFileName(release)}`;
  try {
    const info = await FileSystem.getInfoAsync(uri);
    const size = info.exists && !info.isDirectory ? Number(info.size ?? 0) : 0;
    return size === release.sizeBytes ? uri : null;
  } catch {
    return null;
  }
};

const stopDownloadPoll = () => {
  if (downloadPoll) clearInterval(downloadPoll);
  downloadPoll = null;
};

const startDownloadPoll = (release: ReleasedApk) => {
  if (downloadPoll) return;
  downloadPoll = setInterval(() => {
    if (AppState.currentState === 'active') void refreshDownload(release).catch(() => undefined);
  }, 1_000);
};

const refreshDownload = async (release: ReleasedApk): Promise<boolean> => {
  const status = await nativeAppUpdater?.getDownloadStatus?.();
  if (!status || status.versionCode !== release.versionCode) return false;
  if (status.state === 'ready' && status.uri) {
    downloadedFileUri = status.uri;
    setSnapshot({ phase: 'ready', progress: 1, waitingFor: null, error: null });
    stopDownloadPoll();
    return true;
  }
  if (status.state === 'failed') {
    setSnapshot({ phase: 'available', progress: 0, waitingFor: null, error: 'download' });
    stopDownloadPoll();
    return true;
  }
  if (status.state === 'downloading' || status.state === 'paused') {
    setSnapshot({
      phase: 'downloading',
      progress: status.progress ?? 0,
      waitingFor: status.state === 'paused' ? status.reason ?? 'network' : null,
      error: null,
    });
    startDownloadPoll(release);
    return true;
  }
  return false;
};

const fetchLatestRelease = async (): Promise<ReleasedApk | null> => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), RELEASE_REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(LATEST_RELEASE_API_URL, {
      headers: RELEASE_REQUEST_HEADERS,
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new Error(`release check failed with status ${response.status}`);
    }
    return parseLatestRelease(await response.json());
  } finally {
    clearTimeout(timeout);
  }
};

/**
 * Reads the newest GitHub release and compares it with the installed binary.
 * Failures are recorded in the snapshot, never thrown at the caller.
 */
export const checkForAppUpdate = (): Promise<AppUpdateSnapshot> => {
  if (inFlightCheck) {
    return inFlightCheck;
  }
  if (inFlightDownload) {
    return inFlightDownload;
  }
  const installed = parseInstalledVersion(Constants.expoConfig);
  void nativeAppUpdater?.getDownloadStatus?.().catch(() => undefined);
  if (!installed) {
    setSnapshot({ phase: 'idle', installed: null });
    return Promise.resolve(snapshot);
  }

  const verifiedFileUri = downloadedFileUri;
  const knownRelease = snapshot.release;
  setSnapshot({ phase: 'checking', installed, error: null });
  inFlightCheck = fetchLatestRelease()
    .then(async (release) => {
      const available = release !== null && isUpdateAvailable(installed, release);
      await pruneCachedApks(available ? downloadFileName(release) : null);
      if (!available) {
        stopDownloadPoll();
        downloadedFileUri = null;
        setSnapshot({ phase: 'current', installed, release: null, progress: 0, waitingFor: null, error: null });
        return;
      }
      if (knownRelease && knownRelease.versionCode !== release.versionCode) stopDownloadPoll();
      downloadedFileUri = await findDownloadedApk(release);
      if (downloadedFileUri) {
        setSnapshot({ phase: 'ready', installed, release, progress: 1, waitingFor: null, error: null });
        return;
      }
      if (await refreshDownload(release).catch(() => false)) {
        setSnapshot({ installed, release });
        return;
      }
      setSnapshot({ phase: 'available', installed, release, progress: 0, waitingFor: null, error: null });
    })
    .catch(() => {
      if (verifiedFileUri && knownRelease) {
        downloadedFileUri = verifiedFileUri;
        setSnapshot({ phase: 'ready', installed, release: knownRelease, progress: 1, waitingFor: null, error: 'check' });
        return;
      }
      setSnapshot({ phase: 'error', installed, error: 'check' });
    })
    .then(() => {
      inFlightCheck = null;
      return snapshot;
    });
  return inFlightCheck;
};

export const downloadAppUpdate = (): Promise<AppUpdateSnapshot> => {
  if (inFlightDownload) {
    return inFlightDownload;
  }
  const release = snapshot.release;
  if (snapshot.phase !== 'available' || !release) {
    return Promise.resolve(snapshot);
  }
  if (!nativeAppUpdater?.startDownload) {
    setSnapshot({ error: 'download' });
    return Promise.resolve(snapshot);
  }

  setSnapshot({ phase: 'downloading', progress: 0, waitingFor: null, error: null });
  inFlightDownload = nativeAppUpdater.startDownload(
    release.downloadUrl, downloadFileName(release), release.versionCode, release.sizeBytes
  )
    .then(async () => {
      startDownloadPoll(release);
      await refreshDownload(release);
    })
    .catch(() => {
      setSnapshot({ phase: 'available', progress: 0, waitingFor: null, error: 'download' });
    })
    .then(() => {
      inFlightDownload = null;
      return snapshot;
    });
  return inFlightDownload;
};

const canRequestPackageInstalls = async (): Promise<boolean> => {
  try {
    return (await nativeAppUpdater?.canRequestPackageInstalls?.()) ?? true;
  } catch {
    // Without the native probe, the installer shows its own consent dialog.
    return true;
  }
};

/**
 * Opens the package installer for the verified APK. When Android has not
 * allowed this app to install unknown apps yet, it opens that settings screen
 * instead and the install resumes automatically when the user comes back.
 */
export const installAppUpdate = async (): Promise<void> => {
  if (installInFlight || snapshot.phase !== 'ready' || !downloadedFileUri) {
    return;
  }

  installInFlight = true;
  try {
    if (!(await canRequestPackageInstalls())) {
      awaitingInstallPermission = true;
      const packageName =
        Constants.expoConfig?.android?.package ?? DEFAULT_ANDROID_PACKAGE;
      await IntentLauncher.startActivityAsync(
        IntentLauncher.ActivityAction.MANAGE_UNKNOWN_APP_SOURCES,
        { data: `package:${packageName}` }
      );
      return;
    }

    const contentUri = downloadedFileUri.startsWith('content:')
      ? downloadedFileUri
      : await FileSystem.getContentUriAsync(downloadedFileUri);
    await IntentLauncher.startActivityAsync(APK_VIEW_ACTION, {
      data: contentUri,
      type: APK_MIME_TYPE,
      flags: FLAG_GRANT_READ_URI_PERMISSION,
    });
  } finally {
    installInFlight = false;
  }
};

AppState.addEventListener('change', (state) => {
  if (state === 'active' && snapshot.phase === 'downloading' && snapshot.release) {
    void refreshDownload(snapshot.release).catch(() => undefined);
  }
  if (state !== 'active' || !awaitingInstallPermission) {
    return;
  }
  awaitingInstallPermission = false;
  void canRequestPackageInstalls().then((allowed) => {
    if (allowed) {
      void installAppUpdate();
    }
  });
});
