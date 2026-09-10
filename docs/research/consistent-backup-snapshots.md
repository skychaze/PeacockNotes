# Consistent SQLite and media snapshots

Research for [#5](https://github.com/skychaze/PeacockNotes/issues/5), under the [backup and recovery map](https://github.com/skychaze/PeacockNotes/issues/1).

## Decision

Capture the database through SQLite, not by copying its files. Prefer `VACUUM INTO` for the compact on-disk snapshot, with `SQLite.backupDatabaseAsync` as the supported alternative and as the restore mechanism. Coordinate database and media mutations briefly, pin the immutable media named by the captured database, and publish a manifest only after every component validates. Restore into a new media generation first, then use the SQLite backup API to replace the live database while writes are stopped. Old media remain until the database switch succeeds.

This gives a transactionally consistent database and a logically atomic database-plus-media restore without pretending that SQLite and the file system share a transaction.

## What Expo and SQLite support

The project uses Expo SDK 54 with `expo-sqlite` 16.0.10 and `expo-file-system` 19.0.21. Expo documents both packages for SDK 54. `expo-sqlite` 16.0.10 exposes `openDatabaseAsync`, `closeAsync`, `execAsync`, `serializeAsync`, `isInTransactionAsync`, and `SQLite.backupDatabaseAsync`.[^expo-sqlite-docs] The package source shows that `backupDatabaseAsync` accepts distinct source and destination `SQLiteDatabase` handles and delegates to SQLite's online backup API.[^expo-sqlite-api]

Three database capture mechanisms are relevant:

| Mechanism | Consistent with WAL and live writes | Storage behavior | Decision |
| --- | --- | --- | --- |
| `VACUUM INTO <new-file>` through `execAsync` or a bound statement | Yes. SQLite calls its output a transactionally consistent snapshot of a live database. Committed WAL content is read through SQLite rather than copied as sidecar files.[^vacuum-into][^wal] | The output is fully vacuumed and minimal. Unlike ordinary `VACUUM`, `VACUUM INTO` uses the named output as its temporary database and does not copy it back over the source.[^vacuum-into] | Preferred capture path when a compact disk file matters. The destination must be new or empty. |
| `SQLite.backupDatabaseAsync` from the live handle to a separately opened disk database | Yes. The online backup API writes a consistent destination from the logical source and keeps a write transaction on the destination.[^backup-api] | Uses an on-disk destination, so it does not require a database-sized JavaScript buffer. It preserves free pages and can be larger than `VACUUM INTO`.[^vacuum-into] | Supported alternative for capture and preferred restore path. |
| `db.serializeAsync()` | SQLite can serialize the logical database, but Expo returns the whole result as a `Uint8Array`.[^expo-sqlite-api][^sqlite-serialize] | Requires a database-sized native allocation and JavaScript-visible byte array. | Do not use for normal device backup or restore under memory pressure. It can be useful only for deliberately small databases. |

Expo's Android implementation of `backupDatabaseAsync` calls `sqlite3_backup_step(..., -1)`, so it copies all pages in one native call rather than exposing SQLite's incremental page loop.[^expo-sqlite-android] That has two consequences:

1. The source read lock lasts for that call. WAL still permits other connections to append writes while a reader is active, but Peacock Notes gains nothing by racing its own writes during the short capture barrier.[^backup-api][^wal]
2. Expo's wrapper does not expose page-by-page progress, cancellation, or retry. It also does not inspect the `sqlite3_backup_step` return directly. SQLite documents that `SQLITE_BUSY` and `SQLITE_LOCKED` from a step do not make `sqlite3_backup_finish` fail, while an unfinished destination transaction is rolled back.[^expo-sqlite-android][^backup-api] Prevent source and destination lock contention, then validate the expected application schema and data after every backup call instead of treating promise resolution alone as proof of a complete copy.

`VACUUM INTO` has its own interruption rule. If power or the process stops before it finishes, the output can be incomplete or corrupt. A completed command syncs the output when the source connection uses `synchronous=NORMAL` or `FULL`.[^vacuum-into] Therefore both capture paths need a unique staging filename, post-capture validation, and publication only after success.

## Why raw database file copies are rejected

Peacock Notes enables WAL when it opens `peacocknotes.db`.[^repo-database] In WAL mode, committed transactions can exist only in `peacocknotes.db-wal`. SQLite says the WAL file is part of the database's persistent state and that separating it from the main database can lose committed transactions or corrupt the database.[^wal] SQLite also lists the backup API and `VACUUM INTO` as safe ways to copy a live database. A direct file copy is safe only when no transaction is active, and a hot journal or WAL must accompany the database after a failed transaction.[^sqlite-corruption]

Do not use any of these shortcuts:

- Copy only `peacocknotes.db`, even after a passive checkpoint. A writer can commit between checkpoint and copy.
- Copy the `.db`, `-wal`, and `-shm` files one at a time while the database is live. File-system copies cannot capture those changing files at one instant.
- Rename, unlink, or overwrite the live database while an Expo SQLite handle remains open. SQLite calls renaming or unlinking an open database undefined and likely to cause corruption.[^sqlite-corruption]
- Treat `PRAGMA wal_checkpoint` as a backup mechanism. A checkpoint transfers WAL pages into the main file. It does not create a snapshot or coordinate later writes.[^wal]

A fully quiesced close, completed checkpoint, and raw copy could be made safe, but it has more lifecycle and sidecar failure modes than using the public backup mechanisms. There is no reason to choose it here.

## The database and media consistency boundary

The database stores media as absolute URIs in `NoteAudios.uri` and `NoteFiles.uri`. The storage reporting code reads those two sets independently.[^repo-media-rows] Managed media live under `documentDirectory/audio` and `documentDirectory/files`.[^repo-media-roots] Current import flows copy a file first and write its URI into SQLite later, while note update and deletion remove database references before deleting old media.[^repo-import][^repo-delete]

Those orderings are sensible for normal app use, but SQLite cannot include file-system operations in its transaction. A database snapshot could otherwise name a file that a concurrent delete removes a moment later. The safe boundary is an application-level snapshot and mutation coordinator used by every operation that can:

- add or remove a media reference in SQLite;
- create, replace, rename, or delete managed media;
- begin capture or perform the final restore switch.

Managed media must become immutable once SQLite references it. Replacement creates a new file and changes the reference in a database transaction. Deletion checks active snapshot pins and defers physical removal while a capture still needs the old file.

### Capture sequence

1. Create a unique durable operation directory under `Paths.document`. Expo defines this as storage the system does not delete under low-space pressure. Do not put the only candidate in `Paths.cache`, which Expo says the system may delete.[^expo-filesystem]
2. Enter the mutation coordinator and wait for active media copies, recording finalization, and SQLite writes to finish. Do not start `VACUUM INTO` or the backup API while the source handle is in a transaction.
3. Capture to a unique destination database through `VACUUM INTO`, or open a separate destination with `openDatabaseAsync` and call `backupDatabaseAsync`.
4. Open the captured database and read its `NoteAudios.uri` and `NoteFiles.uri` rows. While still holding the coordinator, register pins for exactly those source files. Then release the coordinator. New content is outside this snapshot, and deletes can update the live database but cannot remove pinned bytes.
5. Validate the database and expected Peacock Notes schema. Require `PRAGMA integrity_check` to return exactly `ok`, require `PRAGMA foreign_key_check` to return no rows, check the supported schema or `user_version`, and verify that every referenced media item exists. SQLite notes that `integrity_check` does not detect foreign-key errors, so both checks are needed.[^integrity-check]
6. Copy or upload each pinned media file and record its logical key, byte size, and digest in a versioned manifest. Re-read metadata or the digest after transfer. Treat a missing or changed immutable source as capture failure.
7. Publish the manifest or completion record last. Until that point, all database and media objects belong to an incomplete operation and may be retried or garbage-collected. Release pins only after success or cleanup.

Holding the coordinator for the entire media copy is also correct, but it can freeze edits for the duration of the largest snapshot. Pinning immutable files keeps the exclusive section limited to database capture, reference enumeration, and pin registration.

## File-system mechanisms and interruption

SDK 54's current `File`, `Directory`, and `Paths` API supports durable document and disposable cache locations, file and directory creation, listing, copy, move, delete, byte size, MD5, and `Paths.availableDiskSpace`. `FileHandle` supports bounded `readBytes` and `writeBytes` calls for chunked local I/O.[^expo-filesystem][^expo-filesystem-types] The repository's existing `expo-file-system/legacy` imports are also supported when imported from that explicit path, but new backup code should use the current API.[^expo-filesystem]

Use those operations with these limits:

- Write or download to a unique `.partial` or operation directory. Never overwrite a live database or referenced media file.
- On Android, Expo warns that a failed `File.downloadFileAsync` can leave a partly written destination. Validation must precede use.[^expo-filesystem-types]
- `File.move` is useful for naming a validated candidate, but Expo's public contract does not promise an atomic, crash-durable rename and exposes no `fsync` operation.[^expo-filesystem-types] Correctness must come from unreachable staging, validation, and a commit record, not from assuming that move is a transaction.
- Whole-file `bytes()` and base64 APIs allocate the whole file. Prefer a `File` as a `Blob` for a streaming-capable consumer or use `FileHandle` chunks when a local copy is required.[^expo-filesystem-types]
- A stale or malformed operation record never makes a candidate current. At startup, inspect incomplete operation directories, validate before resuming, and otherwise delete them idempotently.

The MD5 property is enough to detect accidental partial copies, but the manifest's security and digest algorithm remains a separate cloud-format decision. Size alone is not sufficient.

## Restore without a database-plus-files transaction

A raw file swap cannot atomically replace SQLite plus many media files. A generation layout makes the SQLite commit the only visibility switch:

1. Read only a snapshot whose final manifest is present. Check its format version and application/schema compatibility before allocating the full restore.
2. Use `Paths.availableDiskSpace` for admission. Download the candidate database and media into a new durable generation such as `document/media-generations/<restore-id>/`. Download each object to a unique partial path, validate it against the manifest, then place it at its final generation path. Interruption leaves only unreferenced files.
3. Never restore backed-up absolute sandbox URIs verbatim. Map manifest media keys to paths in the current installation and rewrite the candidate database to those new generation paths. Longer term, the database should store logical relative media keys instead of absolute `file://` URIs.
4. Open the candidate database with Expo SQLite. Run full `integrity_check`, `foreign_key_check`, schema compatibility checks, expected row/count checks, and a query that proves every database media reference resolves to one validated generation file. Compare source and live `PRAGMA page_size` values too. SQLite can reject online backup with `SQLITE_READONLY` when the destination is in WAL mode and the page sizes differ.[^backup-api]
5. Enter maintenance mode through the same mutation coordinator. Stop UI reads and writes, finish or cancel active recordings, and ensure the live destination connection has no active transaction or statement. Create and upload the required pre-restore safety snapshot before changing live data.
6. Keep the candidate as the source and the already open live database as the destination of `SQLite.backupDatabaseAsync`. SQLite holds a write transaction on the destination for the operation. If backup does not finish, `sqlite3_backup_finish` rolls that destination transaction back.[^backup-api] This avoids renaming or overwriting an open database and incorporates WAL state through SQLite. If page sizes differ, switch the quiesced live destination to `journal_mode=DELETE` through SQLite before backup, then restore WAL mode after backup and validation. The backup API restriction applies to WAL destinations, and Peacock Notes already reapplies WAL at initialization.[^backup-api][^repo-database]
7. Before leaving maintenance mode, verify the live schema, counts, `integrity_check`, `foreign_key_check`, and all media references. If a postcondition fails, restore the pre-restore database through the same API while the coordinator is still held.
8. Mark the restore committed. Keep the previous media generation until the switch and validation succeed, then garbage-collect unreferenced old and incomplete generations later.

Before the database commit, the old database points only to old media. After it, the restored database points only to an already complete generation. A crash can therefore leave old content, restored content, or harmless unreferenced files, but it does not need to leave live rows pointing to half-downloaded media.

## Temporary-space bound

Capture needs one on-disk database snapshot plus small operation metadata if media can be consumed directly from pinned immutable source files. `VACUUM INTO` minimizes that database snapshot. Locally packaging a self-contained archive would additionally require space near the total media size and is a poor fit for constrained devices.

Safe full restore has an unavoidable coexistence cost. Until the SQLite switch commits, the app must retain the old live media and the complete candidate media generation. It also needs the downloaded candidate database and, briefly, the database file for the pre-restore safety snapshot. Use an overflow margin rather than comparing exact byte totals because SQLite journals, WAL, manifests, and downloads add overhead. If `Paths.availableDiskSpace` is below that bound, fail before deleting or replacing anything. The user may free space or choose selective recovery; unsafe in-place overwrite is not a fallback.

Content-addressed immutable media could reduce this peak by reusing already present, hash-matching blobs. Expo does not expose hard-link or reflink creation, so ordinary path-based generations still require copies for content that cannot be safely shared.[^expo-filesystem-types]

## Newly surfaced decisions for the map

1. Adopt one process-wide mutation coordinator for SQLite media-reference changes, managed-file lifecycle, snapshot capture, and final restore.
2. Make referenced media immutable and add snapshot pins or deferred deletion. Without this, database and media capture cannot be consistent without blocking all edits for the full media copy.
3. Use durable, unique media generations for restore and switch visibility by committing database references. Garbage-collect old generations only after post-restore validation.
4. Make snapshot media identities portable. Store logical relative keys in the snapshot manifest and rewrite current absolute URIs during restore. Prefer migrating the live schema away from absolute sandbox paths.
5. Define a versioned manifest and operation state machine in which the completion record is written last. Resume only after validation; otherwise discard stale staging.
6. Require integrity, foreign-key, schema, expected-data, file-existence, size, and digest checks. Promise resolution from Expo's backup wrapper is not enough by itself.
7. Reject full restore before mutation when disk cannot hold old live media plus the candidate generation and database overhead. Decide the safety margin and whether hash-matching live blobs may be reused.
8. Decide the manifest digest algorithm. Expo FileSystem exposes MD5 for transfer-error detection, but a stronger digest may require another first-party Expo module.
9. Record database page size in the manifest. Restore normally into WAL when sizes match; use a controlled SQLite journal-mode fallback during quiesced restore when they do not.

## Sources

[^expo-sqlite-docs]: Expo, [SQLite, SDK 54](https://docs.expo.dev/versions/v54.0.0/sdk/sqlite/), including `SQLite.backupDatabaseAsync`, `SQLiteDatabase.serializeAsync`, transactions, and database open/close APIs.
[^expo-sqlite-api]: Expo `expo-sqlite` 16.0.10 source, [`SQLiteDatabase.ts`](https://github.com/expo/expo/blob/172a69f5f70c1d0e043e1532f924de97210cabc3/packages/expo-sqlite/src/SQLiteDatabase.ts#L44-L60) and [`backupDatabaseAsync`](https://github.com/expo/expo/blob/172a69f5f70c1d0e043e1532f924de97210cabc3/packages/expo-sqlite/src/SQLiteDatabase.ts#L636-L665).
[^expo-sqlite-android]: Expo `expo-sqlite` 16.0.10 Android source, [`NativeDatabaseBinding::sqlite3_backup`](https://github.com/expo/expo/blob/172a69f5f70c1d0e043e1532f924de97210cabc3/packages/expo-sqlite/android/src/main/cpp/NativeDatabaseBinding.cpp#L167-L190).
[^backup-api]: SQLite, [Online Backup API](https://www.sqlite.org/c3ref/backup_finish.html) and [Using the SQLite Online Backup API](https://www.sqlite.org/backup.html).
[^vacuum-into]: SQLite, [`VACUUM INTO`](https://www.sqlite.org/lang_vacuum.html#vacuum_with_an_into_clause).
[^sqlite-serialize]: SQLite, [`sqlite3_serialize`](https://www.sqlite.org/c3ref/serialize.html).
[^wal]: SQLite, [Write-Ahead Logging](https://www.sqlite.org/wal.html), especially sections 2, 3.2, and 4.
[^sqlite-corruption]: SQLite, [How to corrupt an SQLite database file](https://www.sqlite.org/howtocorrupt.html#_backup_or_restore_while_a_transaction_is_active), sections 1.2, 1.3, 1.4, and 2.5.
[^integrity-check]: SQLite, [`PRAGMA integrity_check`, `quick_check`, and `foreign_key_check`](https://www.sqlite.org/pragma.html#pragma_integrity_check).
[^expo-filesystem]: Expo, [FileSystem, SDK 54](https://docs.expo.dev/versions/v54.0.0/sdk/filesystem/).
[^expo-filesystem-types]: Expo `expo-file-system` 19.0.21 source, [`File`, `Directory`, download, metadata, and FileHandle contracts](https://github.com/expo/expo/blob/599ebc94db5c972f961641db9aa33e2964498c42/packages/expo-file-system/src/ExpoFileSystem.types.ts#L1-L389) and [`Paths`](https://github.com/expo/expo/blob/599ebc94db5c972f961641db9aa33e2964498c42/packages/expo-file-system/src/FileSystem.ts#L6-L52).
[^repo-database]: Peacock Notes at the researched revision, [`openDatabaseAsync` and WAL initialization](https://github.com/skychaze/PeacockNotes/blob/adc66c6/src/database/schema.ts#L29-L43).
[^repo-media-rows]: Peacock Notes at the researched revision, [media URI queries](https://github.com/skychaze/PeacockNotes/blob/adc66c6/src/database/schema.ts#L745-L779).
[^repo-media-roots]: Peacock Notes at the researched revision, [managed `audio` and `files` roots](https://github.com/skychaze/PeacockNotes/blob/adc66c6/src/utils/mediaFiles.ts#L1-L30).
[^repo-import]: Peacock Notes at the researched revision, [copy-before-reference editor import](https://github.com/skychaze/PeacockNotes/blob/adc66c6/src/screens/NoteEditorScreen.tsx#L564-L660) and [share import](https://github.com/skychaze/PeacockNotes/blob/adc66c6/src/screens/ShareImportScreen.tsx#L204-L293).
[^repo-delete]: Peacock Notes at the researched revision, [database update followed by media deletion](https://github.com/skychaze/PeacockNotes/blob/adc66c6/src/database/schema.ts#L648-L683).
