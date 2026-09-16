import {
  downloadFileName,
  isUpdateAvailable,
  parseInstalledVersion,
  parseLatestRelease,
  parseVersionedApkName,
} from './release';

const assert = (condition: boolean, message: string) => {
  if (!condition) throw new Error(message);
};

assert(
  JSON.stringify(parseVersionedApkName('peacocknotes-v1.1.4-14.apk')) ===
    JSON.stringify({ versionName: '1.1.4', versionCode: 14 }),
  'a versioned APK name must parse into version name and code'
);
assert(parseVersionedApkName('app-release.apk') === null, 'an unversioned APK name must be rejected');
assert(parseVersionedApkName('peacocknotes-v1.1.4.apk') === null, 'a name without a code must be rejected');
assert(parseVersionedApkName('peacocknotes-v1.1.4-abc.apk') === null, 'a non-numeric code must be rejected');
assert(parseVersionedApkName('peacocknotes-v1.1.4-0.apk') === null, 'a zero code must be rejected');

assert(
  JSON.stringify(parseInstalledVersion({ version: '1.1.5', android: { versionCode: 15 } })) ===
    JSON.stringify({ versionName: '1.1.5', versionCode: 15 }),
  'an embedded config must yield the installed identity'
);
assert(parseInstalledVersion({ version: '1.1.5' }) === null, 'a config without a code must be rejected');
assert(parseInstalledVersion(null) === null, 'a missing config must be rejected');
assert(
  parseInstalledVersion({ version: '1.1.5', android: { versionCode: 0 } }) === null,
  'a zero installed code must be rejected'
);

const release = {
  tag_name: 'v1.1.4',
  draft: false,
  prerelease: false,
  assets: [
    { name: 'notes.txt', browser_download_url: 'https://example.test/notes.txt', size: 10 },
    {
      name: 'peacocknotes-v1.1.3-13.apk',
      browser_download_url: 'https://example.test/old.apk',
      size: 30,
    },
    {
      name: 'peacocknotes-v1.1.4-14.apk',
      browser_download_url: 'https://example.test/new.apk',
      size: 99,
    },
    {
      name: 'peacocknotes-v9.9.9-99.apk',
      browser_download_url: 'https://example.test/stale.apk',
      size: 999,
    },
  ],
};

const selected = parseLatestRelease(release);
assert(selected !== null, 'a normal release must select an APK');
assert(selected?.downloadUrl === 'https://example.test/new.apk', 'the highest version code must win');
assert(selected?.sizeBytes === 99, 'the asset size must be carried over');
assert(
  parseLatestRelease({ ...release, tag_name: 'v1.1.5' }) === null,
  'an APK whose version does not match the release tag must be rejected'
);
assert(
  parseLatestRelease({ ...release, tag_name: 'V1.1.4' })?.downloadUrl === 'https://example.test/new.apk',
  'uppercase release tags must use the matching APK'
);
assert(
  parseLatestRelease({ ...release, tag_name: undefined }) === null,
  'a release without a tag must be rejected'
);

assert(
  parseLatestRelease({ ...release, prerelease: true }) === null,
  'a prerelease must not be offered'
);
assert(parseLatestRelease({ ...release, draft: true }) === null, 'a draft must not be offered');
assert(parseLatestRelease({ assets: [] }) === null, 'a release without assets must not be offered');
assert(parseLatestRelease('nope') === null, 'a malformed payload must not be offered');
assert(
  parseLatestRelease({ assets: [{ name: 'peacocknotes-v1.1.4-14.apk', size: 10 }] }) === null,
  'an asset without a download URL must be rejected'
);

assert(
  isUpdateAvailable({ versionName: '1.1.4', versionCode: 14 }, { versionName: '1.1.5', versionCode: 15 }),
  'a higher remote code must be an update'
);
assert(
  !isUpdateAvailable({ versionName: '1.1.5', versionCode: 15 }, { versionName: '1.1.5', versionCode: 15 }),
  'an equal remote code must not be an update'
);
assert(
  !isUpdateAvailable({ versionName: '1.1.5', versionCode: 15 }, { versionName: '1.1.4', versionCode: 14 }),
  'a lower remote code must never be offered'
);

const downloaded = parseLatestRelease(release);
assert(
  downloaded !== null && downloadFileName(downloaded) === 'peacocknotes-v1.1.4-14.apk',
  'the download file name must match the release asset name'
);
