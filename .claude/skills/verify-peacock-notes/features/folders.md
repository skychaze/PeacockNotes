# Folders (`FoldersScreen`, route `Folders`)

## Sub-features

- Create folder (`New Folder` sheet, `Enter folder name`, `Create`).
- Rename folder (long-press card, `Rename`, `Rename folder` sheet).
- Delete folder (long-press card, `Delete`, confirm `Delete folder?` /
  `Delete "{name}" and all notes inside it?`).
- Sort (`Sort by`: `Custom` / `Name` / `Created Time`, `A-Z / Oldest first` /
  `Z-A / Newest first`); custom `Reorder` with up/down arrows.
- Quick menu (top-bar dots): `Storage Usage`, `Backup` entries navigate.

## How to get to it (user POV)

Launch lands on Folders (header `Folders`, empty state `No folders yet` /
`Create a folder using the button below`). The `+ folder` FAB opens the
create sheet. Long-press a folder card for Rename/Delete. Top-bar icons open
sort and the quick menu.

## Driving it with agent-device

1. `open com.roy.peacocknotes --foreground`, `snapshot -i`, tap `EN`.
2. `wait text "Folders"`. Tap the create FAB, `fill` the `Enter folder name`
   field with `VERIFY-<run>`, tap `Create`.
3. `wait text "VERIFY-<run>"`, screenshot. Proof: the card shows `0 notes`,
   survives back-navigation (reopen app, card still there).
4. Cleanup: long-press the card, `Delete`, confirm `Delete`; `wait` until the
   name disappears.

## Gotchas

- Empty name shows `Missing name` / `Please enter a folder name.` and creates
  nothing. Deleting a folder deletes its notes with no undo.
