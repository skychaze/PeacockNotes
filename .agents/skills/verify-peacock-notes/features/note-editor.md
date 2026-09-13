# Note editor (`NoteEditorScreen`, route `NoteEditor`)

## Sub-features

- Text note: `Note title` (required) plus `Write your note here...`; top-bar
  save icon; leaving with edits auto-saves (`No text yet` for empty body).
- Audio: `Start Recording` / pause / `Stop Recording` (mic permission
  prompt on first use), `Import Audio`, per-group play/stop (`Play`),
  rename, details, `Add` segment, share, delete.
- Files: `Add File` (images/PDF via document picker), open, share, remove.
- Overflow menu: `Copy Text`, `Share Text` (also copies to clipboard).

## How to get to it (user POV)

`+` FAB in a notes list (header `New Note`) or tapping a note row (header
`Edit Note`). Back navigates out and auto-saves a non-empty draft.

## Driving it with agent-device

1. From a `VERIFY-` folder's notes list, tap `+`; `wait text "Note title"`.
2. `fill` title `VERIFY-note-<run>`, `fill` body, tap save; screenshot.
3. Proof: back in the list, `wait text "VERIFY-note-<run>"`; reopen it and
   the body text persists. Audio recording needs mic permission: grant it on
   the system dialog; playback proof is `Playing <elapsed> / <total>`.
4. Cleanup: delete the `VERIFY-` note from the list.

## Gotchas

- Save is disabled with an empty title; the app auto-saves on exit instead
  of warning, so an abandoned `VERIFY-` draft still creates a note: always
  delete it. Recording while another group plays stops playback first.
