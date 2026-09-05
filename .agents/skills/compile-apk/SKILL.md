---
name: compile-apk
description: Use when asked to compile the project.
---

# Compile APK

Use this skill to build the release Android APK for Peacock Notes and archive release artifacts.

## Version Update

When making major changes:
1. Update version in `app.json` (`expo.version`).
2. Update `versionCode` and `versionName` in `android/app/build.gradle`.

## Prerequisites
Syncing messages...

1. Ensure Java Development Kit (JDK) is active.
2. Ensure Android SDK is active.
3. Ensure the `ANDROID_HOME` environment variable is set.

## Compile Steps

1. Open a terminal in the project root directory.
2. Change directory to android.
3. Run the assemble release command:

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
3. Create `patch-notes.md` in that folder describing features, bug fixes, and notes.

## Verify the Build

1. Check that the build finishes without errors.
2. Verify that the APK and patch notes exist in the release folder.
