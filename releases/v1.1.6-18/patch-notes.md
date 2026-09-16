# Peacock Notes 1.1.6

Version 1.1.6 adds in-app APK update checks and a guided install flow.

## Release

- Version: 1.1.6
- Version code: 18
- Android package: com.roy.peacocknotes

## Changes

- Peacock Notes checks the latest public GitHub release at startup and from the Updates screen.
- The home screen shows an update badge when a newer version is available.
- The Updates screen downloads the APK, verifies its advertised size, and opens Android's package installer.
- Verified downloads survive navigation, app restarts, and failed later checks.
- The app opens Android's "Allow app installs" settings when permission is needed, then resumes installation when the user returns.
- Release assets are accepted only when their filename version matches the release tag.

## Compatibility

- This release adds the native `REQUEST_INSTALL_PACKAGES` permission. Existing installs need one manual install of this binary before in-app updates can work.
- The package name and signing key remain unchanged, so SQLite data and app files stay in place during an update.

## OTA compatibility

- No OTA update is being published for 1.1.6. The updater permission and native module require this binary.

## Validation

- `npm run typecheck`
- `npm test`
- `npm run test:android`
- `./gradlew assembleRelease`
- Android emulator update, installer, offline, language, and regression flows
