# Peacock Notes 1.1.3

Version 1.1.3 restores the hierarchical archive preview that shipped in 1.1.0
and was missing on the 1.1.2 line. It also adds a direct way home from the
note editor.

## Release

- Version: 1.1.3
- Version code: 13
- Built at: 2026-09-16 17:00:07 +0530
- APK: peacocknotes-v1.1.3-13.apk
- Android package: com.roy.peacocknotes

## Restore preview

- The selective restore list is a tree again: a folder row is followed by its
  nested folders and then its notes. Folders start collapsed.
- Every folder row has a tri-state checkbox. Checking a folder selects every
  note under it, including notes in nested folders; unchecking clears them; a
  partial selection shows the indeterminate state. Expanding or collapsing
  never changes the selection.
- Folder rows show how many notes they contain, and notes show their folder
  path, preview, and audio/file counts.
- Folders are matched by portable identity rather than by name, so two
  folders that share a display name never merge.
- Archives written by 1.1.1 and 1.1.2 have no recorded folder hierarchy; their
  preview still renders flat folder rows with the same checkboxes.

## Note editor

- A Home button in the editor saves the current draft, finishes an active
  recording, and opens Folders directly.

## Reliability and compatibility

- Selective and full-replacement restores recreate missing folder ancestors
  from the root down and reuse an existing folder only when its parent
  matches.
- New archives record folder parents (archive database version 2). Archives
  written by 1.1.0 through 1.1.2 still validate and restore.
- Undoing a full replacement works even when the safety snapshot was taken
  before the folder hierarchy column existed.

## Notes

- This release changes native Android code, so existing 1.1.2 installs cannot
  receive it through the over-the-air update channel. Install this APK once;
  later JavaScript-only changes can be delivered over the air again.
- The restore preview change reached 1.1.2 installs through the production
  update channel as a JavaScript update before this build.
