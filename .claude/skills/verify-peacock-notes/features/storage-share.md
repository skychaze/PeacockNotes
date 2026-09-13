# Storage usage and share import (`StorageUsageScreen`, `ShareImportScreen`)

## Sub-features

- Storage Usage: note count, notes/audio/file/database byte breakdown with
  ring and bars; per-folder accents.
- Share import (`Import Shared Files`): files shared from other apps
  (audio, images, PDFs) land here for attaching to a folder/note instead of
  the editor.

## How to get to it (user POV)

Storage Usage via the Folders quick menu. Share import opens automatically
when another app shares a supported file into Peacock Notes (share filters
are in `app.json`; the APK must be prebuilt after changing them, see the
compile-apk skill).

## Driving it with agent-device

1. Storage: open the quick menu, tap Storage Usage; `wait text "Storage
   Usage"`. Proof: note count matches the folders screen total; create a
   `VERIFY-` note with text and the notes byte value grows after returning.
2. Share: from a second app (or `adb shell am start -a android.intent.action.SEND`),
   send an image to Peacock Notes; `wait text "Import Shared Files"`.
   Proof: the file row appears and completes attach into the chosen note.
3. Cleanup: delete `VERIFY-` notes used for the storage delta.

## Gotchas

- Byte values are rounded (`B`/`KB`/`MB`), so tiny notes may show no delta:
  use a body of a few KB. Share import needs a sender app on the emulator;
  if none is installed, only the storage half is provable, say so.
