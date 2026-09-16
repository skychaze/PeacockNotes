---
name: compile-apk
description: Use when asked to compile the project.
---

# Compile APK

Use this skill to build the release Android APK for Peacock Notes and archive release artifacts.

## Version Update

Bump the version in `app.json` only:
1. `expo.version` (becomes `versionName`).
2. `expo.android.versionCode`.
3. `expo.runtimeVersion` (a literal string, set to the same version). `eas update` refuses the `appVersion` policy in this bare project, and a stale literal sends published updates to the wrong installs.

`expo prebuild` writes both into `android/app/build.gradle`, so do not edit Gradle versions by hand.

## Sync Native Project

`android/` is committed, so a clean checkout builds without regenerating it. Config plugin changes (share intent filters, permissions, icons) and version bumps only reach the APK after a prebuild:

```bash
npx expo prebuild --platform android --no-install
```

Run this before tagging a release and commit the rewritten files. Never pass `--clean`: the project owns native files and custom package registration under `android/app/src/main/java/com/roy/peacocknotes/`. The release workflow builds the committed project as-is.

Verify the manifest carries the configured share filters before building:

```bash
grep -c 'android.intent.action.SEND' android/app/src/main/AndroidManifest.xml
```

## Prerequisites

1. Ensure Java Development Kit (JDK) is active.
2. Ensure Android SDK is active.
3. Ensure the `ANDROID_HOME` environment variable is set.

## Compile Steps

1. Open a terminal in the project root directory.
2. Sync the native project if `app.json` or config plugins changed (see above).
3. Change directory to android.
4. Run the assemble release command:

```bash
cd android
./gradlew assembleRelease
```

4. Wait for the build process to finish.
5. Gradle automatically copies the signed APK into `releases/v<version>-<code>/peacocknotes-v<version>-<code>.apk`.

## Release Artifacts

For each release:
1. Create a folder in `releases/v<version>-<code>/`.
2. Ensure the APK exists in that folder.
3. Create `patch-notes.md` in that folder covering every user-visible change: features, bug fixes, compatibility notes, and any over-the-air updates delivered under this runtime version. Commit it before tagging. The release workflow refuses a tag whose commit has no patch notes, and otherwise publishes the file as the GitHub release body.

## Over-the-air Updates

JavaScript-only changes ship with `eas update` and have no tag of their own, so they never produce a GitHub release. Keep the release notes complete anyway:

1. Append each OTA change to the `patch-notes.md` of the release folder whose runtime version it targets. The runtime version is the literal `expo.runtimeVersion`, which matches `expo.version`.
2. Use the same summary for the EAS update message and the patch-notes entry, so the update log and the release notes agree.

## Verify the Build

1. Check that the build finishes without errors.
2. Verify that the APK and patch notes exist in the release folder.
3. Verify the share filters shipped inside the APK (not just in the source manifest):

```bash
$ANDROID_HOME/build-tools/<version>/aapt2 dump xmltree --file AndroidManifest.xml releases/v<version>-<code>/peacocknotes-v<version>-<code>.apk | grep -B2 -A4 'android.intent.action.SEND'
```
