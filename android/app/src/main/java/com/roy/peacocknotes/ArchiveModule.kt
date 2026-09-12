package com.roy.peacocknotes

import android.database.Cursor
import android.database.sqlite.SQLiteDatabase
import android.net.Uri
import android.os.StatFs
import android.provider.DocumentsContract
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.ReadableArray
import com.facebook.react.bridge.ReadableMap
import net.lingala.zip4j.ZipFile
import net.lingala.zip4j.io.outputstream.ZipOutputStream
import net.lingala.zip4j.model.ZipParameters
import net.lingala.zip4j.model.enums.CompressionMethod
import org.json.JSONArray
import org.json.JSONObject
import java.io.BufferedInputStream
import java.io.BufferedOutputStream
import java.io.File
import java.io.FileInputStream
import java.io.FileOutputStream
import java.io.InputStream
import java.io.OutputStream
import java.security.MessageDigest
import java.text.Normalizer
import java.time.Instant
import java.util.Locale
import java.util.UUID
import java.util.concurrent.Executors

class ArchiveModule(private val context: ReactApplicationContext) : ReactContextBaseJavaModule(context) {
  companion object {
    private const val FORMAT_VERSION = 1
    private const val DATABASE_VERSION = 1
    private const val MANIFEST_PATH = "manifest.json"
    private const val DATABASE_PATH = "database/content.sqlite"
    private const val BUFFER_SIZE = 64 * 1024
    private const val MAX_MANIFEST_BYTES = 2L * 1024 * 1024
    private const val FOLDER_PREFERENCES = "peacock_notes_backup_folder"
    private const val FOLDER_URI = "folder_uri"
    private const val REPLACEMENT_PREFERENCES = "peacock_notes_full_replacement"
    private const val REPLACEMENT_JOURNAL = "journal"
    private const val REPLACEMENT_UNDO = "undo"
    private const val LAST_UNDONE_SNAPSHOT = "last_undone_snapshot"
    private const val UNDO_WINDOW_MILLIS = 168L * 60 * 60 * 1000
    private val ARCHIVE_NAME = Regex("^peacock-notes-\\d{4}-\\d{2}-\\d{2}T\\d{2}-\\d{2}-\\d{2}-\\d{3}Z(?:-[a-zA-Z0-9_-]+)?\\.pnbak$")
    private val INCOMPATIBLE_CODES = setOf("UNSUPPORTED_FORMAT_VERSION", "UNSUPPORTED_DATABASE_VERSION")
    private val UNCERTAIN_CODES = setOf("SOURCE_UNAVAILABLE", "STAGING_UNAVAILABLE", "INSUFFICIENT_STORAGE", "ARCHIVE_OPERATION_FAILED")
  }

  private val executor = Executors.newSingleThreadExecutor()
  override fun getName() = "Archive"

  @ReactMethod
  fun pinMedia(request: ReadableMap, promise: Promise) = executor.execute {
    runCatching { pin(request) }
      .onSuccess(promise::resolve)
      .onFailure { promise.reject(errorCode(it), it.message, it) }
  }

  @ReactMethod
  fun createArchive(request: ReadableMap, promise: Promise) = executor.execute {
    runCatching { create(request) }
      .onSuccess(promise::resolve)
      .onFailure { promise.reject(errorCode(it), it.message, it) }
  }

  @ReactMethod
  fun validateArchive(request: ReadableMap, promise: Promise) = executor.execute {
    runCatching { validate(request) }
      .onSuccess(promise::resolve)
      .onFailure { promise.reject(errorCode(it), it.message, it) }
  }

  @ReactMethod
  fun scanConnectedFolder(promise: Promise) = executor.execute {
    runCatching { scanFolder() }
      .onSuccess(promise::resolve)
      .onFailure { promise.reject("PROVIDER_SCAN_FAILED", it.message, it) }
  }

  @ReactMethod
  fun applyManagedRetention(promise: Promise) = executor.execute {
    runCatching { applyRetention() }
      .onSuccess(promise::resolve)
      .onFailure { promise.reject(errorCode(it), it.message, it) }
  }

  @ReactMethod
  fun previewImport(request: ReadableMap, promise: Promise) = executor.execute {
    runCatching { preview(request) }
      .onSuccess(promise::resolve)
      .onFailure { promise.reject(errorCode(it), it.message, it) }
  }

  @ReactMethod
  fun commitSelectiveImport(request: ReadableMap, promise: Promise) = executor.execute {
    runCatching { commitImport(request) }
      .onSuccess(promise::resolve)
      .onFailure { promise.reject(errorCode(it), it.message, it) }
  }

  @ReactMethod
  fun commitFullReplacement(request: ReadableMap, promise: Promise) = executor.execute {
    runCatching { commitReplacement(request) }
      .onSuccess(promise::resolve)
      .onFailure { promise.reject(errorCode(it), it.message, it) }
  }

  @ReactMethod
  fun recoverFullReplacement(promise: Promise) = executor.execute {
    runCatching {
      val rolledBack = recoverReplacementIfNeeded()
      Arguments.createMap().apply { putBoolean("rolledBack", rolledBack) }
    }.onSuccess(promise::resolve).onFailure { promise.reject(errorCode(it), it.message, it) }
  }

  @ReactMethod
  fun getFullReplacementUndo(promise: Promise) = executor.execute {
    runCatching { replacementUndoStatus() }
      .onSuccess(promise::resolve)
      .onFailure { promise.reject(errorCode(it), it.message, it) }
  }

  @ReactMethod
  fun undoFullReplacement(request: ReadableMap, promise: Promise) = executor.execute {
    runCatching { undoReplacement(requiredString(request, "snapshotId")) }
      .onSuccess(promise::resolve)
      .onFailure { promise.reject(errorCode(it), it.message, it) }
  }

  @ReactMethod
  fun hasFullReplacementUndoReceipt(request: ReadableMap, promise: Promise) = executor.execute {
    val snapshotId = requiredString(request, "snapshotId")
    val preferences = context.getSharedPreferences(REPLACEMENT_PREFERENCES, android.app.Activity.MODE_PRIVATE)
    promise.resolve(Arguments.createMap().apply {
      putBoolean("committed", preferences.getString(LAST_UNDONE_SNAPSHOT, null) == snapshotId)
    })
  }

  @ReactMethod
  fun hasImportReceipt(request: ReadableMap, promise: Promise) = executor.execute {
    runCatching {
      val db = SQLiteDatabase.openDatabase(fileFromUri(requiredString(request, "databaseUri")).path, null, SQLiteDatabase.OPEN_READONLY)
      try {
        Arguments.createMap().apply { putBoolean("committed", importReceiptExists(db, requiredString(request, "operationKey"))) }
      } finally { db.close() }
    }.onSuccess(promise::resolve).onFailure { promise.reject(errorCode(it), it.message, it) }
  }

  private fun scanFolder(): com.facebook.react.bridge.WritableMap {
    val folder = context.getSharedPreferences(FOLDER_PREFERENCES, android.app.Activity.MODE_PRIVATE)
      .getString(FOLDER_URI, null)?.let(Uri::parse)
      ?: fail("FOLDER_NOT_CONNECTED", "No backup folder is connected")
    val children = DocumentsContract.buildChildDocumentsUriUsingTree(
      folder,
      DocumentsContract.getTreeDocumentId(folder)
    )
    val projection = arrayOf(
      DocumentsContract.Document.COLUMN_DOCUMENT_ID,
      DocumentsContract.Document.COLUMN_DISPLAY_NAME,
      DocumentsContract.Document.COLUMN_MIME_TYPE,
      DocumentsContract.Document.COLUMN_SIZE,
      DocumentsContract.Document.COLUMN_LAST_MODIFIED
    )
    val archives = Arguments.createArray()
    var complete = true
    val cursor = context.contentResolver.query(children, projection, null, null, null)
      ?: fail("PROVIDER_SCAN_FAILED", "The document provider returned no folder listing")
    cursor.use {
      while (it.moveToNext()) {
        val name = it.stringOrNull(DocumentsContract.Document.COLUMN_DISPLAY_NAME) ?: continue
        val mime = it.stringOrNull(DocumentsContract.Document.COLUMN_MIME_TYPE)
        if (!ARCHIVE_NAME.matches(name) || mime == DocumentsContract.Document.MIME_TYPE_DIR) continue
        val id = it.stringOrNull(DocumentsContract.Document.COLUMN_DOCUMENT_ID)
        if (id == null) {
          complete = false
          continue
        }
        val uri = DocumentsContract.buildDocumentUriUsingTree(folder, id)
        val size = it.longOrNull(DocumentsContract.Document.COLUMN_SIZE)
        val modified = it.longOrNull(DocumentsContract.Document.COLUMN_LAST_MODIFIED)
        archives.pushMap(scanArchive(uri, name, size, modified))
      }
      complete = complete &&
        !it.extras.getBoolean(DocumentsContract.EXTRA_LOADING, false) &&
        !it.extras.containsKey(DocumentsContract.EXTRA_ERROR)
    }
    return Arguments.createMap().apply {
      putBoolean("complete", complete)
      putArray("archives", archives)
    }
  }

  private fun scanArchive(uri: Uri, name: String, providerSize: Long?, modified: Long?) = Arguments.createMap().apply {
    putString("uri", uri.toString())
    putString("name", name)
    if (providerSize == null) putNull("bytes") else putDouble("bytes", providerSize.toDouble())
    if (modified == null) putNull("providerModifiedAt") else putDouble("providerModifiedAt", modified.toDouble())
    try {
      val request = Arguments.createMap().apply { putString("archiveUri", uri.toString()) }
      val validated = validate(request)
      putString("state", "valid")
      putString("verification", "verified")
      putString("compatibility", "compatible")
      putString("createdAt", validated.getString("createdAt"))
      putDouble("bytes", validated.getDouble("archiveBytes"))
    } catch (error: Exception) {
      val code = errorCode(error)
      val state = when (code) {
        in INCOMPATIBLE_CODES -> "incompatible"
        in UNCERTAIN_CODES -> "uncertain"
        else -> "damaged"
      }
      putString("state", state)
      putString("verification", if (state == "damaged") "failed" else "not_verified")
      putString("compatibility", if (state == "incompatible") "incompatible" else "unknown")
      putNull("createdAt")
    }
  }

  private fun applyRetention(): com.facebook.react.bridge.WritableMap {
    val scan = scanFolder()
    if (!scan.getBoolean("complete")) {
      fail("RETENTION_SCAN_INCOMPLETE", "Managed retention requires a complete trustworthy folder scan")
    }
    val archives = scan.getArray("archives") ?: fail("RETENTION_SCAN_INCOMPLETE", "The folder scan did not return archives")
    val retentionArchives = (0 until archives.size()).mapNotNull { index ->
      val archive = archives.getMap(index) ?: return@mapNotNull null
      val uri = archive.getString("uri") ?: return@mapNotNull null
      val createdAt = archive.getString("createdAt")?.let {
        try { Instant.parse(it).toEpochMilli() } catch (_: Exception) { null }
      }
      RetentionArchiveCandidate(uri, archive.getString("state") ?: "uncertain", createdAt)
    }
    val candidates = ArchiveRetentionPolicy.expiredVerifiedArchiveKeys(
      retentionArchives,
      System.currentTimeMillis(),
      UNDO_WINDOW_MILLIS,
    ).map(Uri::parse)

    // Establish policy support for every candidate before deleting any recovery point.
    candidates.forEach { candidate ->
      val flags = context.contentResolver.query(
        candidate,
        arrayOf(DocumentsContract.Document.COLUMN_FLAGS),
        null,
        null,
        null,
      )?.use { cursor ->
        if (!cursor.moveToFirst()) null else cursor.longOrNull(DocumentsContract.Document.COLUMN_FLAGS)
      } ?: fail("RETENTION_POLICY_RESTRICTED", "The provider did not report whether an archive can be deleted")
      if (flags and DocumentsContract.Document.FLAG_SUPPORTS_DELETE.toLong() == 0L) {
        fail("RETENTION_POLICY_RESTRICTED", "The connected folder does not permit managed archive deletion")
      }
    }

    var deleted = 0
    candidates.forEach { candidate ->
      val removed = try {
        DocumentsContract.deleteDocument(context.contentResolver, candidate)
      } catch (error: Exception) {
        fail("PROVIDER_DELETE_FAILED", "The provider failed while applying managed retention", error)
      }
      if (!removed) fail("PROVIDER_DELETE_FAILED", "The provider refused to delete an expired archive")
      deleted += 1
    }
    return Arguments.createMap().apply {
      putString("status", if (candidates.isEmpty()) "nothing_to_prune" else "applied")
      putInt("deletedCount", deleted)
      putInt("retainedVerifiedCount", retentionArchives.count { it.state == "valid" && it.createdAt != null } - deleted)
    }
  }

  private fun Cursor.stringOrNull(column: String): String? {
    val index = getColumnIndex(column)
    return if (index >= 0 && !isNull(index)) getString(index) else null
  }

  private fun Cursor.longOrNull(column: String): Long? {
    val index = getColumnIndex(column)
    return if (index >= 0 && !isNull(index)) getLong(index) else null
  }

  private fun pin(request: ReadableMap): com.facebook.react.bridge.WritableArray {
    val directory = fileFromUri(requiredString(request, "directoryUri"))
    if (!directory.exists() && !directory.mkdirs()) fail("STAGING_UNAVAILABLE", "Cannot create capture directory")
    val media = parseMedia(request.getArray("media") ?: fail("INVALID_REQUEST", "media is required"))
    val result = Arguments.createArray()
    media.forEachIndexed { index, source ->
      val target = File(directory, "pin-$index")
      val sourceFile = fileFromUri(source.uri)
      try {
        java.nio.file.Files.createLink(target.toPath(), sourceFile.toPath())
      } catch (_: Exception) {
        open(source.uri).use { input -> FileOutputStream(target).use { output -> copyBounded(input, output, Long.MAX_VALUE) } }
      }
      result.pushMap(Arguments.createMap().apply {
        putString("portableId", source.portableId)
        putString("sourceUri", Uri.fromFile(target).toString())
        putString("kind", source.kind)
      })
    }
    return result
  }

  private fun create(request: ReadableMap): com.facebook.react.bridge.WritableMap {
    val limits = Limits.from(null)
    val databaseUri = requiredString(request, "databaseUri")
    val destinationUri = requiredString(request, "destinationUri")
    val createdAt = requiredString(request, "createdAt")
    val revision = requiredNonNegativeLong(request, "contentRevision")
    val media = parseMedia(request.getArray("media") ?: fail("INVALID_REQUEST", "media is required"))
    val work = newWorkDirectory("create")
    try {
      val sourceDatabase = materialize(databaseUri, File(work, "source.sqlite"), Long.MAX_VALUE)
      val hashedMedia = media.map { source ->
        val digest = open(source.uri).use(::sha256)
        if (digest.bytes > limits.maxMediaItemBytes) fail("MEDIA_LIMIT_EXCEEDED", "Media item exceeds limit")
        HashedMedia(source, digest.hex, digest.bytes)
      }
      if (hashedMedia.size > limits.maxMediaItems) fail("MEDIA_LIMIT_EXCEEDED", "Too many media items")
      hashedMedia.fold(0L) { total, item -> checkedAdd(total, item.size, limits.maxMediaBytes) }
      val mediaById = hashedMedia.associateBy { it.source.portableId }
      if (mediaById.size != hashedMedia.size) fail("DUPLICATE_IDENTITY", "Duplicate media portable identity")

      val cleanDatabase = File(work, "content.sqlite")
      sanitizeDatabase(sourceDatabase, cleanDatabase, mediaById)
      val databaseDigest = FileInputStream(cleanDatabase).use(::sha256)
      if (databaseDigest.bytes > limits.maxDatabaseBytes) fail("DATABASE_LIMIT_EXCEEDED", "Database exceeds limit")
      val inventory = linkedMapOf(DATABASE_PATH to databaseDigest)
      hashedMedia.forEach { inventory.putIfAbsent(it.path, Digest(it.hash, it.size)) }
      ensureSpace(work, inventory.values.sumOf { it.bytes } * 2 + MAX_MANIFEST_BYTES)

      val manifest = manifest(createdAt, revision, inventory, inventory.keys.count { it.startsWith("media/") })
      validateDatabase(cleanDatabase, inventory, limits)
      val archive = File(work, "archive.pnbak")
      BufferedOutputStream(FileOutputStream(archive)).use { output ->
        ZipOutputStream(output).use { zip ->
          putFile(zip, DATABASE_PATH, cleanDatabase)
          val written = mutableSetOf<String>()
          hashedMedia.forEach { item ->
            if (written.add(item.path)) open(item.source.uri).use { putStream(zip, item.path, it) }
          }
          putBytes(zip, MANIFEST_PATH, manifest.toString().toByteArray(Charsets.UTF_8))
        }
      }
      val archiveDigest = FileInputStream(archive).use(::sha256)
      if (archiveDigest.bytes > limits.maxArchiveBytes) fail("ARCHIVE_LIMIT_EXCEEDED", "Archive exceeds limit")
      copyToUri(archive, destinationUri)
      val readback = open(destinationUri).use(::sha256)
      if (archiveDigest != readback) fail("DESTINATION_VERIFICATION_FAILED", "Published archive readback differs")
      return summary(manifest, archiveDigest, inventory.values.sumOf { it.bytes })
    } finally {
      work.deleteRecursively()
    }
  }

  private fun validate(request: ReadableMap): com.facebook.react.bridge.WritableMap {
    val archiveUri = requiredString(request, "archiveUri")
    val limits = Limits.from(request.getMap("limits"))
    val work = request.optionalString("stagingDirectoryUri")?.let(::fileFromUri)
      ?: newWorkDirectory("validate")
    val ownsWork = !request.hasKey("stagingDirectoryUri") || request.isNull("stagingDirectoryUri")
    if (!work.exists() && !work.mkdirs()) fail("STAGING_UNAVAILABLE", "Cannot create staging directory")
    val archive = File(work, "incoming-${UUID.randomUUID()}.pnbak")
    val extracted = File(work, "validated-${UUID.randomUUID()}")
    try {
      val archiveDigest = materializeDigest(archiveUri, archive, limits.maxArchiveBytes)
      val zip = try { ZipFile(archive) } catch (error: Exception) {
        fail("MALFORMED_ARCHIVE", "Archive cannot be opened", error)
      }
      val headers = try { zip.fileHeaders } catch (error: Exception) {
        fail("MALFORMED_ARCHIVE", "ZIP directory is malformed or truncated", error)
      }
      if (headers.size > limits.maxEntries) fail("ENTRY_LIMIT_EXCEEDED", "Archive has too many entries")
      val portablePaths = mutableSetOf<String>()
      var advertisedExpanded = 0L
      headers.forEach { header ->
        val path = safePath(header.fileName)
        if (!portablePaths.add(portableIdentity(path))) fail("DUPLICATE_PATH", "Duplicate portable path: $path")
        if (header.isDirectory) fail("UNEXPECTED_ENTRY", "Directory entries are not allowed")
        val size = header.uncompressedSize
        if (size < 0) fail("MALFORMED_ARCHIVE", "Entry has unknown expanded size")
        advertisedExpanded = checkedAdd(advertisedExpanded, size, limits.maxExpandedBytes)
      }
      if (!portablePaths.contains(portableIdentity(MANIFEST_PATH))) fail("MISSING_MANIFEST", "Manifest is missing")
      ensureSpace(work, checkedAdd(archive.length(), advertisedExpanded, Long.MAX_VALUE))
      if (!extracted.mkdirs()) fail("STAGING_UNAVAILABLE", "Cannot create extraction directory")

      val manifestBytes = readEntryBounded(zip, MANIFEST_PATH, MAX_MANIFEST_BYTES)
      val manifest = try { JSONObject(String(manifestBytes, Charsets.UTF_8)) } catch (error: Exception) {
        fail("MALFORMED_MANIFEST", "Manifest is not valid JSON", error)
      }
      enforceManifestVersion(manifest)
      val inventory = parseInventory(manifest, limits)
      val expectedPaths = inventory.keys.map(::portableIdentity).toMutableSet().apply { add(portableIdentity(MANIFEST_PATH)) }
      if (portablePaths != expectedPaths) fail("INVENTORY_MISMATCH", "ZIP entries do not exactly match the inventory")

      var expanded = 0L
      inventory.forEach { (path, expected) ->
        val limit = when {
          path == DATABASE_PATH -> limits.maxDatabaseBytes
          path.startsWith("media/sha256/") -> limits.maxMediaItemBytes
          else -> fail("UNEXPECTED_ENTRY", "Unsupported inventory path: $path")
        }
        if (expected.bytes > limit) fail("ENTRY_LIMIT_EXCEEDED", "Entry exceeds its allowed size: $path")
        val target = File(extracted, path)
        target.parentFile?.mkdirs()
        val actual = zip.getInputStream(zip.getFileHeader(path)).use { input ->
          FileOutputStream(target).use { output -> copyAndHash(input, output, minOf(limit, expected.bytes), expected.bytes) }
        }
        if (actual != expected) fail("HASH_MISMATCH", "Hash or size mismatch: $path")
        expanded = checkedAdd(expanded, actual.bytes, limits.maxExpandedBytes)
      }
      validateDatabase(File(extracted, DATABASE_PATH), inventory, limits)
      File(extracted, MANIFEST_PATH).writeText(manifest.toString(), Charsets.UTF_8)
      return summary(manifest, archiveDigest, expanded)
    } finally {
      archive.delete()
      if (ownsWork) work.deleteRecursively()
    }
  }

  private fun preview(request: ReadableMap): com.facebook.react.bridge.WritableMap {
    val archiveUri = requiredString(request, "archiveUri")
    val work = newWorkDirectory("preview")
    try {
      val validationRequest = Arguments.createMap().apply {
        putString("archiveUri", archiveUri)
        putString("stagingDirectoryUri", Uri.fromFile(work).toString())
      }
      val summary = validate(validationRequest)
      val extracted = work.listFiles()?.singleOrNull { it.isDirectory && it.name.startsWith("validated-") }
        ?: fail("STAGING_UNAVAILABLE", "Validated import staging is missing")
      val db = SQLiteDatabase.openDatabase(File(extracted, DATABASE_PATH).path, null, SQLiteDatabase.OPEN_READONLY)
      val notes = Arguments.createArray()
      try {
        db.rawQuery("SELECT n.portableId,n.title,substr(n.content,1,180),n.updatedAt,f.name,(SELECT COUNT(*) FROM NoteAudios a WHERE a.notePortableId=n.portableId),(SELECT COUNT(*) FROM NoteFiles x WHERE x.notePortableId=n.portableId) FROM Notes n JOIN Folders f ON f.portableId=n.folderPortableId ORDER BY n.updatedAt DESC,n.portableId", null).use { cursor ->
          while (cursor.moveToNext()) notes.pushMap(Arguments.createMap().apply {
            putString("portableId", cursor.getString(0)); putString("title", cursor.getString(1))
            putString("contentPreview", cursor.getString(2)?.take(180) ?: ""); putString("updatedAt", cursor.getString(3))
            putString("folderName", cursor.getString(4)); putInt("audioCount", cursor.getInt(5)); putInt("fileCount", cursor.getInt(6))
          })
        }
      } finally { db.close() }
      return Arguments.createMap().apply {
        putString("archiveUri", archiveUri); putString("archiveSha256", summary.getString("archiveSha256"))
        putString("createdAt", summary.getString("createdAt")); putArray("notes", notes)
      }
    } finally { work.deleteRecursively() }
  }

  private fun commitImport(request: ReadableMap): com.facebook.react.bridge.WritableMap {
    val archiveUri = requiredString(request, "archiveUri")
    val expectedHash = requiredString(request, "archiveSha256")
    val databaseFile = fileFromUri(requiredString(request, "databaseUri"))
    val mediaRoot = fileFromUri(requiredString(request, "mediaDirectoryUri"))
    val operationKey = requiredString(request, "operationKey")
    val selectedArray = request.getArray("selectedNoteIds") ?: fail("INVALID_REQUEST", "selectedNoteIds is required")
    val selected = (0 until selectedArray.size()).map { requireUuid(selectedArray.getString(it) ?: fail("INVALID_REQUEST", "Invalid selected note identity")) }.toSet()
    if (selected.isEmpty()) fail("EMPTY_SELECTION", "Select at least one note")
    val work = newWorkDirectory("import")
    try {
      val validationRequest = Arguments.createMap().apply {
        putString("archiveUri", archiveUri); putString("stagingDirectoryUri", Uri.fromFile(work).toString())
      }
      val summary = validate(validationRequest)
      if (summary.getString("archiveSha256") != expectedHash) fail("ARCHIVE_CHANGED", "The selected archive changed after preview")
      val extracted = work.listFiles()?.singleOrNull { it.isDirectory && it.name.startsWith("validated-") }
        ?: fail("STAGING_UNAVAILABLE", "Validated import staging is missing")
      val source = SQLiteDatabase.openDatabase(File(extracted, DATABASE_PATH).path, null, SQLiteDatabase.OPEN_READONLY)
      val live = SQLiteDatabase.openDatabase(databaseFile.path, null, SQLiteDatabase.OPEN_READWRITE)
      val createdMedia = mutableSetOf<File>()
      var mediaCommitted = false
      try {
        importReceiptResult(live, operationKey)?.let { return it }
        val available = mutableSetOf<String>()
        source.rawQuery("SELECT portableId FROM Notes", null).use { while (it.moveToNext()) available.add(it.getString(0)) }
        if (!available.containsAll(selected)) fail("INVALID_SELECTION", "The selection contains a note absent from the archive")

        if (!mediaRoot.exists() && !mediaRoot.mkdirs()) fail("STAGING_UNAVAILABLE", "Cannot create media directory")
        ensureSpace(mediaRoot, summary.getDouble("expandedBytes").toLong())
        val restrictions = inspectCurrentMedia(live, mediaRoot)

        val mediaUris = mutableMapOf<String, String>()
        listOf("NoteAudios", "NoteFiles").forEach { table ->
          source.rawQuery("SELECT DISTINCT mediaPath FROM $table WHERE notePortableId IN (${selected.joinToString(",") { "?" }})", selected.toTypedArray()).use { cursor ->
            while (cursor.moveToNext()) {
              val path = cursor.getString(0); val staged = File(extracted, path)
              val hash = path.substringAfterLast('/')
              val kind = if (table == "NoteAudios") "audio" else "files"
              val addressedTarget = File(File(mediaRoot, kind), hash)
              addressedTarget.parentFile?.mkdirs()
              val addressedDigest = if (addressedTarget.exists()) runCatching { FileInputStream(addressedTarget).use(::sha256) }.getOrNull() else null
              val target = if (addressedTarget.exists() && addressedDigest?.hex != hash) {
                val keyHash = MessageDigest.getInstance("SHA-256").digest(operationKey.toByteArray()).joinToString("") { "%02x".format(it) }.take(12)
                File(addressedTarget.parentFile, "$hash.recovered-$keyHash")
              } else addressedTarget
              if (!target.exists()) {
                createdMedia.add(target)
                copyFileVerified(staged, target, "STAGING_VERIFICATION_FAILED")
              }
              mediaUris[mediaKey(table, path)] = Uri.fromFile(target).toString()
            }
          }
        }

        val archiveCreatedAt = summary.getString("createdAt") ?: fail("MALFORMED_MANIFEST", "Archive creation time is missing")
        var imported = 0; var recovered = 0; var skipped = 0
        live.beginTransaction()
        try {
          applyMediaRestrictions(live, restrictions)
          selected.sorted().forEach { noteId ->
            val note = source.rawQuery("SELECT n.portableId,n.folderPortableId,n.title,n.content,n.createdAt,n.updatedAt,n.sortOrder,f.name,f.createdAt,f.sortOrder FROM Notes n JOIN Folders f ON f.portableId=n.folderPortableId WHERE n.portableId=?", arrayOf(noteId)).use { cursor ->
              if (!cursor.moveToFirst()) fail("INVALID_SELECTION", "Selected note is missing")
              List(cursor.columnCount) { index -> if (cursor.isNull(index)) null else cursor.getString(index) }
            }
            val folderId = ensureImportedFolder(live, note[1]!!, note[7]!!, note[8]!!, note[9]!!.toInt())
            val existing = live.rawQuery("SELECT n.id,f.portableId,n.title,n.content,n.createdAt,n.updatedAt,n.sortOrder FROM Notes n JOIN Folders f ON f.id=n.folderId WHERE n.portableId=?", arrayOf(noteId)).use { cursor ->
              if (!cursor.moveToFirst()) null else List(cursor.columnCount) { index -> if (cursor.isNull(index)) null else cursor.getString(index) }
            }
            val unchanged = existing != null && existing[1] == note[1] && existing[2] == note[2] && (existing[3] ?: "") == (note[3] ?: "") && existing[4] == note[4] && existing[5] == note[5] && existing[6] == note[6] && mediaMatches(source, live, noteId, existing[0]!!.toLong())
            if (unchanged) { skipped++; return@forEach }
            val targetPortableId = if (existing == null) noteId else UUID.randomUUID().toString()
            val targetTitle = if (existing == null) note[2]!! else "${note[2]} (Recovered copy)"
            val statement = live.compileStatement("INSERT INTO Notes(portableId,folderId,title,content,audioUri,createdAt,updatedAt,sortOrder) VALUES(?,?,?,?,NULL,?,?,?)")
            statement.bindString(1, targetPortableId); statement.bindLong(2, folderId); statement.bindString(3, targetTitle)
            if (note[3] == null) statement.bindNull(4) else statement.bindString(4, note[3]!!)
            statement.bindString(5, note[4]!!); statement.bindString(6, note[5]!!); statement.bindLong(7, note[6]!!.toLong())
            val liveNoteId = statement.executeInsert()
            copyImportedMedia(source, live, "NoteAudios", noteId, liveNoteId, mediaUris, existing != null)
            copyImportedMedia(source, live, "NoteFiles", noteId, liveNoteId, mediaUris, existing != null)
            if (existing != null) {
              live.execSQL("INSERT INTO RecoveryProvenance(noteId,sourcePortableId,archiveSha256,archiveCreatedAt,archivedUpdatedAt,recoveredAt) VALUES(?,?,?,?,?,?)", arrayOf<Any>(liveNoteId, noteId, expectedHash, archiveCreatedAt, note[5]!!, java.time.Instant.now().toString()))
            }
            imported++; if (existing != null) recovered++
          }
          live.execSQL("INSERT INTO BackupImportReceipts(operationKey,archiveSha256,selectedNoteIds,importedCount,recoveredCount,skippedCount,restrictedAudioCount,restrictedFileCount,committedAt) VALUES(?,?,?,?,?,?,?,?,?)", arrayOf<Any>(operationKey, expectedHash, selected.sorted().joinToString(","), imported, recovered, skipped, restrictions.audioIds.size, restrictions.fileIds.size, java.time.Instant.now().toString()))
          if (imported > 0) live.execSQL("UPDATE ContentMetadata SET revision=revision+1 WHERE id=1")
          live.setTransactionSuccessful()
        } finally { live.endTransaction() }
        mediaCommitted = true
        return importResult(false, imported, recovered, skipped, restrictions.audioIds.size, restrictions.fileIds.size)
      } finally {
        if (!mediaCommitted) createdMedia.forEach { it.delete() }
        source.close()
        live.close()
      }
    } finally { work.deleteRecursively() }
  }

  private fun commitReplacement(request: ReadableMap): com.facebook.react.bridge.WritableMap {
    recoverReplacementIfNeeded()
    val archiveUri = requiredString(request, "archiveUri")
    val expectedHash = requiredString(request, "archiveSha256")
    val databaseFile = fileFromUri(requiredString(request, "databaseUri"))
    val mediaRoot = fileFromUri(requiredString(request, "mediaDirectoryUri"))
    val operationKey = requiredString(request, "operationKey")
    val existing = SQLiteDatabase.openDatabase(databaseFile.path, null, SQLiteDatabase.OPEN_READONLY)
    try {
      if (importReceiptExists(existing, operationKey)) {
        val count = scalarCount(existing, "SELECT COUNT(*) FROM Notes").toInt()
        val restrictions = receiptRestrictions(existing, operationKey)
        return replacementResult(true, count, "existing", restrictions.first, restrictions.second)
      }
    } finally { existing.close() }

    val work = newWorkDirectory("replacement")
    val generationId = UUID.randomUUID().toString()
    val durableRoot = File(context.filesDir, "backup-replacement")
    val staged = File(durableRoot, "staged-$generationId")
    val snapshot = File(durableRoot, "snapshot-$generationId")
    try {
      if (!staged.mkdirs() || !snapshot.mkdirs()) fail("STAGING_UNAVAILABLE", "Cannot create replacement staging")
      val validationRequest = Arguments.createMap().apply {
        putString("archiveUri", archiveUri)
        putString("stagingDirectoryUri", Uri.fromFile(work).toString())
      }
      val summary = validate(validationRequest)
      if (summary.getString("archiveSha256") != expectedHash) fail("ARCHIVE_CHANGED", "The selected archive changed after preview")
      val extracted = work.listFiles()?.singleOrNull { it.isDirectory && it.name.startsWith("validated-") }
        ?: fail("STAGING_UNAVAILABLE", "Validated replacement staging is missing")

      val stagedDatabase = File(staged, "peacocknotes.db")
      copyFileVerified(databaseFile, stagedDatabase, "SAFETY_SNAPSHOT_FAILED")
      val snapshotDatabase = File(snapshot, "peacocknotes.db")
      copyFileVerified(databaseFile, snapshotDatabase, "SAFETY_SNAPSHOT_FAILED")
      val restrictions = createRestrictedSnapshot(snapshotDatabase, mediaRoot, snapshot)

      val source = SQLiteDatabase.openDatabase(File(extracted, DATABASE_PATH).path, null, SQLiteDatabase.OPEN_READONLY)
      val target = SQLiteDatabase.openDatabase(stagedDatabase.path, null, SQLiteDatabase.OPEN_READWRITE)
      val stagedAudio = File(staged, "audio")
      val stagedFiles = File(staged, "files")
      try {
        target.beginTransaction()
        target.execSQL("PRAGMA foreign_keys=OFF")
        listOf("RecoveryProvenance", "NoteAudios", "NoteFiles", "Notes", "Folders").forEach { target.execSQL("DELETE FROM $it") }
        target.execSQL("DELETE FROM sqlite_sequence WHERE name IN ('Folders','Notes','NoteAudios','NoteFiles')")
        copyReplacementFolders(source, target)
        copyReplacementNotes(source, target)
        copyReplacementMedia(source, target, extracted, stagedAudio, true)
        copyReplacementMedia(source, target, extracted, stagedFiles, false)
        target.execSQL("UPDATE ContentMetadata SET revision=revision+1 WHERE id=1")
        val noteCount = scalarCount(source, "SELECT COUNT(*) FROM Notes").toInt()
        target.execSQL(
          "INSERT INTO BackupImportReceipts(operationKey,archiveSha256,selectedNoteIds,importedCount,recoveredCount,skippedCount,restrictedAudioCount,restrictedFileCount,committedAt) VALUES(?,?,?,?,0,0,?,?,?)",
          arrayOf<Any>(operationKey, expectedHash, "__full_replacement__", noteCount, restrictions.audioIds.size, restrictions.fileIds.size, java.time.Instant.now().toString())
        )
        target.setTransactionSuccessful()
      } finally {
        if (target.inTransaction()) target.endTransaction()
        source.close(); target.close()
      }
      verifyLiveGeneration(stagedDatabase, stagedAudio, stagedFiles, operationKey)

      val journal = JSONObject()
        .put("database", databaseFile.path).put("mediaRoot", mediaRoot.path)
        .put("snapshot", snapshot.path).put("staged", staged.path)
      context.getSharedPreferences(REPLACEMENT_PREFERENCES, android.app.Activity.MODE_PRIVATE)
        .edit().putString(REPLACEMENT_JOURNAL, journal.toString()).commit()
      try {
        replaceFile(stagedDatabase, databaseFile)
        replaceDirectory(stagedAudio, File(mediaRoot, "audio"))
        replaceDirectory(stagedFiles, File(mediaRoot, "files"))
        verifyLiveGeneration(databaseFile, File(mediaRoot, "audio"), File(mediaRoot, "files"), operationKey)
      } catch (error: Exception) {
        rollbackReplacement(journal)
        throw ArchiveException("REPLACEMENT_ROLLED_BACK", "Full replacement failed and the prior content was restored", error)
      }
      val completedAt = System.currentTimeMillis()
      val undo = JSONObject()
        .put("snapshotId", generationId).put("snapshot", snapshot.path)
        .put("database", databaseFile.path).put("mediaRoot", mediaRoot.path)
        .put("completedAt", completedAt).put("expiresAt", completedAt + UNDO_WINDOW_MILLIS)
        .put("fingerprint", snapshotFingerprint(snapshot))
      val preferences = context.getSharedPreferences(REPLACEMENT_PREFERENCES, android.app.Activity.MODE_PRIVATE)
      if (!preferences.edit().remove(REPLACEMENT_JOURNAL).putString(REPLACEMENT_UNDO, undo.toString()).commit()) {
        rollbackReplacement(journal)
        fail("UNDO_METADATA_FAILED", "Replacement was rolled back because its undo point could not be saved")
      }
      val count = SQLiteDatabase.openDatabase(databaseFile.path, null, SQLiteDatabase.OPEN_READONLY).useDatabase {
        scalarCount(it, "SELECT COUNT(*) FROM Notes").toInt()
      }
      return replacementResult(false, count, generationId, restrictions.audioIds.size, restrictions.fileIds.size)
    } finally {
      work.deleteRecursively()
      staged.deleteRecursively()
    }
  }

  private fun copyReplacementFolders(source: SQLiteDatabase, target: SQLiteDatabase) {
    copyRows(source, target, "SELECT portableId,name,createdAt,sortOrder FROM Folders ORDER BY portableId", "INSERT INTO Folders(portableId,name,createdAt,sortOrder) VALUES(?,?,?,?)", 4)
  }

  private fun copyReplacementNotes(source: SQLiteDatabase, target: SQLiteDatabase) {
    source.rawQuery("SELECT portableId,folderPortableId,title,content,createdAt,updatedAt,sortOrder FROM Notes ORDER BY portableId", null).use { cursor ->
      val statement = target.compileStatement("INSERT INTO Notes(portableId,folderId,title,content,audioUri,createdAt,updatedAt,sortOrder) VALUES(?,(SELECT id FROM Folders WHERE portableId=?),?,?,NULL,?,?,?)")
      while (cursor.moveToNext()) {
        statement.clearBindings()
        for (index in 0 until cursor.columnCount) bind(statement, index + 1, cursor, index)
        statement.executeInsert()
      }
    }
  }

  private fun copyReplacementMedia(source: SQLiteDatabase, target: SQLiteDatabase, extracted: File, destination: File, audio: Boolean) {
    if (!destination.mkdirs() && !destination.isDirectory) fail("STAGING_UNAVAILABLE", "Cannot stage replacement media")
    val table = if (audio) "NoteAudios" else "NoteFiles"
    val columns = if (audio) "portableId,notePortableId,mediaPath,displayName,groupId,segmentIndex,orderIndex,createdAt" else "portableId,notePortableId,mediaPath,displayName,mimeType,orderIndex,createdAt"
    val insert = if (audio)
      "INSERT INTO NoteAudios(portableId,noteId,uri,displayName,groupId,segmentIndex,orderIndex,createdAt) VALUES(?,(SELECT id FROM Notes WHERE portableId=?),?,?,?,?,?,?)"
    else "INSERT INTO NoteFiles(portableId,noteId,uri,displayName,mimeType,orderIndex,createdAt) VALUES(?,(SELECT id FROM Notes WHERE portableId=?),?,?,?,?,?)"
    source.rawQuery("SELECT $columns FROM $table ORDER BY portableId", null).use { cursor ->
      val statement = target.compileStatement(insert)
      while (cursor.moveToNext()) {
        val sourceFile = File(extracted, cursor.getString(2))
        val targetFile = File(destination, cursor.getString(2).substringAfterLast('/'))
        if (!targetFile.exists()) copyFileVerified(sourceFile, targetFile, "STAGING_VERIFICATION_FAILED")
        statement.clearBindings()
        statement.bindString(1, cursor.getString(0)); statement.bindString(2, cursor.getString(1))
        statement.bindString(3, Uri.fromFile(File(File(fileFromUri("file://${context.filesDir.path}"), if (audio) "audio" else "files"), targetFile.name)).toString())
        for (index in 3 until cursor.columnCount) bind(statement, index + 1, cursor, index)
        statement.executeInsert()
      }
    }
  }

  private fun verifyLiveGeneration(database: File, audio: File, files: File, operationKey: String) {
    val db = SQLiteDatabase.openDatabase(database.path, null, SQLiteDatabase.OPEN_READONLY)
    try {
      val integrity = db.rawQuery("PRAGMA integrity_check", null).use { if (it.moveToFirst()) it.getString(0) else "failed" }
      if (integrity != "ok" || !importReceiptExists(db, operationKey)) fail("POST_SWITCH_VERIFICATION_FAILED", "Replacement database verification failed")
      listOf("NoteAudios" to audio, "NoteFiles" to files).forEach { (table, root) ->
        db.rawQuery("SELECT uri FROM $table", null).use { cursor ->
          while (cursor.moveToNext()) if (!File(root, File(Uri.parse(cursor.getString(0)).path ?: "").name).isFile) {
            fail("POST_SWITCH_VERIFICATION_FAILED", "Replacement media verification failed")
          }
        }
      }
    } finally { db.close() }
  }

  private fun replacementUndoStatus(): com.facebook.react.bridge.WritableMap {
    val preferences = context.getSharedPreferences(REPLACEMENT_PREFERENCES, android.app.Activity.MODE_PRIVATE)
    val raw = preferences.getString(REPLACEMENT_UNDO, null)
      ?: return undoStatus("none")
    val undo = runCatching { JSONObject(raw) }.getOrNull()
      ?: return undoStatus("damaged")
    val snapshotId = undo.optString("snapshotId")
    val expiresAt = undo.optLong("expiresAt", -1)
    if (snapshotId.isBlank() || expiresAt < 0) return undoStatus("damaged", snapshotId, expiresAt)
    if (System.currentTimeMillis() >= expiresAt) {
      File(undo.optString("snapshot")).deleteRecursively()
      preferences.edit().remove(REPLACEMENT_UNDO).commit()
      return undoStatus("expired", snapshotId, expiresAt)
    }
    val snapshot = File(undo.optString("snapshot"))
    if (!snapshot.isDirectory) return undoStatus("unavailable", snapshotId, expiresAt)
    val valid = runCatching {
      verifySnapshot(snapshot)
      snapshotFingerprint(snapshot) == undo.getString("fingerprint")
    }.getOrDefault(false)
    return undoStatus(if (valid) "available" else "damaged", snapshotId, expiresAt)
  }

  private fun undoReplacement(snapshotId: String): com.facebook.react.bridge.WritableMap {
    recoverReplacementIfNeeded()
    val preferences = context.getSharedPreferences(REPLACEMENT_PREFERENCES, android.app.Activity.MODE_PRIVATE)
    if (preferences.getString(LAST_UNDONE_SNAPSHOT, null) == snapshotId) {
      return Arguments.createMap().apply { putBoolean("alreadyUndone", true) }
    }
    val status = replacementUndoStatus()
    if (status.getString("state") != "available" || status.getString("snapshotId") != snapshotId) {
      fail("UNDO_UNAVAILABLE", "The full replacement undo point is not available")
    }
    val undo = JSONObject(preferences.getString(REPLACEMENT_UNDO, null)!!)
    val snapshot = File(undo.getString("snapshot"))
    val database = File(undo.getString("database"))
    val mediaRoot = File(undo.getString("mediaRoot"))
    val operationId = UUID.randomUUID()
    val rollback = File(context.filesDir, "backup-replacement/undo-rollback-$operationId")
    val staged = File(context.filesDir, "backup-replacement/undo-staged-$operationId")
    if (!rollback.mkdirs() || !staged.mkdirs()) fail("STAGING_UNAVAILABLE", "Cannot stage undo rollback")
    try {
      copyFileVerified(database, File(rollback, "peacocknotes.db"), "SAFETY_SNAPSHOT_FAILED")
      copyDirectoryVerified(File(mediaRoot, "audio"), File(rollback, "audio"))
      copyDirectoryVerified(File(mediaRoot, "files"), File(rollback, "files"))
      val stagedDatabase = File(staged, "peacocknotes.db")
      copyFileVerified(database, stagedDatabase, "STAGING_UNAVAILABLE")
      restoreRecoverableDatabase(File(snapshot, "peacocknotes.db"), stagedDatabase)
      verifySnapshotGeneration(stagedDatabase, File(snapshot, "audio"), File(snapshot, "files"))
      val journal = JSONObject().put("database", database.path).put("mediaRoot", mediaRoot.path)
        .put("snapshot", rollback.path).put("staged", staged.path)
      if (!preferences.edit().putString(REPLACEMENT_JOURNAL, journal.toString()).commit()) {
        fail("UNDO_FAILED", "Cannot persist the undo commit boundary")
      }
      try {
        replaceFile(stagedDatabase, database)
        replaceDirectory(File(snapshot, "audio"), File(mediaRoot, "audio"), copy = true)
        replaceDirectory(File(snapshot, "files"), File(mediaRoot, "files"), copy = true)
        verifySnapshotGeneration(database, File(mediaRoot, "audio"), File(mediaRoot, "files"))
      } catch (error: Exception) {
        rollbackReplacement(journal)
        throw ArchiveException("UNDO_ROLLED_BACK", "Undo failed and replacement content was restored", error)
      }
      if (!preferences.edit().remove(REPLACEMENT_JOURNAL).remove(REPLACEMENT_UNDO)
          .putString(LAST_UNDONE_SNAPSHOT, snapshotId).commit()) {
        rollbackReplacement(journal)
        fail("UNDO_FAILED", "Undo completion could not be recorded")
      }
      snapshot.deleteRecursively()
      return Arguments.createMap().apply { putBoolean("alreadyUndone", false) }
    } finally {
      // A persisted journal owns the rollback generation. Keep it until startup
      // recovery has either restored it or removed the journal successfully.
      if (!preferences.contains(REPLACEMENT_JOURNAL)) rollback.deleteRecursively()
      staged.deleteRecursively()
    }
  }

  private fun restoreRecoverableDatabase(prior: File, staged: File) {
    val db = SQLiteDatabase.openDatabase(staged.path, null, SQLiteDatabase.OPEN_READWRITE)
    try {
      db.execSQL("ATTACH DATABASE ? AS prior", arrayOf(prior.path))
      db.beginTransaction()
      try {
        db.execSQL("PRAGMA foreign_keys=OFF")
        listOf("RecoveryProvenance", "NoteAudios", "NoteFiles", "Notes", "Folders").forEach { db.execSQL("DELETE FROM $it") }
        db.execSQL("DELETE FROM sqlite_sequence WHERE name IN ('Folders','Notes','NoteAudios','NoteFiles')")
        db.execSQL("INSERT INTO Folders SELECT * FROM prior.Folders")
        db.execSQL("INSERT INTO Notes SELECT * FROM prior.Notes")
        db.execSQL("INSERT INTO NoteAudios SELECT * FROM prior.NoteAudios")
        db.execSQL("INSERT INTO NoteFiles SELECT * FROM prior.NoteFiles")
        db.execSQL("INSERT INTO RecoveryProvenance SELECT * FROM prior.RecoveryProvenance")
        db.execSQL("UPDATE ContentMetadata SET revision=revision+1 WHERE id=1")
        db.setTransactionSuccessful()
      } finally { db.endTransaction() }
    } finally {
      runCatching { db.execSQL("DETACH DATABASE prior") }
      db.close()
    }
  }

  private fun undoStatus(state: String, snapshotId: String? = null, expiresAt: Long = -1) = Arguments.createMap().apply {
    putString("state", state)
    if (!snapshotId.isNullOrBlank()) putString("snapshotId", snapshotId) else putNull("snapshotId")
    if (expiresAt >= 0) putDouble("expiresAt", expiresAt.toDouble()) else putNull("expiresAt")
  }

  private fun verifySnapshot(snapshot: File) = verifySnapshotGeneration(
    File(snapshot, "peacocknotes.db"), File(snapshot, "audio"), File(snapshot, "files")
  )

  private fun verifySnapshotGeneration(database: File, audio: File, files: File) {
    val db = SQLiteDatabase.openDatabase(database.path, null, SQLiteDatabase.OPEN_READONLY)
    try {
      val integrity = db.rawQuery("PRAGMA integrity_check", null).use { it.moveToFirst() && it.getString(0) == "ok" }
      if (!integrity) fail("UNDO_DAMAGED", "Undo database is damaged")
      listOf("NoteAudios" to audio, "NoteFiles" to files).forEach { (table, root) ->
        db.rawQuery("SELECT uri FROM $table", null).use { cursor ->
          while (cursor.moveToNext()) if (!File(root, File(Uri.parse(cursor.getString(0)).path ?: "").name).isFile) {
            fail("UNDO_DAMAGED", "Undo media is missing")
          }
        }
      }
    } finally { db.close() }
  }

  private fun snapshotFingerprint(snapshot: File): String {
    val digest = MessageDigest.getInstance("SHA-256")
    snapshot.walkTopDown().filter { it.isFile }.sortedBy { it.relativeTo(snapshot).path }.forEach { file ->
      digest.update(file.relativeTo(snapshot).path.toByteArray(Charsets.UTF_8))
      FileInputStream(file).use { input ->
        val buffer = ByteArray(BUFFER_SIZE)
        while (true) { val count = input.read(buffer); if (count < 0) break; digest.update(buffer, 0, count) }
      }
    }
    return digest.digest().joinToString("") { "%02x".format(it) }
  }

  private fun recoverReplacementIfNeeded(): Boolean {
    val preferences = context.getSharedPreferences(REPLACEMENT_PREFERENCES, android.app.Activity.MODE_PRIVATE)
    val raw = preferences.getString(REPLACEMENT_JOURNAL, null) ?: return false
    val journal = JSONObject(raw)
    rollbackReplacement(journal)
    preferences.edit().remove(REPLACEMENT_JOURNAL).commit()
    return true
  }

  private fun rollbackReplacement(journal: JSONObject) {
    val database = File(journal.getString("database")); val mediaRoot = File(journal.getString("mediaRoot"))
    val snapshot = File(journal.getString("snapshot"))
    replaceFile(File(snapshot, "peacocknotes.db"), database, copy = true)
    replaceDirectory(File(snapshot, "audio"), File(mediaRoot, "audio"), copy = true)
    replaceDirectory(File(snapshot, "files"), File(mediaRoot, "files"), copy = true)
    val db = SQLiteDatabase.openDatabase(database.path, null, SQLiteDatabase.OPEN_READONLY)
    try {
      if (db.rawQuery("PRAGMA integrity_check", null).use { it.moveToFirst() && it.getString(0) == "ok" }.not()) fail("ROLLBACK_FAILED", "Safety snapshot database is invalid")
    } finally { db.close() }
  }

  private data class MediaRestrictions(val audioIds: Set<Long>, val fileIds: Set<Long>)

  private fun inspectCurrentMedia(db: SQLiteDatabase, mediaRoot: File): MediaRestrictions {
    fun invalidIds(table: String, directory: String): Set<Long> {
      val root = File(mediaRoot, directory)
      val rootPath = runCatching { root.canonicalPath }.getOrNull()
      val invalid = mutableSetOf<Long>()
      db.rawQuery("SELECT id,uri FROM $table", null).use { cursor ->
        while (cursor.moveToNext()) {
          val file = runCatching {
            val uri = Uri.parse(cursor.getString(1))
            if (uri.scheme != "file" || uri.path.isNullOrBlank()) null else File(uri.path!!)
          }.getOrNull()
          val safe = rootPath != null && file != null && runCatching {
            val path = file.canonicalPath
            path.startsWith("$rootPath${File.separator}") && file.isFile && file.canRead() &&
              FileInputStream(file).use { input ->
                val digest = sha256(input).hex
                !file.name.matches(Regex("^[0-9a-f]{64}$")) || digest == file.name
              }
          }.getOrDefault(false)
          if (!safe) invalid.add(cursor.getLong(0))
        }
      }
      return invalid
    }
    return MediaRestrictions(invalidIds("NoteAudios", "audio"), invalidIds("NoteFiles", "files"))
  }

  private fun applyMediaRestrictions(db: SQLiteDatabase, restrictions: MediaRestrictions) {
    fun remove(table: String, ids: Set<Long>) {
      if (ids.isNotEmpty()) db.execSQL("DELETE FROM $table WHERE id IN (${ids.joinToString(",") { "?" }})", ids.toTypedArray())
    }
    remove("NoteAudios", restrictions.audioIds)
    remove("NoteFiles", restrictions.fileIds)
  }

  private fun createRestrictedSnapshot(database: File, mediaRoot: File, snapshot: File): MediaRestrictions {
    val db = SQLiteDatabase.openDatabase(database.path, null, SQLiteDatabase.OPEN_READWRITE)
    try {
      val restrictions = inspectCurrentMedia(db, mediaRoot)
      db.beginTransaction()
      try {
        applyMediaRestrictions(db, restrictions)
        db.setTransactionSuccessful()
      } finally { db.endTransaction() }
      listOf("NoteAudios" to "audio", "NoteFiles" to "files").forEach { (table, directory) ->
        val destination = File(snapshot, directory).apply { mkdirs() }
        db.rawQuery("SELECT uri FROM $table", null).use { cursor ->
          while (cursor.moveToNext()) {
            val source = File(Uri.parse(cursor.getString(0)).path!!)
            copyFileVerified(source, File(destination, source.name), "SAFETY_SNAPSHOT_FAILED")
          }
        }
      }
      return restrictions
    } finally { db.close() }
  }

  private fun copyFileVerified(source: File, target: File, code: String) {
    target.parentFile?.mkdirs(); source.copyTo(target, overwrite = true)
    if (FileInputStream(source).use(::sha256) != FileInputStream(target).use(::sha256)) fail(code, "Copied file verification failed")
  }

  private fun copyDirectoryVerified(source: File, target: File) {
    if (!source.exists()) { target.mkdirs(); return }
    source.walkTopDown().filter { it.isFile }.forEach { file -> copyFileVerified(file, File(target, file.relativeTo(source).path), "SAFETY_SNAPSHOT_FAILED") }
  }

  private fun replaceFile(source: File, target: File, copy: Boolean = false) {
    target.delete(); target.parentFile?.mkdirs()
    if (copy) copyFileVerified(source, target, "ROLLBACK_FAILED")
    else if (!source.renameTo(target)) fail("COMMIT_INTERRUPTED", "Could not switch replacement database")
  }

  private fun replaceDirectory(source: File, target: File, copy: Boolean = false) {
    target.deleteRecursively(); target.parentFile?.mkdirs()
    if (copy) copyDirectoryVerified(source, target)
    else if (!source.renameTo(target)) fail("COMMIT_INTERRUPTED", "Could not switch replacement media")
  }

  private fun replacementResult(already: Boolean, count: Int, snapshotId: String, restrictedAudio: Int, restrictedFiles: Int) = Arguments.createMap().apply {
    putBoolean("alreadyCommitted", already); putInt("restoredNoteCount", count); putString("safetySnapshotId", snapshotId)
    putRecoveryRestriction(restrictedAudio, restrictedFiles)
  }

  private inline fun <T> SQLiteDatabase.useDatabase(block: (SQLiteDatabase) -> T): T = try { block(this) } finally { close() }

  private fun importReceiptExists(db: SQLiteDatabase, key: String): Boolean {
    return try { db.rawQuery("SELECT 1 FROM BackupImportReceipts WHERE operationKey=?", arrayOf(key)).use { it.moveToFirst() } } catch (_: Exception) { false }
  }

  private fun importReceiptResult(db: SQLiteDatabase, key: String): com.facebook.react.bridge.WritableMap? {
    return db.rawQuery("SELECT importedCount,recoveredCount,skippedCount,restrictedAudioCount,restrictedFileCount FROM BackupImportReceipts WHERE operationKey=?", arrayOf(key)).use {
      if (it.moveToFirst()) importResult(true, it.getInt(0), it.getInt(1), it.getInt(2), it.getInt(3), it.getInt(4)) else null
    }
  }

  private fun receiptRestrictions(db: SQLiteDatabase, key: String): Pair<Int, Int> =
    db.rawQuery("SELECT restrictedAudioCount,restrictedFileCount FROM BackupImportReceipts WHERE operationKey=?", arrayOf(key)).use {
      if (it.moveToFirst()) it.getInt(0) to it.getInt(1) else 0 to 0
    }

  private fun importResult(alreadyCommitted: Boolean, imported: Int, recovered: Int, skipped: Int = 0, restrictedAudio: Int = 0, restrictedFiles: Int = 0) = Arguments.createMap().apply {
    putBoolean("alreadyCommitted", alreadyCommitted); putInt("importedCount", imported); putInt("recoveredCount", recovered); putInt("skippedCount", skipped)
    putRecoveryRestriction(restrictedAudio, restrictedFiles)
  }

  private fun com.facebook.react.bridge.WritableMap.putRecoveryRestriction(audio: Int, files: Int) {
    putInt("restrictedAudioCount", audio); putInt("restrictedFileCount", files)
    putBoolean("recoveryComplete", audio == 0 && files == 0)
  }

  private fun ensureImportedFolder(db: SQLiteDatabase, portableId: String, name: String, createdAt: String, sortOrder: Int): Long {
    db.rawQuery("SELECT id FROM Folders WHERE portableId=?", arrayOf(portableId)).use { if (it.moveToFirst()) return it.getLong(0) }
    val statement = db.compileStatement("INSERT INTO Folders(portableId,name,createdAt,sortOrder) VALUES(?,?,?,?)")
    statement.bindString(1, portableId); statement.bindString(2, name); statement.bindString(3, createdAt); statement.bindLong(4, sortOrder.toLong())
    return statement.executeInsert()
  }

  private fun mediaMatches(source: SQLiteDatabase, live: SQLiteDatabase, sourceNoteId: String, liveNoteId: Long): Boolean {
    return listOf("NoteAudios", "NoteFiles").all { table ->
      val audio = table == "NoteAudios"
      val archivedColumns = if (audio) "portableId,mediaPath,displayName,groupId,segmentIndex,orderIndex,createdAt" else "portableId,mediaPath,displayName,mimeType,orderIndex,createdAt"
      val currentColumns = if (audio) "portableId,uri,displayName,groupId,segmentIndex,orderIndex,createdAt" else "portableId,uri,displayName,mimeType,orderIndex,createdAt"
      source.rawQuery("SELECT $archivedColumns FROM $table WHERE notePortableId=? ORDER BY portableId", arrayOf(sourceNoteId)).use { archived ->
        live.rawQuery("SELECT $currentColumns FROM $table WHERE noteId=? ORDER BY portableId", arrayOf(liveNoteId.toString())).use { current ->
          while (true) {
            val hasArchived = archived.moveToNext()
            val hasCurrent = current.moveToNext()
            if (hasArchived != hasCurrent) return@all false
            if (!hasArchived) return@all true
            if (archived.getString(0) != current.getString(0)) return@all false
            val expectedHash = archived.getString(1).substringAfterLast('/')
            val currentHash = runCatching { open(current.getString(1)).use(::sha256).hex }.getOrNull()
            if (currentHash != expectedHash) return@all false
            for (index in 2 until archived.columnCount) {
              if (!cursorValuesEqual(archived, current, index)) return@all false
            }
          }
          @Suppress("UNREACHABLE_CODE") true
        }
      }
    }
  }

  private fun cursorValuesEqual(first: Cursor, second: Cursor, index: Int): Boolean {
    if (first.isNull(index) || second.isNull(index)) return first.isNull(index) && second.isNull(index)
    return when (first.getType(index)) {
      Cursor.FIELD_TYPE_INTEGER -> second.getType(index) == Cursor.FIELD_TYPE_INTEGER && first.getLong(index) == second.getLong(index)
      Cursor.FIELD_TYPE_FLOAT -> second.getType(index) == Cursor.FIELD_TYPE_FLOAT && first.getDouble(index) == second.getDouble(index)
      Cursor.FIELD_TYPE_BLOB -> second.getType(index) == Cursor.FIELD_TYPE_BLOB && first.getBlob(index).contentEquals(second.getBlob(index))
      else -> first.getString(index) == second.getString(index)
    }
  }

  private fun mediaKey(table: String, path: String) = "$table:$path"

  private fun copyImportedMedia(source: SQLiteDatabase, live: SQLiteDatabase, table: String, sourceNoteId: String, liveNoteId: Long, mediaUris: Map<String, String>, recovered: Boolean) {
    val audio = table == "NoteAudios"
    val columns = if (audio) "portableId,mediaPath,displayName,groupId,segmentIndex,orderIndex,createdAt" else "portableId,mediaPath,displayName,mimeType,orderIndex,createdAt"
    source.rawQuery("SELECT $columns FROM $table WHERE notePortableId=? ORDER BY orderIndex", arrayOf(sourceNoteId)).use { cursor ->
      while (cursor.moveToNext()) {
        val portableId = if (recovered) UUID.randomUUID().toString() else cursor.getString(0)
        val uri = mediaUris[mediaKey(table, cursor.getString(1))] ?: fail("MISSING_MEDIA", "Validated media was not staged")
        val sql = if (audio) "INSERT INTO NoteAudios(portableId,noteId,uri,displayName,groupId,segmentIndex,orderIndex,createdAt) VALUES(?,?,?,?,?,?,?,?)" else "INSERT INTO NoteFiles(portableId,noteId,uri,displayName,mimeType,orderIndex,createdAt) VALUES(?,?,?,?,?,?,?)"
        val statement = live.compileStatement(sql); statement.bindString(1, portableId); statement.bindLong(2, liveNoteId); statement.bindString(3, uri)
        for (index in 2 until cursor.columnCount) {
          val bindIndex = index + 2
          if (cursor.isNull(index)) statement.bindNull(bindIndex) else if (cursor.getType(index) == Cursor.FIELD_TYPE_INTEGER) statement.bindLong(bindIndex, cursor.getLong(index)) else statement.bindString(bindIndex, cursor.getString(index))
        }
        statement.executeInsert()
      }
    }
  }

  private fun sanitizeDatabase(source: File, target: File, media: Map<String, HashedMedia>) {
    val input = SQLiteDatabase.openDatabase(source.path, null, SQLiteDatabase.OPEN_READONLY)
    val output = SQLiteDatabase.openOrCreateDatabase(target, null)
    try {
      output.execSQL("PRAGMA foreign_keys=ON")
      output.execSQL("PRAGMA user_version=$DATABASE_VERSION")
      output.execSQL("CREATE TABLE Folders(portableId TEXT PRIMARY KEY,name TEXT NOT NULL,createdAt TEXT NOT NULL,sortOrder INTEGER NOT NULL)")
      output.execSQL("CREATE TABLE Notes(portableId TEXT PRIMARY KEY,folderPortableId TEXT NOT NULL,title TEXT NOT NULL,content TEXT,createdAt TEXT NOT NULL,updatedAt TEXT NOT NULL,sortOrder INTEGER NOT NULL,FOREIGN KEY(folderPortableId) REFERENCES Folders(portableId))")
      output.execSQL("CREATE TABLE NoteAudios(portableId TEXT PRIMARY KEY,notePortableId TEXT NOT NULL,mediaPath TEXT NOT NULL,displayName TEXT,groupId TEXT,segmentIndex INTEGER,orderIndex INTEGER NOT NULL,createdAt TEXT NOT NULL,FOREIGN KEY(notePortableId) REFERENCES Notes(portableId))")
      output.execSQL("CREATE TABLE NoteFiles(portableId TEXT PRIMARY KEY,notePortableId TEXT NOT NULL,mediaPath TEXT NOT NULL,displayName TEXT,mimeType TEXT,orderIndex INTEGER NOT NULL,createdAt TEXT NOT NULL,FOREIGN KEY(notePortableId) REFERENCES Notes(portableId))")
      output.beginTransaction()
      copyRows(input, output, "SELECT portableId,name,createdAt,sortOrder FROM Folders", "INSERT INTO Folders VALUES(?,?,?,?)", 4)
      copyRows(input, output, "SELECT n.portableId,f.portableId,n.title,n.content,n.createdAt,n.updatedAt,n.sortOrder FROM Notes n JOIN Folders f ON f.id=n.folderId", "INSERT INTO Notes VALUES(?,?,?,?,?,?,?)", 7)
      copyMediaRows(input, output, media, true)
      copyMediaRows(input, output, media, false)
      output.setTransactionSuccessful()
    } catch (error: Exception) {
      fail("DATABASE_SANITIZATION_FAILED", "Recoverable database content is invalid", error)
    } finally {
      if (output.inTransaction()) output.endTransaction()
      input.close(); output.close()
    }
  }

  private fun copyRows(input: SQLiteDatabase, output: SQLiteDatabase, query: String, insert: String, count: Int) {
    input.rawQuery(query, null).use { cursor ->
      val statement = output.compileStatement(insert)
      while (cursor.moveToNext()) {
        statement.clearBindings()
        for (index in 0 until count) bind(statement, index + 1, cursor, index)
        statement.executeInsert()
      }
    }
  }

  private fun copyMediaRows(input: SQLiteDatabase, output: SQLiteDatabase, media: Map<String, HashedMedia>, audio: Boolean) {
    val table = if (audio) "NoteAudios" else "NoteFiles"
    val extras = if (audio) "m.displayName,m.groupId,m.segmentIndex,m.orderIndex,m.createdAt" else "m.displayName,m.mimeType,m.orderIndex,m.createdAt"
    val placeholders = if (audio) 8 else 7
    val insert = "INSERT INTO $table VALUES(${List(placeholders) { "?" }.joinToString(",")})"
    input.rawQuery("SELECT m.portableId,n.portableId,$extras FROM $table m JOIN Notes n ON n.id=m.noteId", null).use { cursor ->
      val statement = output.compileStatement(insert)
      while (cursor.moveToNext()) {
        val id = cursor.getString(0)
        requireUuid(id)
        val item = media[id] ?: fail("MISSING_MEDIA", "No captured media supplied for $id")
        if ((item.source.kind == "audio") != audio) fail("MEDIA_KIND_MISMATCH", "Media kind mismatch for $id")
        statement.clearBindings()
        statement.bindString(1, id)
        statement.bindString(2, cursor.getString(1))
        statement.bindString(3, item.path)
        for (index in 2 until cursor.columnCount) bind(statement, index + 2, cursor, index)
        statement.executeInsert()
      }
    }
  }

  private fun validateDatabase(file: File, inventory: Map<String, Digest>, limits: Limits) {
    if (file.length() > limits.maxDatabaseBytes) fail("DATABASE_LIMIT_EXCEEDED", "Database exceeds limit")
    val db = SQLiteDatabase.openDatabase(file.path, null, SQLiteDatabase.OPEN_READONLY)
    try {
      val integrity = db.rawQuery("PRAGMA integrity_check", null).use { if (it.moveToFirst()) it.getString(0) else "failed" }
      if (integrity != "ok") fail("INVALID_DATABASE", "SQLite integrity check failed")
      val databaseVersion = db.rawQuery("PRAGMA user_version", null).use { if (it.moveToFirst()) it.getInt(0) else -1 }
      if (databaseVersion != DATABASE_VERSION) fail("UNSUPPORTED_DATABASE_VERSION", "SQLite database version does not match manifest")
      val seen = mutableSetOf<String>()
      var entityCount = 0
      listOf("Folders", "Notes", "NoteAudios", "NoteFiles").forEach { table ->
        val objectType = db.rawQuery("SELECT type FROM sqlite_master WHERE name=?", arrayOf(table)).use {
          if (it.moveToFirst()) it.getString(0) else null
        }
        if (objectType != "table") fail("INVALID_DATABASE", "$table must be a concrete table")
        db.rawQuery("SELECT portableId FROM $table", null).use { cursor ->
          while (cursor.moveToNext()) {
            entityCount++
            if (entityCount > limits.maxEntries) fail("ENTRY_LIMIT_EXCEEDED", "Database has too many entities")
            val id = requireUuid(cursor.getString(0))
            if (!seen.add(id.lowercase(Locale.ROOT))) fail("DUPLICATE_IDENTITY", "Portable identity occurs more than once: $id")
          }
        }
      }
      val fkErrors = db.rawQuery("PRAGMA foreign_key_check", null).use { it.count }
      if (fkErrors != 0) fail("BROKEN_REFERENCE", "Database contains broken entity references")
      val orphanedNotes = scalarCount(db, "SELECT COUNT(*) FROM Notes n WHERE NOT EXISTS (SELECT 1 FROM Folders f WHERE f.portableId=n.folderPortableId)")
      val orphanedAudio = scalarCount(db, "SELECT COUNT(*) FROM NoteAudios a WHERE NOT EXISTS (SELECT 1 FROM Notes n WHERE n.portableId=a.notePortableId)")
      val orphanedFiles = scalarCount(db, "SELECT COUNT(*) FROM NoteFiles f WHERE NOT EXISTS (SELECT 1 FROM Notes n WHERE n.portableId=f.notePortableId)")
      if (orphanedNotes != 0L || orphanedAudio != 0L || orphanedFiles != 0L) fail("BROKEN_REFERENCE", "Database contains broken entity references")
      var mediaCount = 0
      var mediaBytes = 0L
      listOf("NoteAudios", "NoteFiles").forEach { table ->
        db.rawQuery("SELECT mediaPath FROM $table", null).use { cursor ->
          while (cursor.moveToNext()) {
            val path = safePath(cursor.getString(0))
            val item = inventory[path] ?: fail("MISSING_MEDIA", "Referenced media is absent: $path")
            if (!path.matches(Regex("media/sha256/[0-9a-f]{64}")) || path.substringAfterLast('/') != item.hex) {
              fail("INVALID_MEDIA_PATH", "Media is not content-addressed: $path")
            }
            mediaCount++
            if (mediaCount > limits.maxMediaItems) fail("MEDIA_LIMIT_EXCEEDED", "Too many media references")
            mediaBytes = checkedAdd(mediaBytes, item.bytes, limits.maxMediaBytes)
          }
        }
      }
    } catch (error: ArchiveException) { throw error }
    catch (error: Exception) { fail("INVALID_DATABASE", "Sanitized database contract is invalid", error) }
    finally { db.close() }
  }

  private fun manifest(createdAt: String, revision: Long, inventory: Map<String, Digest>, mediaItems: Int) = JSONObject().apply {
    put("formatVersion", FORMAT_VERSION); put("databaseVersion", DATABASE_VERSION)
    put("createdAt", createdAt); put("contentRevision", revision); put("mediaItems", mediaItems)
    put("inventory", JSONArray().apply { inventory.forEach { (path, digest) -> put(JSONObject().put("path", path).put("sha256", digest.hex).put("size", digest.bytes)) } })
  }

  private fun parseInventory(manifest: JSONObject, limits: Limits): LinkedHashMap<String, Digest> {
    val array = manifest.optJSONArray("inventory") ?: fail("MALFORMED_MANIFEST", "Inventory is missing")
    if (array.length() > limits.maxEntries - 1) fail("ENTRY_LIMIT_EXCEEDED", "Inventory has too many entries")
    val result = linkedMapOf<String, Digest>()
    var mediaItems = 0
    var mediaBytes = 0L
    for (index in 0 until array.length()) {
      val item = array.optJSONObject(index) ?: fail("MALFORMED_MANIFEST", "Invalid inventory item")
      val path = safePath(item.optString("path"))
      val hash = item.optString("sha256")
      val size = item.optLong("size", -1)
      if (!hash.matches(Regex("[0-9a-f]{64}")) || size < 0) fail("MALFORMED_MANIFEST", "Invalid inventory digest")
      if (result.keys.any { portableIdentity(it) == portableIdentity(path) }) fail("DUPLICATE_PATH", "Duplicate inventory path")
      result[path] = Digest(hash, size)
      if (path.startsWith("media/")) { mediaItems++; mediaBytes = checkedAdd(mediaBytes, size, limits.maxMediaBytes) }
    }
    if (!result.containsKey(DATABASE_PATH)) fail("MISSING_DATABASE", "Database is missing from inventory")
    if (mediaItems > limits.maxMediaItems) fail("MEDIA_LIMIT_EXCEEDED", "Too many media entries")
    if (manifest.optInt("mediaItems", -1) != mediaItems) fail("INVENTORY_MISMATCH", "Media count differs from manifest")
    return result
  }

  private fun enforceManifestVersion(manifest: JSONObject) {
    if (manifest.optInt("formatVersion", -1) != FORMAT_VERSION) fail("UNSUPPORTED_FORMAT_VERSION", "Unsupported archive format version")
    if (manifest.optInt("databaseVersion", -1) != DATABASE_VERSION) fail("UNSUPPORTED_DATABASE_VERSION", "Unsupported database version")
    if (!manifest.has("createdAt") || manifest.optLong("contentRevision", -1) < 0) fail("MALFORMED_MANIFEST", "Required manifest metadata is missing")
  }

  private fun parseMedia(array: ReadableArray): List<MediaSource> = (0 until array.size()).map { index ->
    val item = array.getMap(index) ?: fail("INVALID_REQUEST", "Invalid media item")
    val id = requireUuid(requiredString(item, "portableId"))
    val kind = requiredString(item, "kind")
    if (kind != "audio" && kind != "file") fail("INVALID_REQUEST", "Invalid media kind")
    MediaSource(id, requiredString(item, "sourceUri"), kind)
  }

  private fun summary(manifest: JSONObject, archive: Digest, expanded: Long) = Arguments.createMap().apply {
    putInt("formatVersion", manifest.getInt("formatVersion")); putInt("databaseVersion", manifest.getInt("databaseVersion"))
    putString("createdAt", manifest.getString("createdAt")); putDouble("contentRevision", manifest.getLong("contentRevision").toDouble())
    putString("archiveSha256", archive.hex); putDouble("archiveBytes", archive.bytes.toDouble()); putDouble("expandedBytes", expanded.toDouble())
    putInt("mediaItems", manifest.getInt("mediaItems")); putArray("inventory", Arguments.createArray().apply {
      val items = manifest.getJSONArray("inventory")
      for (index in 0 until items.length()) { val item = items.getJSONObject(index); pushMap(Arguments.createMap().apply { putString("path", item.getString("path")); putString("sha256", item.getString("sha256")); putDouble("size", item.getLong("size").toDouble()) }) }
    })
  }

  private fun putFile(zip: ZipOutputStream, path: String, file: File) = FileInputStream(file).use { putStream(zip, path, it) }
  private fun putBytes(zip: ZipOutputStream, path: String, bytes: ByteArray) = bytes.inputStream().use { putStream(zip, path, it) }
  private fun putStream(zip: ZipOutputStream, path: String, input: InputStream) {
    zip.putNextEntry(ZipParameters().apply { fileNameInZip = path; compressionMethod = CompressionMethod.DEFLATE })
    input.copyTo(zip, BUFFER_SIZE); zip.closeEntry()
  }

  private fun readEntryBounded(zip: ZipFile, path: String, limit: Long): ByteArray {
    val header = zip.getFileHeader(path) ?: fail("MISSING_MANIFEST", "Manifest is missing")
    if (header.uncompressedSize > limit) fail("MANIFEST_LIMIT_EXCEEDED", "Manifest exceeds limit")
    return zip.getInputStream(header).use { input ->
      val output = java.io.ByteArrayOutputStream()
      copyBounded(input, output, limit); output.toByteArray()
    }
  }

  private fun materialize(uri: String, target: File, limit: Long): File { open(uri).use { input -> FileOutputStream(target).use { copyBounded(input, it, limit) } }; return target }
  private fun materializeDigest(uri: String, target: File, limit: Long): Digest = open(uri).use { input -> FileOutputStream(target).use { copyAndHash(input, it, limit, null) } }
  private fun copyToUri(source: File, uri: String) { FileInputStream(source).use { input -> openOutput(uri).use { output -> input.copyTo(output, BUFFER_SIZE) } } }
  private fun open(uri: String): InputStream =
    (if (uri.startsWith("content:")) context.contentResolver.openInputStream(Uri.parse(uri)) else FileInputStream(fileFromUri(uri)))
      ?: fail("SOURCE_UNAVAILABLE", "Cannot open source URI")
  private fun openOutput(uri: String): OutputStream =
    (if (uri.startsWith("content:")) context.contentResolver.openOutputStream(Uri.parse(uri), "wt") else FileOutputStream(fileFromUri(uri)))
      ?: fail("DESTINATION_UNAVAILABLE", "Cannot open destination URI")
  private fun fileFromUri(uri: String): File { val parsed = Uri.parse(uri); if (parsed.scheme != null && parsed.scheme != "file") fail("INVALID_URI", "Expected a file URI"); return File(parsed.path ?: uri) }

  private fun sha256(input: InputStream): Digest { val sink = object : OutputStream() { override fun write(b: Int) = Unit; override fun write(b: ByteArray, off: Int, len: Int) = Unit }; return copyAndHash(input, sink, Long.MAX_VALUE, null) }
  private fun copyAndHash(input: InputStream, output: OutputStream, limit: Long, exact: Long?): Digest {
    val digest = MessageDigest.getInstance("SHA-256"); val buffer = ByteArray(BUFFER_SIZE); var total = 0L
    while (true) { val count = input.read(buffer); if (count < 0) break; total = checkedAdd(total, count.toLong(), limit); output.write(buffer, 0, count); digest.update(buffer, 0, count) }
    if (exact != null && total != exact) fail("SIZE_MISMATCH", "Entry size differs from inventory")
    return Digest(digest.digest().joinToString("") { "%02x".format(it) }, total)
  }
  private fun copyBounded(input: InputStream, output: OutputStream, limit: Long) { val buffer = ByteArray(BUFFER_SIZE); var total = 0L; while (true) { val count = input.read(buffer); if (count < 0) return; total = checkedAdd(total, count.toLong(), limit); output.write(buffer, 0, count) } }
  private fun checkedAdd(current: Long, addition: Long, limit: Long): Long { if (addition < 0 || current > limit - addition) fail("EXPANSION_LIMIT_EXCEEDED", "Archive exceeds configured limit"); return current + addition }
  private fun ensureSpace(directory: File, required: Long) { if (StatFs(directory.absolutePath).availableBytes < required) fail("INSUFFICIENT_STORAGE", "Insufficient available storage for staged archive operation") }
  private fun newWorkDirectory(label: String): File = File(context.cacheDir, "archive-$label-${UUID.randomUUID()}").also { if (!it.mkdirs()) fail("STAGING_UNAVAILABLE", "Cannot create staging directory") }
  private fun safePath(raw: String): String { if (raw.isBlank() || raw.startsWith('/') || raw.startsWith('\\') || raw.contains('\\') || raw.contains('\u0000')) fail("UNSAFE_PATH", "Unsafe archive path"); val parts = raw.split('/'); if (parts.any { it.isBlank() || it == "." || it == ".." }) fail("UNSAFE_PATH", "Unsafe archive path"); return raw }
  private fun portableIdentity(path: String) = Normalizer.normalize(path, Normalizer.Form.NFC).lowercase(Locale.ROOT)
  private fun requireUuid(value: String): String { val normalized = value.lowercase(Locale.ROOT); if (!normalized.matches(Regex("[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}"))) fail("INVALID_PORTABLE_IDENTITY", "Invalid UUIDv4 portable identity"); return normalized }
  private fun requiredString(map: ReadableMap, key: String): String = if (map.hasKey(key) && !map.isNull(key)) map.getString(key)?.takeIf { it.isNotBlank() } ?: fail("INVALID_REQUEST", "$key is required") else fail("INVALID_REQUEST", "$key is required")
  private fun requiredNonNegativeLong(map: ReadableMap, key: String): Long { if (!map.hasKey(key) || map.isNull(key)) fail("INVALID_REQUEST", "$key is required"); val value = map.getDouble(key); if (!value.isFinite() || value < 0 || value % 1.0 != 0.0 || value > 9_007_199_254_740_991.0) fail("INVALID_REQUEST", "$key must be a non-negative safe integer"); return value.toLong() }
  private fun bind(statement: android.database.sqlite.SQLiteStatement, bindIndex: Int, cursor: Cursor, column: Int) { when (cursor.getType(column)) { Cursor.FIELD_TYPE_NULL -> statement.bindNull(bindIndex); Cursor.FIELD_TYPE_INTEGER -> statement.bindLong(bindIndex, cursor.getLong(column)); Cursor.FIELD_TYPE_FLOAT -> statement.bindDouble(bindIndex, cursor.getDouble(column)); Cursor.FIELD_TYPE_BLOB -> statement.bindBlob(bindIndex, cursor.getBlob(column)); else -> statement.bindString(bindIndex, cursor.getString(column)) } }
  private fun scalarCount(db: SQLiteDatabase, query: String): Long = db.rawQuery(query, null).use { if (it.moveToFirst()) it.getLong(0) else 0L }
  private fun ReadableMap.optionalString(key: String): String? = if (hasKey(key) && !isNull(key)) getString(key) else null
  private fun errorCode(error: Throwable) = (error as? ArchiveException)?.code ?: "ARCHIVE_OPERATION_FAILED"
  private fun fail(code: String, message: String, cause: Throwable? = null): Nothing = throw ArchiveException(code, message, cause)

  private data class MediaSource(val portableId: String, val uri: String, val kind: String)
  private data class HashedMedia(val source: MediaSource, val hash: String, val size: Long) { val path = "media/sha256/$hash" }
  private data class Digest(val hex: String, val bytes: Long)
  private class ArchiveException(val code: String, message: String, cause: Throwable? = null) : Exception(message, cause)
  private data class Limits(val maxArchiveBytes: Long, val maxExpandedBytes: Long, val maxDatabaseBytes: Long, val maxMediaBytes: Long, val maxMediaItemBytes: Long, val maxMediaItems: Int, val maxEntries: Int) {
    companion object {
      fun from(map: ReadableMap?) = Limits(value(map, "maxArchiveBytes", 2L*1024*1024*1024), value(map, "maxExpandedBytes", 4L*1024*1024*1024), value(map, "maxDatabaseBytes", 256L*1024*1024), value(map, "maxMediaBytes", 3L*1024*1024*1024), value(map, "maxMediaItemBytes", 512L*1024*1024), intValue(map, "maxMediaItems", 10_000), intValue(map, "maxEntries", 10_010))
      private fun value(map: ReadableMap?, key: String, fallback: Long): Long { val number = if (map != null && map.hasKey(key) && !map.isNull(key)) map.getDouble(key) else return fallback; if (!number.isFinite() || number <= 0 || number > Long.MAX_VALUE.toDouble()) throw ArchiveException("INVALID_LIMIT", "$key is invalid"); return number.toLong() }
      private fun intValue(map: ReadableMap?, key: String, fallback: Int): Int { val value = value(map, key, fallback.toLong()); if (value > Int.MAX_VALUE) throw ArchiveException("INVALID_LIMIT", "$key is invalid"); return value.toInt() }
    }
  }
}
