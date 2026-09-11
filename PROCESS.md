# Process log

## 2026-09-11 11:40 UTC

- Resumed the Drive export and recovery planning work.
- Inspected the repository status, recent commits, active sessions, and all GitHub issues.
- Found the prior grilling trail in issues #1, #6, #13, and #17. Issue #18 is the remaining research dependency. No other Pi session is active in this repository.
- The existing untracked `docs/ui-redesign-plan.md` was left untouched.
- Commands: `git status`, `git log`, `gh issue list`, `gh pr list`, `intercom list-cwd`.
- Next: read the planning issue and its linked decision threads to reconstruct the exact grilling frontier.

## 2026-09-11 11:42 UTC

- Reconstructed the previous session from its local Pi transcript and the full GitHub issue bodies.
- Confirmed the prior session resolved export capture and archive-format decisions, then stopped after pushing the ZIP64 research branch.
- The recorded next frontier is selective import identity and conflict rules, followed by the user-driven Drive export and import contract. The ZIP64 research ticket also needs independent review.
- Files and commands: prior session JSONL under `~/.pi/agent/sessions`, `gh issue view`, and GitHub issue events.
- Next: claim selective import identity and conflict rules and resume its human decision round.

## 2026-09-11 11:43 UTC

- Claimed selective import identity and conflict rules on GitHub.
- Inspected its dependency links and the current database model. The app has folders, notes, note audio, and note files with cascade relationships, but no tombstones or portable IDs yet.
- Confirmed the archive decision already requires portable UUIDs and allows either restoring an absent original identity or creating a recovered copy with a new identity.
- Commands: `gh issue edit 11 --add-assignee @me`, GraphQL dependency query, and `rg` over `src/database/schema.ts`.
- Next: settle selective import's root identity and conflict semantics with the product owner.

## 2026-09-11 12:04 UTC

- Settled the first selective-import round with the product owner.
- An archived entity whose portable UUID is absent locally regains its original identity. A conflicting changed entity stays untouched and the archived version becomes a recovered copy with a new UUID. Notes are the smallest selectable recovery unit and always carry their archived audio and attachments together. Folder selection acts on its note subtree.
- Next: decide parent placement, comparison rules, and repeated-recovery handling.

## 2026-09-11 12:08 UTC

- Settled the second selective-import round with the product owner.
- A recovered note uses the current matching folder. If the folder is absent, import restores it with its archived UUID and name. Comparison uses canonical user content and excludes timestamps, local paths, integer IDs, and list positions. Recovery provenance prevents duplicate import of an archived version while its prior recovered copy still exists.
- Next: decide copied child identity, recovered-copy presentation, and whole-folder reconciliation.

## 2026-09-11 12:09 UTC

- Settled the third selective-import round with the product owner.
- A conflicting note copy and all copied child entities receive new UUIDs, while SHA-256 blobs may remain deduplicated. Archived titles and content remain unchanged; recovery status and archive date are separate metadata. Whole-folder recovery reconciles each archived note without replacing the folder or touching current-only notes.
- Next: settle folder-name collisions, imported ordering and timestamps, and batch failure semantics.

## 2026-09-11 12:10 UTC

- Settled the final selective-import edge cases with the product owner.
- Folder identity never falls back to name matching. Restored originals retain archived timestamps; recovered copies use the import time and retain source timestamps in provenance. Imported items append after current custom ordering while preserving batch-relative order. Each confirmed selective import is atomic and fails without changing current content.
- The selective-import decision tree has no remaining open branch.
- Next: present the consolidated contract for confirmation before resolving the GitHub ticket.

## 2026-09-11 12:12 UTC

- Product owner confirmed the consolidated selective-import contract.
- Posted the resolution to GitHub, closed selective import identity and conflict rules, and added its decision pointer to the parent map.
- Added `CONTEXT.md` with the canonical recovery terms established by the planning work.
- GitHub: issue #11 resolution comment and issue #1 map update.
- Next: inspect the newly unblocked frontier and continue with the next human decision ticket.

## 2026-09-11 12:13 UTC

- Recomputed GitHub's native dependency frontier after closing selective import identity and conflict rules.
- The next unclaimed decision is user-driven Drive export and import contract. Full import, the interaction prototype, and final guarantees remain blocked behind it or later work. ZIP64 research remains open and assigned pending independent review.
- Command: GitHub GraphQL query for blockers and assignees on issues #10, #12, #13, #17, and #18.
- Next session: claim and grill the user-driven Drive export and import contract.

## 2026-09-11 12:14 UTC

- Started a new Wayfinder session for user-driven Drive export and import contract and claimed the ticket before investigation.
- Reloaded the parent map, canonical recovery glossary, current quick-menu entry points, and the completed Android archive-streaming research.
- Confirmed the app currently has a placeholder "Backup & Restore" action. Android requires separate create-document and open-document picker flows; the document provider controls destination browsing and naming behavior.
- Next: settle the user-visible entry points and picker contract.

## 2026-09-11 12:21 UTC

- The product owner rejected the initial explicit-file-only contract and described a managed backup history instead: Export Backup and Import Backup actions, timestamped archives, newest-backup import, cloud archive browsing, and retention of roughly 20 archives with oldest-first deletion.
- This conflicts with the current map destination and earlier scope boundary. The selected system-file-picker design cannot independently discover a latest cloud file, enumerate a managed history, or enforce retention because Peacock Notes only receives access to documents the user selects.
- The desired retention wording also mixes seven days, fourteen to twenty days, and twenty archives; exact policy depends on first choosing the storage and access model.
- Next: ask whether to preserve the current explicit archive destination or redraw the map around a user-authorized managed backup collection.

## 2026-09-11 12:24 UTC

- Product owner chose a user-selected backup folder through Android's document-provider interface.
- Peacock Notes will retain access to that folder, create and enumerate its timestamped archives there, offer newest-archive import, and prune the oldest Peacock Notes archive after a verified export when the collection exceeds its configured limit. A fresh installation must ask the user to select the folder again.
- This redraws the map destination and brings provider-folder access and managed retention back into scope without adding Drive OAuth scopes or a Peacock Notes cloud backend.
- Next: update the map and ticket graph before continuing the export and import contract.

## 2026-09-11 12:25 UTC

- Redrew the parent map around a user-authorized backup folder and renamed the active decision to "Decide the user-authorized backup folder contract."
- Reopened and sharpened "Decide backup collection retention and pruning," removed its old out-of-scope entry, and made it depend on the active folder-contract decision using GitHub's native blocking relationship.
- Updated the map language to Export Backup, Import Backup, and backup collection. The provider owns remote storage; Peacock Notes manages only recognized archives inside the authorized folder.
- Next: decide whether collection growth is manual or scheduled, then continue the folder contract.

## 2026-09-11 12:29 UTC

- Product owner chose automatic plus manual collection growth.
- When recoverable content changed, Peacock Notes should attempt one automatic backup after 24 hours at the next Android-permitted opportunity and check overdue work when the app opens. Export Backup remains an immediate manual action. The product must not promise exact daily timing.
- This brings the automatic backup lifecycle back into scope; its detailed failure and retry policy remains a separate decision.
- Next: reopen and rewire that lifecycle decision, then continue the backup-folder contract.

## 2026-09-11 12:30 UTC

- Reopened and sharpened "Decide automatic backup lifecycle for the authorized folder," removed its old out-of-scope entry, and updated the parent destination and notes.
- Made the active backup-folder contract block the lifecycle decision, and made the lifecycle decision block collection retention. Existing downstream prototype and reliability tickets again wait for the lifecycle decision.
- Next: settle folder connection, reconnection, and latest-import behavior in the active contract.

## 2026-09-11 12:36 UTC

- Settled backup-folder connection and import entry behavior with the product owner.
- The screen shows the connected folder and allows changing it without moving or deleting the old collection. Import Backup offers the latest valid archive, all backups in the collection, or a file outside the folder. A fresh install or lost permission requires folder selection again.
- Archive filenames will show only a simple local date and time, for example `2026-09-11 18-05-30.peacocknotes`. The archive UUID remains inside the manifest and is not shown in the filename. Manifest creation time, not filename or provider modification time, determines newest order.
- Next: decide manual export behavior, import confirmation, and truthful status messaging.

## 2026-09-11 12:43 UTC

- Settled manual export, import confirmation, and status messaging with the product owner.
- Export Backup always creates and verifies a new archive when invoked manually, while automatic backup may skip unchanged content. Import validates and summarizes an archive before offering full import or selective import where applicable, followed by final confirmation.
- The screen reports the connected folder, collection count, last verified backup, automatic status, and failures. It says "Verified in selected folder" rather than claiming cloud durability, and explains provider delay, reconnection requirements, and the archive's lack of encryption.
- Next: decide collection authority, folder access degradation, and directory layout.

## 2026-09-11 12:46 UTC

- Settled collection authority, degraded access, and directory layout with the product owner.
- Validated archive files and manifests are authoritative; any local SQLite index is a rebuildable cache. Read-only access permits import but pauses export and pruning, while lost read access requires explicit reconnection. Peacock Notes scans only direct child files, ignores unrelated content, and never mutates unknown files.
- The backup-folder contract decision tree has no remaining open branch.
- Next: present the consolidated contract for confirmation before resolving the GitHub ticket.

## 2026-09-11 12:47 UTC

- Product owner confirmed the consolidated user-authorized backup-folder contract.
- Posted the resolution, closed the decision ticket, and appended its context pointer to the parent map.
- Updated `CONTEXT.md` with backup collection and connected backup folder, while keeping export archive as the internal content term.
- GitHub: the resolved backup-folder contract and parent map.
- Next: recompute the frontier after the map redraw.

## 2026-09-11 12:48 UTC

- Recomputed GitHub's native dependency frontier after resolving the backup-folder contract.
- Two unclaimed decisions are now available: automatic backup lifecycle for the authorized folder, and full import validation, replacement, and rollback. Collection retention remains blocked by the lifecycle decision. The ZIP64 research review remains assigned and open.
- The next ticket is automatic backup lifecycle for the authorized folder because the map was just redrawn around automatic collection growth and retention depends on it.
- Next session: claim and grill that lifecycle decision.

## 2026-09-11 12:52 UTC

- Started a new Wayfinder session for automatic backup lifecycle and claimed the ticket before investigation.
- Reloaded the parent map, prior Android scheduling research, folder contract, and canonical recovery terms.
- Corrected stale map text that still said automatic backup was out of scope. Automatic work now means writing to the authorized folder without claiming that its document provider completed remote cloud synchronization.
- Next: settle enablement, due-time, and network policy.
