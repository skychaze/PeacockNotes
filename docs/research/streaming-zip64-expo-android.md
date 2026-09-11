# Streaming ZIP64 on Expo Android

## Decision

Build a small Android-only Expo module and use [Zip4j 2.11.6](https://repo1.maven.org/maven2/net/lingala/zip4j/zip4j/maven-metadata.xml) directly. Do not use an archive implementation in JavaScript and do not use a React Native archive wrapper as the backup format implementation.

This is the smallest composition that meets the requirement:

- an Expo module retains access to the user-selected `ACTION_OPEN_DOCUMENT_TREE` folder, creates child documents there, and does all archive, digest, and extraction I/O on a native worker;
- Zip4j supplies `ZipOutputStream(OutputStream)` for export and `ZipFile(File)` plus `getInputStream(FileHeader)` for validated import; and
- Android supplies `ContentResolver`, `MessageDigest`, `DigestInputStream` or `DigestOutputStream`, `StatFs`, and `CancellationSignal`.

Expo's module API supports Kotlin native modules and the New Architecture, so this is compatible with this SDK 54 app, but it requires a development or release build, not Expo Go. [Expo Modules API](https://docs.expo.dev/modules/overview/)

Use `net.lingala.zip4j:zip4j:2.11.6`, pinned in the module Gradle file. Zip4j's own Maven metadata names 2.11.6 as its latest release, and its POM targets Java 8. [Maven metadata](https://repo1.maven.org/maven2/net/lingala/zip4j/zip4j/maven-metadata.xml) [POM](https://repo1.maven.org/maven2/net/lingala/zip4j/zip4j/2.11.6/zip4j-2.11.6.pom) Its stream classes take `InputStream` and `OutputStream`, and its header writer emits ZIP64 records when a size or entry count crosses the ZIP32 limits. A streamed entry larger than 4 GiB must set `ZipParameters.entrySize` before `putNextEntry`, as Zip4j's ZIP64 integration test does. [Zip output stream](https://github.com/srikanth-lingala/zip4j/blob/v2.11.6/src/main/java/net/lingala/zip4j/io/outputstream/ZipOutputStream.java) [ZIP64 integration test](https://github.com/srikanth-lingala/zip4j/blob/v2.11.6/src/test/java/net/lingala/zip4j/ZipFileZip64IT.java)

No inspected maintained Expo or React Native archive candidate provides the complete contract: ZIP64 streaming, SHA-256, hostile-archive policy, persisted SAF collection access, and post-write document readback. The module owns those policy and SAF parts. Zip4j only owns ZIP parsing and encoding.

## What the installed Expo packages do

The repository pins Expo SDK 54, `expo-file-system` 19.0.21, and `expo-document-picker` 14.0.8 in [`package.json`](../../package.json). I inspected the exact published package tarballs, whose source commits are [`599ebc9` for FileSystem](https://github.com/expo/expo/tree/599ebc94db5c972f961641db9aa33e2964498c42/packages/expo-file-system) and [`172a69f5` for DocumentPicker](https://github.com/expo/expo/tree/172a69f5f70c1d0e043e1532f924de97210cabc3/packages/expo-document-picker).

### `expo-file-system` 19.0.21

The modern `File` API has `readableStream()`, `writableStream()`, `FileHandle.readBytes()`, and `FileHandle.writeBytes()`. Those are useful for bounded JavaScript chunks, but they do not give a native ZIP or SHA-256 pipeline. The whole-file convenience methods are explicitly whole-file APIs: `bytes()` returns all bytes, `base64()` returns all base64, and the provided digest property is MD5. [Type declarations](https://github.com/expo/expo/blob/599ebc94db5c972f961641db9aa33e2964498c42/packages/expo-file-system/src/ExpoFileSystem.types.ts) [Android implementation](https://github.com/expo/expo/blob/599ebc94db5c972f961641db9aa33e2964498c42/packages/expo-file-system/android/src/main/java/expo/modules/filesystem/FileSystemFile.kt)

More importantly, `FileHandle` is backed by `RandomAccessFile`, while SAF documents are handled through `ContentResolver` streams. That makes the File API a poor boundary for a Drive-backed, potentially non-seekable `content://` document. The FileSystem Android source can open a SAF document for a whole supplied write or read, but it cannot create an arbitrary `File` at a SAF URI, and its MD5 implementation calls `readBytes()`. [File handle implementation](https://github.com/expo/expo/blob/599ebc94db5c972f961641db9aa33e2964498c42/packages/expo-file-system/android/src/main/java/expo/modules/filesystem/FileSystemFileHandle.kt) [SAF implementation](https://github.com/expo/expo/blob/599ebc94db5c972f961641db9aa33e2964498c42/packages/expo-file-system/android/src/main/java/expo/modules/filesystem/unifiedfile/SAFDocumentFile.kt)

The legacy `StorageAccessFramework` namespace can select a tree, persist the offered permission, enumerate children, and create a document in that tree. Those capabilities match the collection model, but its JS-facing read and write calls still do not provide the required native archive pipeline. [Legacy SAF API](https://github.com/expo/expo/blob/599ebc94db5c972f961641db9aa33e2964498c42/packages/expo-file-system/src/legacy/FileSystem.ts)

### `expo-document-picker` 14.0.8

`getDocumentAsync` is import-only. Android implementation launches `Intent.ACTION_OPEN_DOCUMENT`; it does not launch `ACTION_CREATE_DOCUMENT`. Its default `copyToCacheDirectory: true` copies the selected document into app cache, which duplicates a large backup before import. Set it to `false` and immediately hand its returned URI to the native module. [SDK 54 docs](https://docs.expo.dev/versions/v54.0.0/sdk/document-picker/) [Android source](https://github.com/expo/expo/blob/172a69f5f70c1d0e043e1532f924de97210cabc3/packages/expo-document-picker/android/src/main/java/expo/modules/documentpicker/DocumentPickerModule.kt)

The picker source does not call `takePersistableUriPermission`. The module should process an import during the granted activity result, or explicitly take the offered read permission if a deferred import is a product requirement. Android documents the persistable-permission call and the read/write flags. [SAF guide](https://developer.android.com/training/data-storage/shared/documents-files)

For the managed collection, Peacock Notes launches `ACTION_OPEN_DOCUMENT_TREE` once, takes the offered persistent read and write permission, and retains the tree URI. Each manual or automatic export then creates a direct child with `DocumentsContract.createDocument(contentResolver, treeDocumentUri, "application/zip", filename)`. A per-export `ACTION_CREATE_DOCUMENT` save-as flow cannot enumerate or maintain the accepted collection. [SAF guide](https://developer.android.com/training/data-storage/shared/documents-files) [DocumentsContract.createDocument](https://developer.android.com/reference/android/provider/DocumentsContract#createDocument(android.content.ContentResolver,android.net.Uri,java.lang.String,java.lang.String))

## Routes considered

| Route | What it has | Why it is not the implementation |
| --- | --- | --- |
| `react-native-zip-archive` 9.5.1 | Actively published React Native and Expo package. Its Android build depends on Zip4j 2.11.5, and it has cancellation, traversal checks, and disabled symlink extraction in its current Android source. [package metadata](https://registry.npmjs.org/react-native-zip-archive/9.5.1) [Gradle](https://github.com/mockingbot/react-native-zip-archive/blob/master/android/build.gradle) [security helper](https://github.com/mockingbot/react-native-zip-archive/blob/master/android/src/main/java/com/rnziparchive/ZipSecurity.java) | Its public `zip` and `unzip` calls take filesystem path strings. Internally they construct `File` and `ZipFile`; they do not accept an SAF output stream, offer SHA-256, read back a destination document, or expose enforceable entry and disk limits. Its one `content://` path is `unzipAssets`, based on `java.util.zip.ZipInputStream`, and it writes to a filesystem directory. [JS API](https://github.com/mockingbot/react-native-zip-archive/blob/master/index.d.ts) [Android implementation](https://github.com/mockingbot/react-native-zip-archive/blob/master/android/src/main/java/com/rnziparchive/RNZipArchiveModule.java) |
| Direct Zip4j in the Expo module | ZIP64-capable stream writer and reader are available. `ZipFile` reads the central directory from a local `File`, and `getInputStream(FileHeader)` streams one entry. [stream writer](https://github.com/srikanth-lingala/zip4j/blob/master/src/main/java/net/lingala/zip4j/io/outputstream/ZipOutputStream.java) [stream reader](https://github.com/srikanth-lingala/zip4j/blob/master/src/main/java/net/lingala/zip4j/io/inputstream/ZipInputStream.java) [random-access reader](https://github.com/srikanth-lingala/zip4j/blob/master/src/main/java/net/lingala/zip4j/ZipFile.java) | Recommended. The module adds the missing SAF, hash, policy, progress, and cleanup layers. |
| Apache Commons Compress | Mature Apache project, current 1.28.0 release, Java 8 target, ZIP64-capable `ZipArchiveOutputStream(OutputStream)` and `ZipArchiveInputStream(InputStream)`. [Maven metadata](https://repo1.maven.org/maven2/org/apache/commons/commons-compress/maven-metadata.xml) [POM](https://repo1.maven.org/maven2/org/apache/commons/commons-compress/1.28.0/commons-compress-1.28.0.pom) [ZIP documentation](https://commons.apache.org/proper/commons-compress/zip.html) | Viable, but not simpler here. Its documentation says a streaming `ZipArchiveInputStream` cannot reliably represent the central directory, duplicate names, or external attributes, including the metadata needed to identify symlinks. Its `ZipFile` requires a seekable local source, so it still needs the same staging and policy module. [stream limitations](https://commons.apache.org/proper/commons-compress/zip.html) |
| Android `java.util.zip` | Standard streaming ZIP classes. | Android's API references do not promise ZIP64 behavior. Do not make the app's ZIP64 guarantee depend on undocumented platform behavior. [ZipOutputStream reference](https://developer.android.com/reference/java/util/zip/ZipOutputStream) |

## Recommended native contract and data flow

Keep the TypeScript API narrow. It should pass local input paths, a picked source URI, or a create-document request, plus fixed native limits. It should receive progress and a small result object. Never pass archive bytes, blob bytes, or digest buffers over the JS bridge.

### Export

1. The Kotlin module receives the persisted connected-folder tree URI and creates a direct child document with `DocumentsContract.createDocument`.
2. Open the child URI for writing and wrap its output in `DigestOutputStream(MessageDigest.getInstance("SHA-256"))`, then `ZipOutputStream`. Prefer `ContentResolver.openFileDescriptor(uri, "w", cancellationSignal)` plus a descriptor-backed stream so cancellation can reach providers that honor it. [ContentResolver reference](https://developer.android.com/reference/android/content/ContentResolver)
3. For the sanitized SQLite file and every blob, read a fixed native buffer, update that entry's `MessageDigest`, and write the same buffer to Zip4j. Set the entry name exactly: `database.sqlite` and `blobs/sha256/<lowercase-hex-digest>`. Set `ZipParameters.entrySize` before `putNextEntry` when a streamed entry exceeds 4 GiB. Do not add directory entries, symlinks, arbitrary names, encryption, or signatures. Close each entry before storing its byte count and SHA-256 in an in-memory manifest record.
4. Serialize the UTF-8 manifest only after all payload entries, then close the ZIP stream. Closing is mandatory because it writes the central directory and ZIP64 end records. The manifest remains last.
5. Record the outer digest after the stream closes. Re-open the returned document URI with `ContentResolver.openInputStream`, hash it in fixed native buffers, and require equality with the write digest before reporting export success. `DigestInputStream` updates its `MessageDigest` as bytes pass through `read`; call `digest()` only after EOF. [DigestInputStream reference](https://developer.android.com/reference/java/security/DigestInputStream)

The first digest proves what the module sent to the provider. The second proves what it can read back from that document after the provider accepted the write. This is the right check for a DocumentsProvider such as Drive. It is not an atomic remote durability guarantee, and the module must not claim that it is.

### Import

A purely streaming parse of a hostile `content://` ZIP is not sufficient for this format. The central directory is where ZIP exposes complete entry metadata. Stage the archive to an app-private temporary file **in native code**, using a fixed buffer and whole-archive SHA-256. Stop at the configured maximum compressed archive bytes. This uses disk, not JavaScript memory.

Then open that staged file with `ZipFile` and validate the complete central directory before creating any restored app data:

- require a non-encrypted, single-volume ZIP with at least one and at most the configured entry count;
- require unique names, reject NUL, backslash, leading slash, empty path segments, `.` and `..`, and reject any name outside the exact grammar `database.sqlite`, `blobs/sha256/[0-9a-f]{64}`, or `manifest.json`;
- require `manifest.json` to be the final entry, require every blob pathname digest to equal its manifest digest, and reject missing or extra entries;
- reject a symbolic-link entry from the central-directory external attributes. Zip4j itself detects a symlink from bit 5 of the fourth external-attributes byte during extraction, so use the same check and reject rather than skip. [Zip4j extraction code](https://github.com/srikanth-lingala/zip4j/blob/master/src/main/java/net/lingala/zip4j/tasks/AbstractExtractFileTask.java)
- reject unsupported compression, encryption, unknown or negative sizes, an entry over the configured uncompressed limit, a total over the configured uncompressed limit, and an entry or aggregate whose declared expansion ratio exceeds the configured ratio. Treat a zero compressed size with nonzero uncompressed size as a limit failure.

Only after that pass should the module use `ZipFile.getInputStream(fileHeader)` to stream each allowed payload entry into a new app-private staging directory. Wrap each entry input in SHA-256, count actual bytes on every read, and reapply per-entry, total, and expansion limits to the actual bytes. Compare the final per-entry hashes and sizes to the manifest. A manifest mismatch, corrupt ZIP CRC, cancellation, or I/O failure deletes the staging directory. Commit the database and blobs only after every check succeeds.

Before staging, reserve space for the configured maximum archive plus extraction or reject early. After header validation, require enough simultaneous free space for `stagedArchive.length + declaredExpandedBytes + safetyMargin`, then re-check before every output file. `StatFs.getAvailableBytes()` is only a point-in-time reading, so every write must still handle low-space failure. Use it on the app-private volume, not a provider-reported `COLUMN_SIZE`, which may be absent or stale. [StatFs reference](https://developer.android.com/reference/android/os/StatFs)

### Cancellation and cleanup

Expose an operation ID and `cancel(operationId)`. The operation owns its `CancellationSignal`, active `ParcelFileDescriptor`, streams, temporary archive, and staging directory. Use `ContentResolver.openFileDescriptor` overloads that accept the signal where possible because `openInputStream` and `openOutputStream` do not accept one. `cancel` signals cancellation and closes the active descriptor or stream; every buffer iteration also calls `throwIfCanceled()`. Provider I/O interruption is best effort because a provider may not honor cancellation immediately. [CancellationSignal reference](https://developer.android.com/reference/android/os/CancellationSignal) [ContentResolver reference](https://developer.android.com/reference/android/content/ContentResolver)

Always close the ZIP stream before the resolver stream, and close every Zip4j entry stream. In `finally`, remove native temporary files and uncommitted extraction output. If an export fails or is cancelled after a document was created, inspect `Document.COLUMN_FLAGS` for `FLAG_SUPPORTS_DELETE` and call `DocumentsContract.deleteDocument` only for that newly created URI. Some providers may not support deletion, so surface a truthful "partial destination may remain" result. [SAF deletion guidance](https://developer.android.com/training/data-storage/shared/documents-files) [DocumentsContract reference](https://developer.android.com/reference/android/provider/DocumentsContract)

## Constraints to carry into the later specification

- Define actual numeric limits before implementation: maximum archive bytes, entries, bytes per entry, total expanded bytes, expansion ratio, manifest bytes, and a disk safety reserve. They are product limits, not Zip4j defaults.
- Keep all buffers native and bounded. A 64 KiB to 256 KiB buffer is sufficient. Progress events and a compact final result are the only JS traffic.
- Retain the selected source URI only if the module takes persistable permission. Otherwise import immediately. Do not request Drive scopes.
- The module must derive entry names itself. Never accept an arbitrary archive member name from JavaScript or a blob filename.
- Per-entry SHA-256 cannot literally include a SHA-256 for `manifest.json` inside that same final manifest. That is a self-referential hash. The format must explicitly say that the manifest hashes payload entries only, while the whole-archive readback SHA-256 is an operation result or separately stored metadata. The manifest can still be syntax-checked, bounded, and checked for structural consistency through its position and verified payload hashes, but it has no cryptographic authenticity without the deliberately excluded signature feature.
- Whole-archive SHA-256 detects accidental destination corruption. With no signature or encryption, it does not authenticate a backup supplied by an attacker. That matches the fixed no-signature decision, but it should be stated plainly in the UX and later spec.

## Validation plan

Add focused native tests before product work:

1. Export and import a ZIP64 fixture with more than 65,535 tiny entries and another with an entry over 4 GiB generated without allocating it in JS.
2. Exercise a Drive or other remote DocumentsProvider tree: persist permission, create a direct child, stream write, close, native readback SHA-256, enumerate the child again, and compare.
3. Reject traversal variants, absolute paths, backslashes, duplicates, a symlink, encrypted entries, unsupported compression, an oversized manifest, oversized counts, bad declared sizes, high ratio, bad entry digest, and a non-final manifest.
4. Cancel during source staging, ZIP writing, document write, document readback, and extraction. Assert no app staging data is committed and only the provider document may remain when deletion is unsupported.
5. Force low-space admission failures before staging and during extraction.

The tests should use real native streams and fixed buffers. A JavaScript fixture loader that materializes the archive would miss the failure mode this work is meant to avoid.

## Independent review

An independent primary-source review accepted the native-module architecture with the corrections now incorporated above. It verified the pinned Zip4j stream APIs and ZIP64 test behavior, installed Expo package behavior, Android SAF and cancellation APIs, and the inspected React Native wrapper. The review rejected the original per-export `ACTION_CREATE_DOCUMENT` flow after the product adopted a persisted managed folder, required explicit entry sizes for streamed entries over 4 GiB, narrowed cancellation guarantees for provider I/O, and corrected simultaneous disk admission and manifest-authentication wording.
