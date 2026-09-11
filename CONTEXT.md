# Peacock Notes

Peacock Notes is a local-first note app. This glossary defines its portable recovery language.

## Language

**Export archive**:
A self-contained file containing Peacock Notes content captured at one point in time. The interface calls creating one "Export Backup."
_Avoid_: Database backup, Drive backup

**Backup collection**:
The validated export archives stored directly inside the connected backup folder.
_Avoid_: Backup database, cloud history

**Connected backup folder**:
The Android document-provider folder the user has authorized Peacock Notes to read and write.
_Avoid_: Drive account, cloud database

**Managed retention**:
The accepted policy that removes expired archives from a connected backup folder while always preserving its newest valid recovery point.
_Avoid_: Cleanup, count limit

**Automatic backup**:
Explicitly enabled, opportunistic creation of an export archive when changed recoverable content is due. It is not an exact daily schedule or proof of remote cloud synchronization.
_Avoid_: Scheduled backup, cloud sync

**Due backup**:
Changed recoverable content whose last verified archive is at least 24 hours old.
_Avoid_: Missed backup, failed backup

**Additive import**:
Atomic recovery of every archived note under the selective-import conflict rules, without deleting or overwriting current content.
_Avoid_: Merge, replacement

**Full replacement import**:
Atomic replacement of current recoverable content with one validated export archive while device-local configuration remains intact.
_Avoid_: Sync, database copy

**Selective import**:
Recovery of user-selected archived notes without overwriting or deleting current content.
_Avoid_: Merge, selective restore

**Portable identity**:
The immutable identity that follows a folder, note, audio item, or attachment across export and import.
_Avoid_: Database ID, row ID

**Recovered copy**:
A new note created from an archived version when the same portable identity currently has different content.
_Avoid_: Duplicate, overwritten note

**Recovery provenance**:
The source identity and archived version information retained by a recovered copy.
_Avoid_: History, origin metadata
