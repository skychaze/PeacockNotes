# Peacock Notes

Peacock Notes is a local-first note app. This glossary defines its portable recovery language.

## Language

**Export archive**:
A self-contained file containing Peacock Notes content captured at one point in time.
_Avoid_: Backup, Drive backup

**Full import**:
Replacement of all current recoverable content with the contents of one export archive.
_Avoid_: Restore, sync

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
