# Backup (`BackupScreen`, route `Backup`)

## Sub-features

- Export archive (`Export Backup`): captures notes and media, uploads to the
  connected backup folder, re-reads to verify; progress runs through
  capturing, building, publishing, verifying.
- Import: newest-archive preview; selective import (chosen notes),
  additive import (all notes, conflicts become recovered copies), full
  replacement import (replaces content, keeps device config) with undo.
- Automatic backup switch: enabled means a due backup (changed content, no
  verified archive for 24h) is attempted when network and battery allow; it
  is not an exact daily schedule or cloud sync.
- Backup collection list with delete; managed retention keeps the newest
  valid recovery point.

## How to get to it (user POV)

Folders quick menu (top-bar dots) `Backup`, header `Backup`. Needs a
connected backup folder (Android document-provider folder picker) and a
Google sign-in for Drive upload; without them export cannot finish.

## Driving it with agent-device

1. From Folders, open the quick menu, tap Backup; `wait text "Backup"`.
2. Proof without cloud: toggle automatic backup and confirm the state text
   flips; open the newest-archive preview and confirm listed notes match the
   current content. Full export/import proof needs the connected folder and
   network: run `Export Backup`, wait for the verified state naming the new
   `.pnbak` archive, screenshot it.
3. Cleanup: delete only archives the run created, never the newest pre-run
   recovery point; leave the automatic-backup switch as found.

## Gotchas

- Drive upload needs network and sign-in on the emulator; without them only
  the local parts are provable, say so in the report. Replacement import is
  destructive: prove it only with `VERIFY-` content and exercise undo right
  after. Discovery scans on launch, so wait for loading to settle before
  asserting.
