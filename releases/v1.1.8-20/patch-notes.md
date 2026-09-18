# Peacock Notes 1.1.8

Version 1.1.8 bundles the editor and update improvements merged after 1.1.7, including PRs #48 through #51.

## Release

- Version: 1.1.8
- Version code: 20
- Android package: com.roy.peacocknotes

## Changes

- Attachment suggestions open in a keyboard-aware bottom sheet, while the editor controls stay visible.
- Editor controls and the floating action button move above the keyboard instead of being covered by it.
- The in-app updater shows the target version and download progress on Home.
- Audio playback restores the correct audio mode before playing a recording.
- Long-press attachments to select several audio recordings or files, then share or delete them together.
- Multiple selected attachments use Android's native share sheet with the correct URI permissions and MIME types.
- The attachment picker groups audio and file imports behind one Add attachment action.
- Storage usage now includes a cache clear action that leaves notes and attachments in place.
- Removed the misleading clipboard-sharing hint from the editor.

## Compatibility

- Existing notes and attachment data remain compatible with the 1.1.7 runtime.
- The package name and signing key remain unchanged, so Android can update the existing installation in place.

## OTA compatibility

- No OTA update is being published for 1.1.8. Install this binary to move to runtime 1.1.8.

## Validation

- `npm run verify:recovery`
- `./gradlew assembleRelease`
- Release APK metadata and Android share filters verified from the built APK
