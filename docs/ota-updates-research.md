# OTA updates research for Peacock Notes

Research date: 2026-09-14

## Verdict

Peacock Notes can use EAS Update for JavaScript, TypeScript, styling, and Metro-bundled assets after one new Android and iOS binary adds `expo-updates` and its native configuration. It is a checked-in native Expo SDK 54 project, so it needs the bare-project integration, not a config-only change. The current `expo-updates` configuration is disabled in Android and iOS, and `expo-updates` is absent from `package.json`. Existing APK/AAB installs, including version 1.1.1 (Android versionCode 11), cannot receive an OTA update. Install a newly built, signed binary first.

EAS Update can be used without EAS Build. The current local Gradle and GitHub Actions APK release path can remain in place, including sideloaded APK distribution. iOS is supported by Expo, but this research has not validated this app's iOS build. EAS Build automates channel and runtime bookkeeping, but it is not a requirement. [Expo: standalone EAS Update](https://docs.expo.dev/eas-update/standalone-service/)

## What OTA can deliver

An update replaces the JavaScript bundle and its selected assets. It can ship changes to screens, navigation, TypeScript logic, translations, styles, and assets imported by Metro. For this app, that includes changes under `src/`, `App.tsx`, `index.ts`, and bundled font files loaded with `require` in `App.tsx`. Expo describes EAS Update as a way to ship JavaScript and asset changes without a new build. [Expo: EAS Update setup](https://docs.expo.dev/eas-update/getting-started/)

It cannot add or change native code in an installed binary. That includes Android Kotlin modules and packages, iOS native code, Gradle or Pod changes, Android permissions and manifest entries, entitlements, the Expo SDK or React Native version, and a new native dependency. Peacock Notes must make a new signed APK/AAB or iOS build for changes to `ArchiveModule`, backup workers, `DriveClient`, the manually registered Android packages, or any library with native code. A runtime version is the guard that prevents a bundle from loading against a different native layer. [Expo: runtime versions](https://docs.expo.dev/eas-update/runtime-versions/)

## Recommended release model

| Change in Peacock Notes | OTA eligible? |
| --- | --- |
| Layouts, themes, translations, search/sort logic | Yes, using the installed native APIs. |
| New screens or JS-only features and dependencies | Yes, if compatible with the installed native runtime. |
| Images and fonts imported by the JS bundle | Yes. |
| SQLite query changes or additive migrations | Conditional: old JS and installed Kotlin code must remain compatible. |
| Kotlin backup services, native archive logic, new native libraries | No, requires a new binary. |
| Launcher icon, native splash screen, permissions, share intent filters | No, requires a new binary. |
| Installed Android versionName/versionCode, Expo SDK or React Native upgrade | No, requires a new binary. |

These classifications apply Expo's [native runtime boundary](https://docs.expo.dev/eas-update/runtime-versions/) to the files in this repository. OTA delivers application code and assets; it does not synchronize users' notes or backups.

Use `runtimeVersion: { "policy": "appVersion" }`. Peacock Notes regenerates parts of `android/` during prebuild and writes build output under the same directory. Testing found that a fingerprint computed before and after a release build did not remain stable, which could prevent an update from matching its binary. The app-version policy gives every binary for version 1.1.2 the runtime `1.1.2`. Every native code or native dependency change must therefore bump `expo.version` and `expo.android.versionCode` before building. JavaScript-only OTA releases keep the same app version. [Expo: runtime versions](https://docs.expo.dev/eas-update/runtime-versions/) [Expo SDK 54 updates reference](https://docs.expo.dev/versions/v54.0.0/sdk/updates/)

Keep two channels embedded into the binaries:

| Binary purpose | Channel | Use |
| --- | --- | --- |
| Internal APK | `preview` | Test an update on real existing data before release. |
| Production AAB/APK | `production` | Publish only tested updates. |

For local builds, channels are native configuration, not just `eas.json`. Put the Android request-header metadata in `AndroidManifest.xml` and the iOS `EXUpdatesRequestHeaders` dictionary in `Expo.plist`, using the channel appropriate to each binary. Create each channel with `eas channel:create`. EAS Build would inject these values from `eas.json`, but local builds must set them directly. [Expo: configuring a channel without EAS Build](https://docs.expo.dev/bare/installing-updates/) [Expo: standalone service](https://docs.expo.dev/eas-update/standalone-service/)

## One-time integration steps

Do these in a dedicated binary-release change. Do not run a clean `expo prebuild`, since this project owns native files and custom package registration.

1. Install the SDK-matched package with `npx expo install expo-updates`, then run `npx pod-install` for iOS. Expo's bare-project guide also requires native Android and iOS configuration. [Expo: install updates in an existing React Native project](https://docs.expo.dev/bare/installing-updates/)
2. Run `eas update:configure`, then inspect every native diff. It adds `runtimeVersion` and `updates.url` to app config and configures the update URL and runtime in the native projects. Preserve the custom Android packages and all existing native configuration. [Expo: configuration details](https://docs.expo.dev/eas-update/getting-started/)
3. Enable updates in Android's manifest and iOS `Supporting/Expo.plist`, set the update URL to this project's existing EAS project ID, and make sure `Expo.plist` is included by the Xcode project. The present `EXUpdatesEnabled=false` settings must become enabled in the release binary. [Expo: bare configuration](https://docs.expo.dev/bare/installing-updates/)
4. Configure the `preview` or `production` channel in the corresponding native files. Build, sign, and distribute a new APK for preview and a new AAB for Play. The app signing identity and Android application ID stay unchanged so the binary updates the installed app.
5. Test the new binary before publishing. Build metadata, channel, and runtime must match the intended update. On a release build, force-close and reopen twice to download and then apply a published update. [Expo: test an update](https://docs.expo.dev/eas-update/getting-started/)

After the binary exists, publish a JS-only release with `eas update --channel preview --message "..."`, validate it, then publish the same tested revision to `production`. EAS Update uploads the exported bundle and assets to its update service. [Expo: publish an update](https://docs.expo.dev/eas-update/getting-started/)

## Launch behavior and data safety

The default behavior checks for updates on launch, downloads in the background, and applies the download on a later app restart. Its default launch wait is zero, so an offline launch starts the cached or embedded bundle without waiting for the network. Keep that default for a notes app. Do not call `Updates.reloadAsync()` while the editor is open, a recording is active, or backup/import work is running. [Expo SDK 54 updates usage](https://docs.expo.dev/versions/v54.0.0/sdk/updates/)

Treat SQLite and AsyncStorage changes as OTA compatibility work, even though the database itself is not part of the bundle. `src/database/schema.ts` currently has `CURRENT_SCHEMA_VERSION = 3`, and native archive/import code also accesses the same database. A downloaded update may run before or after an older cached bundle. Therefore:

- Make schema migrations backward-compatible with supported bundles and native code, and idempotent.
- Keep old JS and Kotlin native archive queries working until every supported binary has been replaced.
- Do not delete or reinterpret columns, keys, files, or persisted values in an OTA-only release.
- Take and verify a backup before testing migrations against an upgrade install with real notes and attachments.
- Make any irreversible migration or native archive contract change a new binary release with a changed runtime. A new binary still needs a safe data migration. Native dependency upgrades also require a new binary; JS-only dependency changes can use OTA when runtime-compatible.

Expo's rollback and error recovery are not a database rollback system. An early fatal JS error can cause a failed update to be avoided or an older update to launch, but Expo warns that rolling back after a change to persistent state can be unsafe. Test a forward update and rollback on a device with representative data. [Expo: error recovery](https://docs.expo.dev/eas-update/error-recovery/)

## Validation gate for each OTA

1. Confirm the diff is JS/assets only and that `expo.version` still matches the target binary runtime.
2. Publish to `preview`, then test a fresh install and an upgrade install with notes, folders, recordings, attachments, and backup history.
3. Confirm offline launch uses the cached update, then restore connectivity and verify download plus next-restart activation.
4. Exercise editor save, recording, share import, manual backup, automatic backup, and both headless backup task paths. These run from `index.ts` and must work from the downloaded release bundle.
5. Only then publish the same commit to `production`. If it fails after persistent data changes, fix forward unless rollback has been tested as safe.

The first enabled release is a binary rollout, not an OTA rollout. Subsequent JavaScript and asset fixes can use EAS Update. Native changes always start the cycle again with a new signed binary.
