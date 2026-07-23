App Update Details - Peacock Notes
Date: 2026-04-16

1) What was implemented in this update

- Added folder rename/edit support.
- Added advanced sorting for folders and notes:
  - Custom
  - Name
  - Created time
  - Ascending/Descending for non-custom sorts
- Added manual reordering (click-based Up/Down) in Custom mode:
  - Move folders up/down
  - Move notes up/down within a folder
- Added DB migration support for stable ordering with sortOrder fields.
- Added i18n translation entries for new rename/sort/reorder UI text.
- Updated launcher assets from provided icon source.

2) Why a separate app installed earlier

- Previous release APK had package/applicationId: com.anonymous.Note_app
- Desired app identity in config is: com.roy.peacocknotes
- Android treats different package IDs as different apps, so it installed separately.

3) Identity and signing fixes done now

- Aligned Android package identity to com.roy.peacocknotes.
- Updated native Kotlin package paths/classes:
  - MainActivity
  - MainApplication
- Increased version values:
  - versionCode = 2
  - versionName = 1.0.1
- Configured release signing with a dedicated keystore (not debug signing).

4) Release signing details (IMPORTANT)

- Keystore file: android/peacocknotes-release-key.jks
- Keystore config: android/keystore.properties
- Release cert SHA-256:
  10dea67f2310ca7aa934763782951008c30edbebcb86b8e084b91b2931d802ed

IMPORTANT:
- Keep backups of both files above in a safe place.
- Losing this key means future in-place updates for this app ID may become impossible.

5) Built APK details

- APK path:
  android/app/build/outputs/apk/release/app-release.apk
- APK package verified:
  com.roy.peacocknotes
- APK version verified:
  versionCode=2, versionName=1.0.1
- APK signing verified:
  signed by release cert above (not Android debug cert)

6) Rules for all future updates (to avoid duplicate app installs)

- Always keep the same package ID: com.roy.peacocknotes
- Always sign with the same release keystore: android/peacocknotes-release-key.jks
- Always increment versionCode for each new release

7) Extra note

- A build-time workaround was added in Gradle to patch a stale generated React Native
  entrypoint reference that kept old package text during release build generation.

8) APK naming for every future build

- Release output now also creates a versioned APK filename for easier tracking:
  peacocknotes-v<versionName>-<versionCode>.apk
- Example for current version:
  peacocknotes-v1.0.1-2.apk
- Location:
  android/app/build/outputs/apk/release/

9) Release packaging rule for every future build

- Every release build now auto-archives to:
  releases/v<versionName>-<versionCode>/
- Each archive folder contains:
  - peacocknotes-v<versionName>-<versionCode>.apk
  - patch-notes.md
- patch-notes.md is auto-created with a template and release metadata if missing.
- Keep patch notes updated with final validated changes before sharing the APK.
