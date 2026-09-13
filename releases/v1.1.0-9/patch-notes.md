# Peacock Notes 1.1.0

Version 1.1.0 adds a reliable cloud recovery path while keeping notes local by
default. It also adds a few focused changes to the folders, backup, and editor
workflows.

## Release

- Version: 1.1.0
- Version code: 9
- Built at: 2026-09-13 23:45:16 +0530
- APK: peacocknotes-v1.1.0-9.apk
- Android package: com.roy.peacocknotes

## Cloud backup and restore

- Added Google Drive as the cloud backup destination. Sign in once and Peacock
  Notes creates and uses a dedicated `Peacock Notes Backups` folder.
- Added verified backup archives with resumable uploads and read-back checks, so
  a successful backup means the archive was written and validated in Drive.
- Added opt-in automatic backups with Android scheduling, app-open catch-up,
  foreground progress notifications, and recovery after an interrupted operation.
- Added archive collection health with explicit states for valid, damaged,
  incompatible, and temporarily uncertain archives.
- Added safe managed retention. The app removes only eligible verified archives
  and keeps a valid recovery point within the seven-day retention window.
- Added restore preview for the newest archive or any archive in Drive.
- Added selective restore with an expandable folder tree and tri-state folder
  selection, so individual notes can be restored without replacing everything.
- Added additive restore that keeps current notes and saves conflicts as
  recovered copies.
- Added full replacement restore with staged database and media verification,
  rollback on failure, and a seven-day undo point after a successful switch.
- Damaged or missing media is reported and restricted during recovery instead of
  risking the current local data.

## Small UI and workflow changes

- Added a cloud backup status control to the Folders screen, with a quick status
  message for the latest verified backup.
- Added folder multi-select with stale-selection cleanup and one-confirmation
  batch deletion.
- Updated the Backup & Restore screen with automatic backup controls, archive
  health, progress and error states, archive selection and deletion, and clear
  restore results.
- Added a hierarchical archive preview with folder expansion, note counts, and
  media counts before selective restore.
- Added a Home action to the note editor. It saves changed drafts and flushes an
  active recording before leaving, and back navigation waits while that save is
  in progress.
- Kept the glass visual language while tightening the top-bar actions and the
  new backup and selection controls around it.

## Reliability and compatibility

- Added durable operation records, idempotent import receipts, portable content
  identities, and recovery provenance for safer retries and conflict handling.
- Added Android foreground services for manual backup work and included them in
  the packaged release manifest.
- Regenerated the native Android project before the release build so the APK
  includes the current backup services, permissions, icons, and share filters.
- Preserved the existing attachment and share flows, including audio, image,
  PDF, and other application files through Android `SEND` and `SEND_MULTIPLE`
  intents.

## Known limitations

- Google Drive backup needs a signed-in Google account and network access.
- `expo-av` is deprecated in Expo SDK 54 and still logs a startup warning.
- An unreadable content URI can still crash the upstream native share parser.
- Pinch-to-zoom is not available in the image viewer.

## Validation

- `npm run typecheck`
- `npm test`
- `npm run test:android`
- `npx expo prebuild --platform android --no-install`
- `./gradlew assembleRelease`
- APK version, package name, signing output, and packaged share filters inspected
