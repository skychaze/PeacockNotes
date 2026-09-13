# Peacock Notes 1.0.7 (8)

## Features

- Adds user-controlled opportunistic Automatic backup with Android scheduling and app-open catch-up.
- Adds verified archive collection health, selective recovery, additive import, and rollback-safe replacement recovery.
- Adds safe seven-day managed retention while preserving the newest valid recovery point.
- Adds one-time Google Drive sign-in with a dedicated `Peacock Notes Backups` folder, resumable uploads, and read-back verification.

## Reliability

- Preserves conflicting imports as recovered copies and restricts recovery around damaged current media.
- Adds bounded retries, truthful permission/provider/connectivity states, and release-blocking recovery checks.
- Removes the Android folder picker from the backup destination; Drive is now the connected backup destination.

## Verification notes

- Built locally from `feat/backup-recovery` for physical-device recovery testing.
