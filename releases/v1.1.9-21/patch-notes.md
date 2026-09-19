# Peacock Notes 1.1.9

Version 1.1.9 ships the attachment actions and folder view improvements from PR #52.

## Release

- Version: 1.1.9
- Version code: 21
- Android package: com.roy.peacocknotes

## Changes

- Download one attachment, selected attachments, or all attachments into a user-selected Android folder.
- Preserve attachment names while adding extensions and suffixes for duplicate names.
- Select multiple documents in the attachment picker.
- Show saved and unsaved state in the note editor.
- Switch between grid and list views for folders, with the choice saved on the device.
- Keep folder sorting, custom reorder, view controls, and quick navigation in one menu.
- Add English and Bengali labels for the new attachment and folder actions.

## Compatibility

- Existing notes, folders, and attachment data remain compatible with the 1.1.8 runtime.
- The package name and signing key remain unchanged, so Android can update the existing installation in place.

## OTA compatibility

- The new Android attachment download module requires this binary release.
- JavaScript-only updates can target runtime 1.1.9 after this binary is installed.

## Validation

- `npm run verify:recovery`
- `./gradlew assembleRelease`
- Android release APK metadata and share filters verified from the built APK
