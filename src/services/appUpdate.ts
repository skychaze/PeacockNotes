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

export const LATEST_RELEASE_API_URL =
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
  error: AppUpdateError | null;
}>;

export type InstallOutcome = 'launched' | 'permission-required' | 'unavailable';

type AppUpdaterNativeModule = {
  canRequestPackageInstalls?: () => Promise<boolean>;
};

const nativeAppUpdater = NativeModules.AppUpdater as AppUpdaterNativeModule | undefined;

let snapshot: AppUpdateSnapshot = {
  phase: 'idle',
  installed: parseInstalledVersion(Constants.expoConfig),
  release: null,
  progress: 0,
  error: null,
};
let inFlightCheck: Promise<AppUpdateSnapshot> | null = null;
let inFlightDownload: Promise<AppUpdateSnapshot> | null = null;
let downloadedFileUri: string | null = null;
let awaitingInstallPermission = false;
let installInFlight = false;
const listeners = new Set<(next: AppUpdateSnapshot) => void>();

const setSnapshot = (partial: Partial<AppUpdateSnapshot>) => {
  snapshot = { ...snapshot, ...partial };
  listeners.forEach((listener) => listener(snapshot));
};

export const getAppUpdateSnapshot = () => snapshot;

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
  if (!installed) {
    setSnapshot({ phase: 'idle', installed: null });
    return Promise.resolve(snapshot);
  }

  setSnapshot({ phase: 'checking', installed, error: null });
  inFlightCheck = fetchLatestRelease()
    .then(async (release) => {
      const available = release !== null && isUpdateAvailable(installed, release);
      await pruneCachedApks(available ? downloadFileName(release) : null);
      if (!available) {
        setSnapshot({ phase: 'current', installed, release: null, progress: 0, error: null });
        return;
      }
      if (snapshot.release?.versionCode === release.versionCode && snapshot.phase === 'ready') {
        setSnapshot({ installed, release, error: null });
        return;
      }
      setSnapshot({ phase: 'available', installed, release, progress: 0, error: null });
    })
    .catch(() => {
      setSnapshot({ phase: 'error', installed, error: 'check' });
    })
    .then(() => {
      inFlightCheck = null;
      return snapshot;
    });
  return inFlightCheck;
};

/**
 * Downloads the advertised APK into the cache directory and verifies its size.
 * Interrupted or unverified downloads are deleted and never become installable.
 */
export const downloadAppUpdate = (): Promise<AppUpdateSnapshot> => {
  if (inFlightDownload) {
    return inFlightDownload;
  }
  const release = snapshot.release;
  if (snapshot.phase !== 'available' || !release || !FileSystem.cacheDirectory) {
    return Promise.resolve(snapshot);
  }

  const fileUri = `${FileSystem.cacheDirectory}${downloadFileName(release)}`;
  setSnapshot({ phase: 'downloading', progress: 0, error: null });
  inFlightDownload = FileSystem.createDownloadResumable(
    release.downloadUrl,
    fileUri,
    {},
    (progress) => {
      const total = progress.totalBytesExpectedToWrite;
      setSnapshot({ progress: total > 0 ? progress.totalBytesWritten / total : 0 });
    }
  )
    .downloadAsync()
    .then(async (result) => {
      if (!result || result.status !== 200) {
        throw new Error(`download failed with status ${result?.status ?? 'none'}`);
      }
      const info = await FileSystem.getInfoAsync(fileUri);
      const size = info.exists && !info.isDirectory ? Number(info.size ?? 0) : 0;
      if (size !== release.sizeBytes) {
        throw new Error(`download size mismatch: ${size} != ${release.sizeBytes}`);
      }
      downloadedFileUri = fileUri;
      setSnapshot({ phase: 'ready', progress: 1, error: null });
    })
    .catch(async () => {
      try {
        await FileSystem.deleteAsync(fileUri, { idempotent: true });
      } catch {
        // The partial file is unusable either way.
      }
      setSnapshot({ phase: 'available', progress: 0, error: 'download' });
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
export const installAppUpdate = async (): Promise<InstallOutcome> => {
  if (installInFlight || snapshot.phase !== 'ready' || !downloadedFileUri) {
    return 'unavailable';
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
      return 'permission-required';
    }

    const contentUri = await FileSystem.getContentUriAsync(downloadedFileUri);
    await IntentLauncher.startActivityAsync(APK_VIEW_ACTION, {
      data: contentUri,
      type: APK_MIME_TYPE,
      flags: FLAG_GRANT_READ_URI_PERMISSION,
    });
    return 'launched';
  } finally {
    installInFlight = false;
  }
};

AppState.addEventListener('change', (state) => {
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
