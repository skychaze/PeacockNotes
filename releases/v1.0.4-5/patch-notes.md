# Peacock Notes - Patch Notes

## Release
- Version: 1.0.4
- Version code: 5
- Built at: 2026-07-23 21:09:56 +0530
- APK: peacocknotes-v1.0.4-5.apk

## Features
- Added image and PDF file attachment support to notes
- Share images and PDFs from other apps directly into Peacock Notes
- In-app image viewer: tap an image to open it full-screen; tap anywhere or the close button to dismiss
- PDFs open via system app picker: tap a PDF file to choose any installed PDF reader
- Share button per file: uses the system share sheet (separate from tap-to-open)
- File storage now tracked separately in Settings > Storage Usage
- Broad share intent filter (audio, image, PDF, and other file types)

## Bug Fixes
- Fixed PDF opening: uses `expo-intent-launcher` with `FLAG_GRANT_READ_URI_PERMISSION` so the external PDF reader can access the file
- Removed broken swipe-between-images (each image opens individually)

## Known Issues
- The image viewer is static: pinch-to-zoom and double-tap zoom were never shipped and are not claimed here.

## Notes
- File attachments use a new `NoteFiles` database table (separate from `NoteAudios`)
- Existing notes are fully preserved: no schema migrations on existing tables
- PDF viewing via `expo-intent-launcher` with `ACTION_VIEW` intent
