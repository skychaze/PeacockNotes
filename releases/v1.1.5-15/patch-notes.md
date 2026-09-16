# Peacock Notes 1.1.5

Version 1.1.5 updates backup scheduling, archive retention, and restore browsing.

## Release

- Version: 1.1.5
- Version code: 15
- Android package: com.roy.peacocknotes

## Changes

- Import now opens on its own screen with the connected archive list and a
  selectable folder and note tree.
- Cached archive previews open without repeating validation. Import commits still
  perform full validation and hash checks.
- Automatic backups support 1, 3, 6, 12, and 24 hour intervals. WorkManager may
  run opportunistically when network and battery constraints allow.
- Managed retention keeps the seven newest valid archives. Damaged and uncertain
  archives do not count toward the limit.
- English and Bengali backup labels cover the new schedule and import flows.

## OTA compatibility

- No OTA update is being published for 1.1.5. The native archive and scheduler
  changes require installing this binary.

## Validation

- `npm run verify:recovery`
- `./gradlew assembleRelease`
