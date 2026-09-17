# Note editor (`NoteEditorScreen`, route `NoteEditor`)

## Sub-features

- Text note: `Note title` (required) plus `Write your note here...`; top-bar
  save icon; leaving with edits auto-saves (`No text yet` for empty body).
- Audio: `Start Recording` / pause / `Stop Recording` (mic permission
  prompt on first use), `Import Audio`, per-group play/stop (`Play`),
  rename, details, `Add` segment, share, delete.
- Files: `Add File` (images/PDF via document picker), open, share, remove.
- Overflow menu: `Copy Text`, `Share Text` (also copies to clipboard).
- Inline attachment tags: typing `@` replaces the bottom toolbar with
  `Choose an attachment to tag` and one row per attachment (`No attachments
  in this note yet` when empty); typing filters by name. Picking a row
  inserts a tag (`@<name>`) into the text. `Read note` renders the body with
  tags as tappable inline chips (`Back to editing` returns): an audio tag
  plays/stops its group, an image tag opens the full-screen viewer, other
  files use the platform viewer. Renaming an attachment updates its tag
  label, and list previews / `Copy Text` show names rather than the stored
  identity token `@[name](audio|file:<portableId>)`.

## How to get to it (user POV)

`+` FAB in a notes list (header `New Note`) or tapping a note row (header
`Edit Note`). Back navigates out and auto-saves a non-empty draft.

## Driving it with agent-device

1. From a `VERIFY-` folder's notes list, tap `+`; `wait text "Note title"`.
2. `fill` title `VERIFY-note-<run>`, `fill` body, tap save; screenshot.
3. Proof: back in the list, `wait text "VERIFY-note-<run>"`; reopen it and
   the body text persists. Audio recording needs mic permission: grant it on
   the system dialog; playback proof is `Playing <elapsed> / <total>`.
4. Tags: record or import an attachment first, then `fill`/`press` into the
   body and `type " @"`; the suggestion panel lists every attachment. Tap a
   suggestion, save, then `Read note` and tap the chip. Audio proof is the
   row switching to `Stop` + `Playing ...`; image proof is the viewer's
   `Close` button. Typing a partial name filters the panel; `type` appends at
   the cursor, so place the cursor with `press <x> <y>` first.
5. Cleanup: delete the `VERIFY-` folder (removes its notes) from Folders.

## Gotchas

- Save is disabled with an empty title; the app auto-saves on exit instead
  of warning, so an abandoned `VERIFY-` draft still creates a note: always
  delete it. Recording while another group plays stops playback first.
- Tags store an identity token in the note body; never `fill` the body with
  visible text from a snapshot, because that would rewrite the tokens.
  Use `type` to append, or re-create the note.
- `agent-device clipboard read` is unsupported on this Android image, so
  copy-path proof relies on list previews and the unit tests.
- Attachment tags resolve by portable identity, then by a unique name; a
  restored copy whose attachment identities changed still shows the tag.
  A tag whose attachment was deleted renders as plain text.
