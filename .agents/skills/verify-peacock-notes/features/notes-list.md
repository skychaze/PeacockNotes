# Notes list (`NotesListScreen`, route `NotesList`)

## Sub-features

- List notes of one folder (title, preview, date, audio/paperclip counts).
- Search (`Search notes`; empty state `No matching notes`).
- Sort (`Sort by`: `Custom` / `Name` / `Created Time`); custom `Reorder`
  (disabled while a search is active: `Clear the search to reorder`).
- Delete note (long-press, `Delete`, confirm `Delete note?`).
- `+` FAB opens the editor for a new note in this folder.

## How to get to it (user POV)

Tap a folder card on the Folders screen; the header shows the folder name.
Empty folders show `No notes yet` / `Create your first note using the button
below`. Top-bar back arrow returns to Folders.

## Driving it with agent-device

1. From Folders, tap the `VERIFY-` folder card (create one first if none).
2. `wait text "Search notes"`, screenshot. Tap `+`, create a note per
   `note-editor.md`, save, back.
3. Proof: the new note row appears with its title; `fill` the search field
   with a substring and only matching rows remain; clearing restores all.
4. Cleanup: long-press each `VERIFY-` note, `Delete`, confirm.

## Gotchas

- Reorder arrows do nothing while searching. Delete has no undo, confirm
  dialog shows the note title.
