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

## 2026-09-11 12:59 UTC

- Settled automatic enablement, due-time, and network policy with the product owner.
- Automatic backup requires explicit confirmation after writable-folder connection and immediately creates the first verified archive. Folder selection for import does not enable automation. A verified manual or automatic backup resets the 24-hour clock only when recoverable content changed.
- Automatic work defaults to Wi-Fi only with an opt-in for mobile data. Manual export uses the current connection. A Wi-Fi-blocked attempt remains due and reports that it is waiting.
- Next: decide retry behavior, long-running attempts, and operation concurrency.

## 2026-09-11 13:01 UTC

- Settled retry, long-running execution, and concurrency with the product owner.
- Waiting conditions do not consume retries. Transient failures receive up to three exponential-backoff retries; permission, storage, and configuration failures require user action. Unsuccessful work remains due and never triggers pruning.
- Large or slow backups use foreground-capable native WorkManager with a cancellable progress notification. One durable operation lease serializes automatic export, manual export, import, folder changes, and automation changes.
- Next: decide battery gating, app-open execution, and user notification thresholds.

## 2026-09-11 13:04 UTC

- Settled battery gating, app-open behavior, and notification policy with the product owner.
- Automatic backup waits for a non-low battery but does not require charging. A due check on app open starts non-blocking work without another confirmation. Manual export ignores automatic battery gating.
- Ordinary transient errors remain in the feature screen. Peacock Notes sends one non-repeating notification for action-required failures or when no verified backup succeeds within 48 hours after becoming due, then clears it after success.
- Next: decide disablement, retry idempotency, and lifecycle reconciliation after reboot or force-stop.

## 2026-09-11 13:05 UTC

- Settled disablement, retry idempotency, and lifecycle persistence with the product owner.
- Disabling automation removes future work but preserves folder access, collection state, archives, and manual export. One durable operation UUID lets retries detect an already-published valid archive and prevents duplicate publication after uncertain provider results.
- Durable state covers enablement, folder permission, verified time and revision, due revision, active operation, retries, and failure. Launch and upgrade reconcile one worker; app open catches up after force-stop. Empty content waits without creating an automatic archive.
- The automatic-backup lifecycle decision tree has no remaining open branch.
- Next: present the consolidated contract for confirmation before resolving the GitHub ticket.

## 2026-09-11 13:07 UTC

- Product owner confirmed the consolidated automatic-backup lifecycle.
- Posted the resolution, closed the lifecycle decision, and appended its context pointer to the parent map.
- Updated `CONTEXT.md` with automatic backup and due backup, explicitly separating them from exact scheduling and cloud synchronization claims.
- Next: recompute the frontier, including the now-unblocked collection-retention decision.

## 2026-09-11 13:07 UTC

- Recomputed the native dependency frontier after resolving automatic backup lifecycle.
- Backup collection retention and pruning is now unblocked alongside full import validation. The prototype and final guarantees remain blocked. ZIP64 research review remains assigned and open.
- The next ticket is backup collection retention and pruning because it directly follows the lifecycle decision and owns the requested roughly 20-archive history.
- Next session: claim and grill the retention decision.

## 2026-09-11 13:09 UTC

- Started a new Wayfinder session for backup collection retention and pruning and claimed the ticket before investigation.
- Reloaded the parent map, automatic lifecycle decision, connected-folder contract, and canonical terms.
- The requested "about 20" archive limit does not itself guarantee seven days of history because manual exports may create many archives in one day. Count limit and time coverage must be decided together.
- Next: settle the count and time policy, treatment of manual archives, and safe pruning trigger.

## 2026-09-11 13:13 UTC

- Product owner replaced the roughly 20-archive limit with time-only retention.
- The collection keeps every verified manual and automatic backup from the last seven days, regardless of count. Manual and automatic archives follow the same rules. Users may move or copy an archive outside the connected folder to exempt it from management.
- Pruning still begins only after a new archive verifies and a trustworthy scan completes. Cleanup failure keeps the new backup successful and leaves extra archives in place.
- The interaction between seven-day expiry and long periods without content changes remains unresolved because automatic backup skips unchanged content.
- Next: settle the exact seven-day boundary and protection of the newest recovery point.

## 2026-09-11 13:17 UTC

- Settled the retention boundary, sole-recovery-point protection, and reconciliation triggers with the product owner.
- Seven days means a rolling 168-hour window from each manifest's UTC creation time. The newest valid archive never expires until a newer archive verifies successfully.
- Reconciliation runs after a verified export, on app open, after folder reconnection, and on user refresh. There is no cleanup-only worker. Every prune requires a complete successful scan.
- Posted these decisions to GitHub issue #9.
- Next: decide the validation threshold for pruning, anomalous timestamps, and partial deletion behavior.

## 2026-09-11 13:22 UTC

- Settled the pruning verification threshold, clock-anomaly behavior, partial deletion semantics, consent, and storage-pressure policy with the product owner.
- Cleanup requires a complete direct-child and manifest scan plus a current or safely cached verification of the protected newest archive. It never automatically deletes malformed, corrupt, or unreadable archives.
- Future-dated recognized archives pause pruning. Eligible archives delete oldest first with a pre-delete identity recheck; cleanup stops and reports any partial failure without changing backup success.
- Managed retention requires one-time explicit acceptance and never deletes a younger archive merely to free storage.
- Posted these decisions to GitHub issue #9.
- Next: settle archive ownership recognition, timestamp ties, shared-folder authority, and retention opt-out behavior.

## 2026-09-11 13:27 UTC

- Settled archive recognition, newest-time ties, shared-folder authority, and retention opt-out behavior with the product owner.
- Automatic management requires the expected extension and a readable, supported Peacock Notes manifest. Unreadable candidates and unsupported newer formats remain untouched and pause pruning.
- Every archive tied at the newest manifest timestamp is protected, and latest import requires a choice when that timestamp is tied.
- The connected folder is one collection across installations. Retention is inseparable from its writable managed-folder contract; disconnecting stops management without altering files.
- Posted these decisions to GitHub issue #9.
- Next: settle full verification of deletion candidates and user recovery from pruning blockers.

## 2026-09-11 13:31 UTC

- Settled pre-deletion integrity verification, blocker recovery, and cleanup reporting with the product owner.
- Peacock Notes verifies all protected newest archives and expired deletion candidates before deleting anything. Any required read or integrity failure cancels that deletion phase.
- The Backup screen names blocking files and reasons. Users resolve uncertain files through the document provider, while unsupported formats direct them to update the app. There is no in-app force-delete path.
- Successful cleanup remains quiet but records its time and removal count. Existing action-required notifications apply only when pruning prevents a new backup.
- Posted these decisions to GitHub issue #9. The retention decision tree now has no open branch.
- Next: present the consolidated retention contract for product-owner confirmation before resolving the ticket.

## 2026-09-11 13:34 UTC

- Product owner confirmed the consolidated backup-retention contract without revisions.
- Attempted to close issue #9 with `gh issue close --comment-file`, but this installed GitHub CLI version does not support that flag. The issue remains open and no remote state changed.
- Next: post the prepared resolution with `gh issue comment`, then close the issue using supported flags.

## 2026-09-11 13:37 UTC

- Posted the confirmed retention resolution with a supported GitHub CLI command and closed issue #9 as completed.
- Added managed retention to `CONTEXT.md` and linked the resolved decision from parent map issue #1.
- GitHub: issue #9 resolution and issue #1 decision map.
- Next: commit and push the glossary and process updates, then recompute the unblocked planning frontier.

## 2026-09-11 13:39 UTC

- Recomputed the open planning frontier after closing backup retention.
- Full import validation, replacement, and rollback is the remaining unclaimed human decision available before the interaction prototype and final guarantees. ZIP64 research remains open and assigned for independent review.
- The unrelated untracked `docs/ui-redesign-plan.md` remains untouched.
- Commands: `git status`, `gh issue list`, and `gh issue view` for issues #10, #12, and #13.
- Next: claim issue #10 and inspect the established import and snapshot decisions before starting its grilling round.

## 2026-09-11 13:43 UTC

- Claimed full import validation, replacement, and rollback in GitHub issue #10.
- Reloaded the resolved snapshot, archive-format, selective-import, capture-and-staging, and backup-folder contracts, then inspected the current SQLite and media code.
- The inherited full-import base is strict archive and database validation, migration only in staging, a mandatory pre-import safety snapshot, candidate media in a new generation, one exclusive commit barrier, SQLite backup-API replacement, verified rollback on commit failure, and deferred old-generation cleanup.
- The remaining human decisions begin with what full import replaces, how confirmation communicates loss, and when a safety snapshot may expire.
- Commands: `gh issue view` for issues #5, #6, #11, #15, and #17; `rg` over database and media code; `package.json` inspection.
- Next: begin the full-import grilling round.

## 2026-09-11 13:49 UTC

- Product owner rejected destructive full replacement. Existing content must never be wiped during archive import.
- Reframed the archive-wide action as Import everything. It applies selective-import rules to every archived note: restore missing identities, skip identical notes, preserve current-only notes, and create recovered copies for changed identity conflicts.
- Renamed and rewrote issue #10 around import-everything validation and atomic recovery, posted the direction change, updated the parent map, and replaced Full import with Import everything in `CONTEXT.md`.
- The destructive database-switch branch from the earlier capture decision is superseded for the product. The batch still requires full staging, validation, and atomic commit.
- Next: settle archive-wide folder reconciliation, batch review, and atomic failure behavior under the non-destructive model.

## 2026-09-11 13:55 UTC

- Product owner restored two archive-wide import modes: additive import and full replacement import. The import flow must present both choices.
- Accepted the prior recommendations for additive import: a complete pre-commit classification, restoration of missing empty folders, normal backup-clock treatment for actual additions, and cancellation only before commit.
- Renamed and rewrote issue #10 around both modes, restored the replacement branch in parent map issue #1, and defined both terms in `CONTEXT.md`.
- Full replacement again inherits the staged media generation, safety snapshot, exclusive database switch, and verified rollback protocol from issue #15.
- Next: settle user-facing mode names, exact replacement scope, safety-snapshot lifetime, and backup-clock behavior for full replacement.

## 2026-09-11 14:02 UTC

- Settled import-mode naming, replacement scope, undo lifetime, post-replacement backup behavior, and empty-install behavior with the product owner.
- Existing installations see Add without replacing first and Import all and replace second. Replacement changes only recoverable content and preserves device-local configuration.
- One verified local safety snapshot supports Undo last replacement for seven days. Empty installations use one Import all notes action and need no undo snapshot.
- Replacement from any archive other than the protected newest collection archive triggers immediate automatic backup when enabled, or offers Export Backup now when disabled.
- Posted these decisions to GitHub issue #10.
- Next: settle destructive confirmation, undo semantics, open-editor handling, and replacement failure recovery.

## 2026-09-11 14:07 UTC

- Settled replacement confirmation, pending-edit handling, one-way undo, safety-snapshot expiry, and double-failure recovery with the product owner.
- Full replacement requires an explicit loss summary and Replace all current notes action. It saves pending edits first, stops media activity for commit, clears stale editor state, and returns to the folder list.
- One verified local snapshot remains for 168 hours unless explicitly discarded. Undo is one-way and uses a temporary rollback copy only for technical failure.
- A replacement plus rollback failure enters restricted recovery instead of reopening uncertain data or initializing an empty database.
- Posted these decisions to GitHub issue #10.
- Next: settle damaged-current-data recovery, per-mode disk admission, empty-backup replacement, and no-op behavior.

## 2026-09-11 14:13 UTC

- Settled damaged-current-data replacement, per-mode disk admission, empty-backup handling, exact-match no-op behavior, and explicit mode selection with the product owner.
- A fully verified candidate may replace damaged current data without undo only through restricted recovery and explicit confirmation, while preserving a best-effort forensic copy.
- Disk checks are mode-specific and never free space by deleting protected content. Empty replacement receives a zero-note warning and safety snapshot; exact matches perform no commit.
- Neither mode is preselected.
- Posted these decisions to GitHub issue #10.
- Next: settle missing-media repair, coexistence with selective import, undo after later edits, and forensic-copy lifetime.

## 2026-09-11 14:18 UTC

- Settled matching-media repair, the three existing-install import choices, undo after later edits, forensic-copy lifetime, and additive import against damaged current data.
- Matching missing or corrupt media is repaired atomically from verified archived bytes. Logical or digest conflicts still produce recovered copies.
- Existing installations offer selective, additive-all, and full replacement choices. Undo warns about post-replacement changes and offers export first.
- Damaged-data forensic copies remain for 168 hours after success and indefinitely while recovery remains incomplete. Failed current integrity disables additive and selective commit but leaves verified full replacement available in restricted recovery.
- Posted these decisions to GitHub issue #10. The additive and full replacement import decision tree now has no open branch.
- Next: present the consolidated import contract for product-owner confirmation before resolving the ticket.

## 2026-09-11 14:22 UTC

- Product owner confirmed the consolidated selective, additive, and full replacement import contract without revisions.
- Posted the resolution and closed GitHub issue #10 as completed.
- Added the resolved import decision to parent map issue #1. `CONTEXT.md` already contains the accepted additive-import and full-replacement-import terms.
- Next: commit and push this checkpoint, then recompute the remaining planning frontier.

## 2026-09-11 14:24 UTC

- Recomputed GitHub's native dependency graph after resolving import behavior.
- The export and import interaction prototype in issue #12 is now fully unblocked. It blocks final guarantees in issue #13, which also remains blocked by the assigned ZIP64 review in issue #18.
- Command: GitHub GraphQL query over open issues and their `blockedBy` and `blocking` relationships.
- Next: claim issue #12 and follow the prototype workflow using the confirmed product contracts.

## 2026-09-11 14:27 UTC

- Claimed interaction prototype issue #12 and selected the UI-prototype branch because the unresolved question is information hierarchy and interaction flow, not backend state logic.
- Inspected the current Backup & Restore placeholder, theme tokens, spacing, and available scripts. No production backup screen exists, so the prototype will be a standalone mobile-width HTML surface on a throwaway branch.
- Planned three structurally different variants: action-first guidance, history-first collection browsing, and status-first timeline. Each will use simulated state and a URL-persisted variant switcher.
- The untracked `docs/ui-redesign-plan.md` remains outside this work.
- Next: create and push the throwaway prototype branch, then build the three variants.

## 2026-09-11 15:03 UTC

- Completed the interaction prototype on the throwaway `prototype/export-import-flow` branch and presented all three variants in an isolated Helium window.
- Product owner selected variant A, Action first. The prototype branch remains the primary source and will not merge into production.
- Posted the selected hierarchy to issue #12, closed the ticket, and added its decision pointer to parent map issue #1.
- Stopped the local prototype server, restored Chrome DevTools MCP to its original Helium attach configuration, and returned to main. The unrelated untracked `docs/` directory remains untouched.
- Next: commit and push the selected prototype decision, then recompute the final-guarantees frontier and ZIP64 review status.
