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
    private val ARCHIVE_NAME = Regex("^peacock-notes-\\d{4}-\\d{2}-\\d{2}T\\d{2}-\\d{2}-\\d{2}-\\d{3}Z\\.pnbak$")
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
      return summary(manifest, archiveDigest, expanded)
    } finally {
      archive.delete()
      if (ownsWork) work.deleteRecursively()
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
