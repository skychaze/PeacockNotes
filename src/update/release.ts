export type InstalledAppVersion = {
  versionName: string;
  versionCode: number;
};

export type ReleasedApk = InstalledAppVersion & {
  downloadUrl: string;
  sizeBytes: number;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

const isPositiveInteger = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value > 0;

/** Reads the APK identity from the release asset name written by release.yml. */
export const parseVersionedApkName = (name: string): InstalledAppVersion | null => {
  const match = /^peacocknotes-v(.+)-(\d+)\.apk$/.exec(name);
  if (!match) {
    return null;
  }
  const versionCode = Number(match[2]);
  if (!isPositiveInteger(versionCode)) {
    return null;
  }
  return { versionName: match[1], versionCode };
};

/** Reads the installed identity from the embedded Expo config. */
export const parseInstalledVersion = (expoConfig: unknown): InstalledAppVersion | null => {
  if (!isRecord(expoConfig) || typeof expoConfig.version !== 'string') {
    return null;
  }
  const android = isRecord(expoConfig.android) ? expoConfig.android : null;
  if (!android || !isPositiveInteger(android.versionCode)) {
    return null;
  }
  return { versionName: expoConfig.version, versionCode: android.versionCode };
};

const parseReleasedApk = (asset: unknown): ReleasedApk | null => {
  if (!isRecord(asset)) {
    return null;
  }
  if (typeof asset.name !== 'string' || typeof asset.browser_download_url !== 'string') {
    return null;
  }
  if (!isPositiveInteger(asset.size)) {
    return null;
  }
  const identity = parseVersionedApkName(asset.name);
  if (!identity) {
    return null;
  }
  return {
    ...identity,
    downloadUrl: asset.browser_download_url,
    sizeBytes: asset.size,
  };
};

/** Picks the newest installable APK from a GitHub `releases/latest` payload. */
export const parseLatestRelease = (payload: unknown): ReleasedApk | null => {
  if (!isRecord(payload) || payload.draft === true || payload.prerelease === true) {
    return null;
  }
  if (typeof payload.tag_name !== 'string') {
    return null;
  }
  const tagMatch = /^v(.+)$/.exec(payload.tag_name) ?? /^V(.+)$/.exec(payload.tag_name);
  if (!tagMatch) {
    return null;
  }
  if (!Array.isArray(payload.assets)) {
    return null;
  }
  return payload.assets
    .map(parseReleasedApk)
    .filter((apk): apk is ReleasedApk => apk !== null && apk.versionName === tagMatch[1])
    .reduce<ReleasedApk | null>(
      (newest, apk) => (newest === null || apk.versionCode > newest.versionCode ? apk : newest),
      null
    );
};

export const isUpdateAvailable = (installed: InstalledAppVersion, released: InstalledAppVersion) =>
  released.versionCode > installed.versionCode;

export const downloadFileName = (release: ReleasedApk) =>
  `peacocknotes-v${release.versionName}-${release.versionCode}.apk`;
