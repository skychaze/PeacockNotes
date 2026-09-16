# Peacock Notes 1.1.4

Version 1.1.4 hardens backup and restore, media ownership, note editing, and
release packaging.

## Release

- Version: 1.1.4
- Version code: 14
- Built at: 2026-09-16 20:45:11 +0530
- APK: peacocknotes-v1.1.4-14.apk
- Android package: com.roy.peacocknotes

## Bug fixes

- Deleting a folder now removes notes and folders in its entire subtree.
- Media files are deleted only after checking that no other note still uses
  them.
- Startup reconciliation removes abandoned files from the app-owned media
  directories after an interrupted delete.
- Mixed audio and file share imports commit as one database operation, so a
  failed import does not leave half the attachments behind.
- Selective restores no longer delete unrelated local attachments, and
  restored items are appended after existing items instead of reusing archived
  positions.
- Full replacement restores persist their recovery journal before switching
  files, keep one owned undo snapshot, and clean abandoned staging data.
- Opening a note that fails to load now shows an error state instead of an
  editable blank note. Leaving with an active recording flushes it first, and
  concurrent or stale saves are rejected safely.
- Back now leaves selection mode before navigating away, Home clears stale
  editor routes, and recovered-copy titles follow the selected app language.
- Automatic backup recovery points are tied to the connected folder. Disconnecting
  a folder clears the saved recovery point.
- Storage usage counts UTF-8 note bytes and no longer double-counts note text
  inside the database card.
- Android release builds now require the configured release keystore. Android
  backup, broad storage permissions, and unsupported generic share types are
  disabled.

## OTA compatibility

- No OTA update is being published for 1.1.4. The reviewed fixes are bundled in
  the versioned binary.
- JavaScript-only changes in this release can be published to runtime 1.1.4.
- Existing 1.1.3 installs can receive only a JS-only backport published to
  runtime 1.1.3. The native fixes in this APK require installing version 1.1.4.
- Android archive transaction changes, manifest and permission changes, and
  release signing checks require this binary.

## Validation

- `npm run verify:recovery`
- `./gradlew assembleRelease`
