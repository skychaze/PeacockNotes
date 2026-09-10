# Peacock Notes - Patch Notes

## Release
- Version: 1.0.5
- Version code: 6
- Built at: 2026-09-10 15:49:32 +0530
- APK: peacocknotes-v1.0.5-6.apk

## Updates
- Native Android project is now synced by `npx expo prebuild` before builds, so app.json config (share filters, permissions, icons, version) actually ships in the APK.
- A local config plugin (`plugins/withShareIntentFilterCleanup.js`) makes repeated prebuilds idempotent by stripping stale share intent filters before expo-share-intent re-adds the configured ones.
- Share import now accepts any shared file and routes it to the import screen; unsupported types show a clear "no shared files" state instead of a silent stop on Folders.
- Sharing placeholders updated to cover files, not just audio.
- Share import failure now rolls back only files that were not committed, and partial copy failures clean up after themselves.
- Append recording is now guarded end to end: a finalize guard prevents double-stops, the copy retries once, segments are numbered from the highest existing index, the audio mode resets after recording, and Remove is disabled on a group while it is being recorded.
- Audio share picker now lists every segment of a group separately, so appended parts are not silently dropped.
- Tapping a PDF opens it with the file's own mime type and falls back to the system share sheet if no app can open it.
- Image viewer is a static full-screen view; it was never a gesture viewer, and the old pinch-zoom claims were removed from the v1.0.4-5 notes.

## Bug Fixes
- Fixed image/PDF/other file shares never reaching the app: the built APK only registered `audio/*` because the native project was built without running Expo config plugins. The APK now registers `audio/*`, `image/*`, `application/pdf`, and `application/*` for `SEND` and `SEND_MULTIPLE`.
- Fixed cold-start shares never opening the import screen: navigation now waits for the navigation container to be ready, and the share state is no longer duplicated between App and ShareImportScreen.
- Fixed file-only shares opening on Folders: the app used to filter shares to audio before navigating.
- Fixed the "Add File" button showing the raw key `editor.addFile`; it now uses the `editor.fileImport` translation.
- Fixed orphaned media files: removed attachments, deleted notes, deleted folders, and replaced attachments now delete their files from the app's audio/files folders. Failed share imports clean up their copies.
- Fixed the recording cleanup effect double-stopping a finished recording and unloading active playback; cleanup now runs only on unmount.
- Fixed reorder up/down arrows producing wrong moves while a search filter is active; reordering is disabled until the search is cleared.
- Fixed missing database transactions: create/update note, append audios/files, and reorder operations now run in SQLite transactions.
- Fixed Storage Usage total double-counting note text that is already inside the database size.
- Fixed long notes being clipped at a 1600px editor height; the editor now grows with the content.
- Fixed Share Text copying an empty clipboard when only the title existed; it now copies the same text it shares.
- Removed dead translations and an unused database column select.

## Known Issues
- `expo-av` is deprecated in Expo SDK 54 and logs a warning at startup; migration to `expo-audio` is pending.
- An app that sends an unreadable content URI can still crash the native expo-share-intent parser (upstream bug, no JS-side guard).
- Pinch-to-zoom in the image viewer is not implemented.

## Notes
- Verified on an Android API 36 emulator: cold-start image/PDF/audio shares, end-to-end import, append recording (record a second segment, queue playback, persist after save), PDF open in Google Drive, full-screen image viewer, share out (text, audio per segment, file), attachment removal, note deletion, storage accounting, and reorder under search.
- `android/` remains generated and gitignored; rebuild with the updated compile-apk skill steps.
