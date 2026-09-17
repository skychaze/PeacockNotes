# Peacock Notes 1.1.7

Version 1.1.7 adds inline attachment mentions to notes.

## Release

- Version: 1.1.7
- Version code: 19
- Android package: com.roy.peacocknotes

## Changes

- Type `@` in the editor to tag an audio recording, image, or PDF attachment.
- Tagged attachments keep their identity when a note is saved and restored.
- Read mode renders tagged attachments as tappable inline links. Audio links play the recording, while file links open the attachment.
- Removing or renaming an attachment keeps note text readable instead of leaving a broken reference.
- Note previews and search ignore the internal attachment token and use the visible attachment name.
- Backup imports rebuild the search index after restoring notes with attachment mentions.

## Compatibility

- Existing notes migrate to schema version 5 without changing their stored content.
- The package name and signing key remain unchanged, so SQLite data and app files stay in place during an update.

## OTA compatibility

- No OTA update is being published for 1.1.7. Install this binary to move to runtime 1.1.7.

## Validation

- `npm run verify:recovery`
- `./gradlew assembleRelease`
- Release APK metadata and Android share filters verified from the built APK
