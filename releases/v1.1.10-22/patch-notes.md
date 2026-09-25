# Peacock Notes 1.1.10

## Release

- Version: 1.1.10
- Version code: 22
- Android package: com.roy.peacocknotes

## Changes

- Long note titles wrap in the editor so the full title remains readable.
- Back and Home wait for a pending note save before leaving the editor.
- Automatic backup progress uses one notification ID while the worker hands work to the backup service.
- App startup clears an idle manual backup notification left after an interrupted process.

## Compatibility

- Existing notes, folders, and attachments remain compatible.
- This release includes an Android backup worker change and uses runtime 1.1.10. Earlier binaries cannot receive that native change through OTA.
- The package name and signing key are unchanged, so Android can update an existing installation in place.

## Validation

- `npm run verify:recovery`
- Android release APK build and metadata checks
- Emulator checks for long titles and Back and Home saves
- A connected scheduled backup was unavailable in the emulator, so the reporter's exact backup notification sequence still needs confirmation on a connected device.
