# Peacock Notes 1.1.2

Version 1.1.2 puts the app on over-the-air updates and makes backup and
restore progress visible for large archives. It is the first binary that can
receive later JS-only updates without a reinstall.

## Release

- Version: 1.1.2
- Version code: 12
- Built at: 2026-09-14 14:45:54 +0530
- APK: peacocknotes-v1.1.2-12.apk
- Android package: com.roy.peacocknotes

## Over-the-air updates

- Added expo-updates with the `appVersion` runtime version policy, so a
  downloaded bundle only loads against the binary it was built for.
- Embedded channels in the native manifest: internal APKs use `preview`,
  released builds use `production`.
- Updates are checked on launch. JS, TypeScript, style, translation, and
  bundled-asset changes can ship without a new build; native changes still
  need one.
- Install 1.1.2 first. Older installs and any future native change require a
  new signed build.

## Backup and restore progress

- Backup, restore, archive preview, and retention now report live byte and
  item counts from the native work instead of fixed phase percentages.
- Progress keeps updating while the app is in the background and after
  leaving the Backup screen. A stopped process shows an interrupted state
  instead of a stale percentage.
- Archive previews and collection scans verify media hashes without
  extracting media to disk.

## Reliability and compatibility

- Bumped Expo SDK 54 packages (expo 54.0.37, expo-constants, expo-file-system,
  expo-font, expo-linking) and added react-native-worklets for Reanimated 4.
- Added a Gradle JVM memory plugin so local and CI release builds keep
  enough metaspace.
- Releases now build the signed APK in GitHub Actions and attach it to the
  GitHub release.

## Known issues

- OTA updates only work on 1.1.2 and later.
- `expo-av` is deprecated in Expo SDK 54 and still logs a startup warning.

## Validation

- `npm run typecheck`
- `npm test`
- `npm ci --dry-run`
- `./gradlew assembleRelease` (2026-09-14)
- APK version and package inspected: `com.roy.peacocknotes` 1.1.2 (12)
