package com.roy.peacocknotes

import android.database.Cursor
import android.database.sqlite.SQLiteDatabase
import android.net.Uri
import android.os.StatFs
import android.util.Log
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
import java.security.DigestOutputStream
import java.text.Normalizer
import java.time.Instant
import java.util.Locale
import java.util.UUID
import java.util.concurrent.Executors

enum class ArchiveValidationMode {
  STAGE,
  VERIFY_ONLY,
}

data class ArchiveValidationDigest(val sha256: String, val bytes: Long)

class ArchiveValidationException(val code: String, message: String, cause: Throwable? = null) : Exception(message, cause)

fun validateArchiveEntry(
  input: InputStream,
  expectedSha256: String,
  expectedBytes: Long,
  mode: ArchiveValidationMode,
  output: OutputStream?,
  onBytes: ((Long) -> Unit)? = null,
): ArchiveValidationDigest {
  val destination = if (mode == ArchiveValidationMode.STAGE) {
    output ?: throw ArchiveValidationException("STAGING_UNAVAILABLE", "A staging output is required")
  } else {
    object : OutputStream() {
      override fun write(value: Int) = Unit
      override fun write(buffer: ByteArray, offset: Int, length: Int) = Unit
    }
  }
  val digest = MessageDigest.getInstance("SHA-256")
  val buffer = ByteArray(64 * 1024)
  var total = 0L
  try {
    while (true) {
      val count = input.read(buffer)
      if (count < 0) break
      if (count.toLong() > expectedBytes - total) throw ArchiveValidationException("EXPANSION_LIMIT_EXCEEDED", "Entry exceeds declared size")
      total += count
      destination.write(buffer, 0, count)
      digest.update(buffer, 0, count)
      onBytes?.invoke(count.toLong())
    }
  } catch (error: ArchiveValidationException) {
    throw error
  } catch (error: Exception) {
    throw ArchiveValidationException("MALFORMED_ARCHIVE", "Archive media could not be read", error)
  }
  val actual = digest.digest().joinToString("") { "%02x".format(it) }
  if (total != expectedBytes) throw ArchiveValidationException("SIZE_MISMATCH", "Entry size differs from inventory")
  if (actual != expectedSha256) throw ArchiveValidationException("HASH_MISMATCH", "Hash differs from inventory")
  return ArchiveValidationDigest(actual, total)
}

class ArchiveModule(private val context: ReactApplicationContext) : ReactContextBaseJavaModule(context) {
  companion object {
    private const val FORMAT_VERSION = 1
    private const val DATABASE_VERSION = 2
    private val SUPPORTED_DATABASE_VERSIONS = setOf(1, 2)
    private const val MANIFEST_PATH = "manifest.json"
    private const val DATABASE_PATH = "database/content.sqlite"
    private const val BUFFER_SIZE = 64 * 1024
    private const val MAX_MANIFEST_BYTES = 2L * 1024 * 1024
    private const val FOLDER_PREFERENCES = BackupFolderModule.PREFERENCES
    private const val FOLDER_URI = BackupFolderModule.FOLDER_URI
    private const val REPLACEMENT_PREFERENCES = "peacock_notes_full_replacement"
    private const val REPLACEMENT_JOURNAL = "journal"
    private const val REPLACEMENT_UNDO = "undo"
    private const val LAST_UNDONE_SNAPSHOT = "last_undone_snapshot"
    private const val SCAN_CACHE_PREFERENCES = "peacock_notes_backup_scan_cache"
    private const val SCAN_CACHE_KEY = "archives"
    private const val UNDO_WINDOW_MILLIS = 168L * 60 * 60 * 1000
    private val ARCHIVE_NAME = Regex("^peacock-notes-\\d{4}-\\d{2}-\\d{2}T\\d{2}-\\d{2}-\\d{2}-\\d{3}Z(?:-[a-zA-Z0-9_-]+)?\\.pnbak$")
    private val INCOMPATIBLE_CODES = setOf("UNSUPPORTED_FORMAT_VERSION", "UNSUPPORTED_DATABASE_VERSION")
    private val UNCERTAIN_CODES = setOf(
      "SOURCE_UNAVAILABLE", "STAGING_UNAVAILABLE", "INSUFFICIENT_STORAGE", "ARCHIVE_OPERATION_FAILED",
      "DRIVE_AUTH_REQUIRED", "DRIVE_API_FORBIDDEN", "DRIVE_RATE_LIMITED", "DRIVE_UNAVAILABLE",
      "DRIVE_API_FAILED", "DRIVE_LIST_INCOMPLETE",
    )
  }

  private val executor = Executors.newSingleThreadExecutor()
  private var progress = BackupProgressReporter(null, null)

  private fun <T> withProgress(request: ReadableMap, work: () -> T): T {
    progress = progressReporter(request)
    try { return work() } finally { progress = BackupProgressReporter(null, null) }
  }

  override fun getName() = "Archive"

  @ReactMethod
  fun pinMedia(request: ReadableMap, promise: Promise) = executor.execute {
    runCatching { withProgress(request) { pin(request) } }
      .onSuccess(promise::resolve)
      .onFailure { promise.reject(errorCode(it), it.message, it) }
  }

  @ReactMethod
  fun createArchive(request: ReadableMap, promise: Promise) = executor.execute {
    runCatching { withProgress(request) { create(request) } }
      .onSuccess(promise::resolve)
      .onFailure { promise.reject(errorCode(it), it.message, it) }
  }

  @ReactMethod
  fun validateArchive(request: ReadableMap, promise: Promise) = executor.execute {
    runCatching { withProgress(request) { validate(request) } }
      .onSuccess(promise::resolve)
      .onFailure { promise.reject(errorCode(it), it.message, it) }
  }

  @ReactMethod
  fun scanConnectedFolder(promise: Promise) = executor.execute {
    runCatching { scanFolder(deepValidation = false) }
      .onSuccess(promise::resolve)
      .onFailure {
        Log.e("BackupRuntime", "[DEBUG-BR-SCAN] failed deep=false code=${errorCode(it)} message=${it.message}", it)
        promise.reject(errorCode(it), it.message, it)
      }
  }

  /** Explicit refresh used by retention/recovery, where every archive must be trusted. */
  @ReactMethod
  fun scanConnectedFolderDeep(promise: Promise) = executor.execute {
    runCatching { scanFolder(deepValidation = true) }
      .onSuccess(promise::resolve)
      .onFailure {
        Log.e("BackupRuntime", "[DEBUG-BR-SCAN] failed deep=true code=${errorCode(it)} message=${it.message}", it)
        promise.reject(errorCode(it), it.message, it)
      }
  }

  @ReactMethod
  fun deleteArchives(request: ReadableMap, promise: Promise) = executor.execute {
    runCatching { deleteArchives(request) }
      .onSuccess(promise::resolve)
      .onFailure { promise.reject(errorCode(it), it.message, it) }
  }

  @ReactMethod
  fun applyManagedRetention(request: ReadableMap, promise: Promise) = executor.execute {
    runCatching { withProgress(request) { applyRetention() } }
      .onSuccess(promise::resolve)
      .onFailure { promise.reject(errorCode(it), it.message, it) }
  }

  @ReactMethod
  fun previewImport(request: ReadableMap, promise: Promise) = executor.execute {
    runCatching { withProgress(request) { preview(request) } }
      .onSuccess(promise::resolve)
      .onFailure { promise.reject(errorCode(it), it.message, it) }
  }

  @ReactMethod
  fun commitSelectiveImport(request: ReadableMap, promise: Promise) = executor.execute {
    runCatching { withProgress(request) { commitImport(request) } }
      .onSuccess(promise::resolve)
      .onFailure {
        Log.e("BackupRuntime", "[DEBUG-BR-IMPORT] commit failed code=${errorCode(it)} message=${it.message}", it)
        promise.reject(errorCode(it), it.message, it)
      }
  }

  @ReactMethod
  fun commitFullReplacement(request: ReadableMap, promise: Promise) = executor.execute {
    runCatching { withProgress(request) { commitReplacement(request) } }
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
  fun getImportReceiptResult(request: ReadableMap, promise: Promise) = executor.execute {
    runCatching {
      val db = SQLiteDatabase.openDatabase(fileFromUri(requiredString(request, "databaseUri")).path, null, SQLiteDatabase.OPEN_READONLY)
      try {
        importReceiptResult(db, requiredString(request, "operationKey"))
      } finally { db.close() }
    }.onSuccess(promise::resolve).onFailure { promise.reject(errorCode(it), it.message, it) }
  }

  private fun scanFolder(
    deepValidation: Boolean,
    reuseTrustedCache: Boolean = false,
  ): com.facebook.react.bridge.WritableMap {
    val startedAt = android.os.SystemClock.elapsedRealtime()
    val folderUri = context.getSharedPreferences(FOLDER_PREFERENCES, android.app.Activity.MODE_PRIVATE).getString(FOLDER_URI, null)
      ?: fail("FOLDER_NOT_CONNECTED", "Google Drive is not connected")
    val folderId = DriveClient.idFromUri(folderUri) ?: fail("FOLDER_NOT_CONNECTED", "Google Drive connection is invalid")
    val drive = DriveClient(context)
    val listed = drive.list(folderId).filter { archive -> ARCHIVE_NAME.matches(archive.name) }
    Log.i("BackupRuntime", "[DEBUG-BR-SCAN] listed folder=$folderId candidates=${listed.size}")
    val cached = loadScanCache(folderId)
    Log.i("BackupRuntime", "[DEBUG-BR-SCAN] cache_loaded folder=$folderId entries=${cached.size}")
    val nextCache = linkedMapOf<String, JSONObject>()
    val archives = Arguments.createArray()
    var deepValidated = 0
    var cacheHits = 0
    // A light scan only needs to validate enough newest candidates to find the
    // newest valid recovery point. If the newest archive is damaged or its
    // validation is inconclusive, continue to the next candidate rather than
    // incorrectly rendering the collection as having no recovery point.
    var lightRecoveryPointFound = false
    listed.sortedByDescending { it.modifiedTime ?: 0L }.forEach { item ->
      val uri = DriveClient.uri(item.id)
      val cachedItem = cached[item.id]
      val cacheMatches = cachedItem != null && cacheFingerprintMatches(cachedItem, item)
      // A full deep scan remains available for explicit recovery/debugging.
      // Managed retention calls the same routine with trusted-cache reuse so
      // unchanged verified archives do not get downloaded and parsed again.
      // Drive's immutable ID plus size/modified-time fingerprint invalidates
      // that trust when the provider changes an item.
      val cachedIsTrusted = cacheMatches &&
        cachedItem.optString("state") == "valid" &&
        cachedItem.optString("verification") == "verified" &&
        cachedItem.optString("compatibility") == "compatible"
      val shouldValidate = when {
        deepValidation && !(reuseTrustedCache && cachedIsTrusted) -> true
        !deepValidation -> !lightRecoveryPointFound && !cacheMatches
        else -> false
      }
      var preview = if (cacheMatches) cachedItem?.optJSONObject("preview") else null
      val archive = if (shouldValidate) {
        deepValidated += 1
        val scanned = scanArchive(uri, item.name, item.size, item.modifiedTime)
        preview = scanned.preview
        scanned.archive.also { value ->
          if (value.getString("state") == "valid") lightRecoveryPointFound = true
        }
      } else if (cacheMatches) {
        cacheHits += 1
        cachedArchive(cachedItem!!, item).also { cachedResult ->
          if (cachedResult.getString("state") == "valid") lightRecoveryPointFound = true
        }
      } else {
        metadataArchive(item)
      }
      // React Native takes ownership of a WritableMap when it is pushed into
      // a WritableArray. Serialize the cache entry first; reading `archive`
      // after pushMap would throw "Map already consumed" and turn an otherwise
      // successful Drive listing into a generic scan failure.
      nextCache[item.id] = cacheEntry(item, archive, preview)
      archives.pushMap(archive)
    }
    saveScanCache(folderId, nextCache.values.toList())
    Log.i(
      "BackupRuntime",
      "[DEBUG-BR-SCAN] folder=$folderId listed=${listed.size} deep=$deepValidation reuseTrusted=$reuseTrustedCache " +
        "validated=$deepValidated cacheHits=$cacheHits elapsedMs=${android.os.SystemClock.elapsedRealtime() - startedAt}",
    )
    return Arguments.createMap().apply {
      putBoolean("complete", true)
      putArray("archives", archives)
    }
  }

  private fun metadataArchive(item: DriveClient.Item) = Arguments.createMap().apply {
    putString("uri", DriveClient.uri(item.id))
    putString("name", item.name)
    if (item.size == null) putNull("bytes") else putDouble("bytes", item.size.toDouble())
    if (item.modifiedTime == null) putNull("providerModifiedAt") else putDouble("providerModifiedAt", item.modifiedTime.toDouble())
    putString("state", "uncertain")
    putString("verification", "not_verified")
    putString("compatibility", "unknown")
    filenameCreatedAt(item.name)?.let { putString("createdAt", it) } ?: putNull("createdAt")
  }

  private fun filenameCreatedAt(name: String): String? {
    val match = Regex("^peacock-notes-(\\d{4}-\\d{2}-\\d{2})T(\\d{2})-(\\d{2})-(\\d{2})-(\\d{3})Z").find(name)
      ?: return null
    return runCatching {
      Instant.parse("${match.groupValues[1]}T${match.groupValues[2]}:${match.groupValues[3]}:${match.groupValues[4]}.${match.groupValues[5]}Z").toString()
    }.getOrNull()
  }

  private fun cacheFingerprintMatches(cached: JSONObject, item: DriveClient.Item): Boolean {
    val size = if (item.size == null) JSONObject.NULL else item.size
    val modified = if (item.modifiedTime == null) JSONObject.NULL else item.modifiedTime
    return cached.optString("name") == item.name &&
      (if (cached.has("providerSize")) cached.optLong("providerSize", Long.MIN_VALUE) else Long.MIN_VALUE) ==
        (if (size === JSONObject.NULL) Long.MIN_VALUE else item.size ?: Long.MIN_VALUE) &&
      (if (cached.has("providerModifiedAt")) cached.optLong("providerModifiedAt", Long.MIN_VALUE) else Long.MIN_VALUE) ==
        (if (modified === JSONObject.NULL) Long.MIN_VALUE else item.modifiedTime ?: Long.MIN_VALUE)
  }

  private fun cacheEntry(
    item: DriveClient.Item,
    archive: com.facebook.react.bridge.ReadableMap,
    preview: JSONObject? = null,
  ): JSONObject = JSONObject().apply {
    put("id", item.id)
    put("name", item.name)
    if (item.size == null) put("providerSize", JSONObject.NULL) else put("providerSize", item.size)
    if (item.modifiedTime == null) put("providerModifiedAt", JSONObject.NULL) else put("providerModifiedAt", item.modifiedTime)
    put("uri", archive.getString("uri"))
    put("bytes", if (archive.hasKey("bytes") && !archive.isNull("bytes")) archive.getDouble("bytes") else JSONObject.NULL)
    put("createdAt", if (archive.hasKey("createdAt") && !archive.isNull("createdAt")) archive.getString("createdAt") else JSONObject.NULL)
    put("state", archive.getString("state") ?: "uncertain")
    put("verification", archive.getString("verification") ?: "not_verified")
    put("compatibility", archive.getString("compatibility") ?: "unknown")
    if (preview != null) {
      put("archiveSha256", preview.optString("archiveSha256"))
      put("preview", preview)
    }
  }

  private fun cachedArchive(cached: JSONObject, item: DriveClient.Item) = Arguments.createMap().apply {
    putString("uri", DriveClient.uri(item.id))
    putString("name", item.name)
    if (cached.isNull("bytes")) putNull("bytes") else putDouble("bytes", cached.optDouble("bytes"))
    if (item.modifiedTime == null) putNull("providerModifiedAt") else putDouble("providerModifiedAt", item.modifiedTime.toDouble())
    if (cached.isNull("createdAt")) putNull("createdAt") else putString("createdAt", cached.optString("createdAt"))
    putString("state", cached.optString("state", "uncertain"))
    putString("verification", cached.optString("verification", "not_verified"))
    putString("compatibility", cached.optString("compatibility", "unknown"))
  }

  private fun loadScanCache(folderId: String): Map<String, JSONObject> {
    val raw = context.getSharedPreferences(SCAN_CACHE_PREFERENCES, android.app.Activity.MODE_PRIVATE)
      .getString(SCAN_CACHE_KEY, null) ?: return emptyMap()
    return runCatching {
      val root = JSONObject(raw)
      if (root.optString("folderId") != folderId) return@runCatching emptyMap()
      val array = root.optJSONArray("archives") ?: return@runCatching emptyMap()
      buildMap {
        for (index in 0 until array.length()) {
          val item = array.optJSONObject(index) ?: continue
          val id = item.optString("id")
          if (id.isNotBlank()) put(id, item)
        }
      }
    }.getOrDefault(emptyMap())
  }

  private fun saveScanCache(folderId: String, entries: List<JSONObject>) {
    val root = JSONObject().put("folderId", folderId).put("archives", JSONArray().apply {
      entries.forEach(::put)
    })
    context.getSharedPreferences(SCAN_CACHE_PREFERENCES, android.app.Activity.MODE_PRIVATE)
      .edit().putString(SCAN_CACHE_KEY, root.toString()).apply()
  }

  private data class ScannedArchive(
    val archive: com.facebook.react.bridge.WritableMap,
    val preview: JSONObject?,
  )

  private fun scanArchive(uri: String, name: String, providerSize: Long?, modified: Long?): ScannedArchive {
    val archive = Arguments.createMap().apply {
      putString("uri", uri)
      putString("name", name)
      if (providerSize == null) putNull("bytes") else putDouble("bytes", providerSize.toDouble())
      if (modified == null) putNull("providerModifiedAt") else putDouble("providerModifiedAt", modified.toDouble())
    }
    return try {
      val preview = buildPreview(uri)
      archive.putString("state", "valid")
      archive.putString("verification", "verified")
      archive.putString("compatibility", "compatible")
      archive.putString("createdAt", preview.getString("createdAt"))
      if (providerSize == null) archive.putNull("bytes") else archive.putDouble("bytes", providerSize.toDouble())
      ScannedArchive(archive, preview)
    } catch (error: Exception) {
      val code = errorCode(error)
      val state = when (code) {
        in INCOMPATIBLE_CODES -> "incompatible"
        in UNCERTAIN_CODES -> "uncertain"
        else -> "damaged"
      }
      archive.putString("state", state)
      archive.putString("verification", if (state == "damaged") "failed" else "not_verified")
      archive.putString("compatibility", if (state == "incompatible") "incompatible" else "unknown")
      archive.putNull("createdAt")
      ScannedArchive(archive, null)
    }
  }

  private fun applyRetention(): com.facebook.react.bridge.WritableMap {
    progress.startStep("scan", "scan_archives")
    val scan = scanFolder(deepValidation = true, reuseTrustedCache = true)
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
    val candidates = ArchiveRetentionPolicy.excessValidArchiveKeys(retentionArchives)

    var deleted = 0
    progress.startStep("prune", "prune_archives", itemsTotal = candidates.size)
    candidates.forEach { candidate ->
      val id = DriveClient.idFromUri(candidate) ?: fail("RETENTION_POLICY_RESTRICTED", "Archive is not a Google Drive item")
      try { DriveClient(context).delete(id) } catch (error: Exception) {
        if (error is DriveException) throw error
        fail("PROVIDER_DELETE_FAILED", "Google Drive failed while applying managed retention", error)
      }
      deleted += 1
      progress.addItem()
    }
    return Arguments.createMap().apply {
      putString("status", if (candidates.isEmpty()) "nothing_to_prune" else "applied")
      putInt("deletedCount", deleted)
      putInt("retainedVerifiedCount", retentionArchives.count { it.state == "valid" && it.createdAt != null } - deleted)
    }
  }

  private fun deleteArchives(request: ReadableMap): com.facebook.react.bridge.WritableMap {
    val array = request.getArray("uris") ?: fail("INVALID_REQUEST", "uris is required")
    val ids = (0 until array.size()).map {
      val uri = array.getString(it) ?: fail("INVALID_REQUEST", "Archive URI is missing")
      DriveClient.idFromUri(uri) ?: fail("INVALID_REQUEST", "Archive URI is not a Google Drive item")
    }.distinct()
    if (ids.isEmpty()) fail("EMPTY_SELECTION", "Select at least one archive")
    val drive = DriveClient(context)
    ids.forEach { id -> drive.delete(id) }
    Log.i("BackupRuntime", "[DEBUG-BR-DELETE] requested=${ids.size} deleted=${ids.size}")
    return Arguments.createMap().apply { putInt("deletedCount", ids.size) }
  }

  private fun pin(request: ReadableMap): com.facebook.react.bridge.WritableArray {
    val directory = fileFromUri(requiredString(request, "directoryUri"))
    if (!directory.exists() && !directory.mkdirs()) fail("STAGING_UNAVAILABLE", "Cannot create capture directory")
    val media = parseMedia(request.getArray("media") ?: fail("INVALID_REQUEST", "media is required"))
    progress.startStep("capture", "capture_media", itemsTotal = media.size)
    val result = Arguments.createArray()
    media.forEachIndexed { index, source ->
      val target = File(directory, "pin-$index")
      val sourceFile = fileFromUri(source.uri)
      try {
        java.nio.file.Files.createLink(target.toPath(), sourceFile.toPath())
      } catch (_: Exception) {
        open(source.uri).use { input -> FileOutputStream(target).use { output -> copyBounded(input, output, Long.MAX_VALUE) } }
      }
      progress.addItem()
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
      progress.startStep("build", "hash_media", media.sumOf { fileFromUri(it.uri).length() })
      val hashedMedia = media.map { source ->
        val digest = open(source.uri).use(::sha256)
        if (digest.bytes > limits.maxMediaItemBytes) fail("MEDIA_LIMIT_EXCEEDED", "Media item exceeds limit")
        HashedMedia(source, digest.hex, digest.bytes)
      }
      if (hashedMedia.size > limits.maxMediaItems) fail("MEDIA_LIMIT_EXCEEDED", "Too many media items")
      hashedMedia.fold(0L) { total, item -> checkedAdd(total, item.size, limits.maxMediaBytes) }
      val mediaById = hashedMedia.associateBy { it.source.portableId }
      if (mediaById.size != hashedMedia.size) fail("DUPLICATE_IDENTITY", "Duplicate media portable identity")

      progress.startStep("build", "prepare_database")
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
      progress.startStep("build", "write_archive", inventory.values.sumOf { it.bytes })
      val archiveHasher = MessageDigest.getInstance("SHA-256")
      DigestOutputStream(BufferedOutputStream(FileOutputStream(archive)), archiveHasher).use { output ->
        ZipOutputStream(output).use { zip ->
          putFile(zip, DATABASE_PATH, cleanDatabase)
          val written = mutableSetOf<String>()
          hashedMedia.forEach { item ->
            if (written.add(item.path)) open(item.source.uri).use { putStream(zip, item.path, it) }
          }
          putBytes(zip, MANIFEST_PATH, manifest.toString().toByteArray(Charsets.UTF_8))
        }
      }
      val archiveDigest = Digest(archiveHasher.digest().joinToString("") { "%02x".format(it) }, archive.length())
      if (archiveDigest.bytes > limits.maxArchiveBytes) fail("ARCHIVE_LIMIT_EXCEEDED", "Archive exceeds limit")
      progress.startStep("build", "copy_archive", archive.length())
      copyToUri(archive, destinationUri)
      progress.startStep("build", "verify_copy", archive.length())
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
      val sourceSize = sourceSize(archiveUri)
      progress.startStep("verify", "read_archive", sourceSize)
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
      val stagingBytes = if (request.optionalString("mode") == "verify_only")
        headers.filter { it.fileName == DATABASE_PATH || it.fileName == MANIFEST_PATH }.sumOf { it.uncompressedSize }
      else advertisedExpanded
      ensureSpace(work, stagingBytes)
      if (!extracted.mkdirs()) fail("STAGING_UNAVAILABLE", "Cannot create extraction directory")

      val manifestBytes = readEntryBounded(zip, MANIFEST_PATH, MAX_MANIFEST_BYTES)
      val manifest = try { JSONObject(String(manifestBytes, Charsets.UTF_8)) } catch (error: Exception) {
        fail("MALFORMED_MANIFEST", "Manifest is not valid JSON", error)
      }
      enforceManifestVersion(manifest)
      val inventory = parseInventory(manifest, limits)
      val expectedPaths = inventory.keys.map(::portableIdentity).toMutableSet().apply { add(portableIdentity(MANIFEST_PATH)) }
      if (portablePaths != expectedPaths) fail("INVENTORY_MISMATCH", "ZIP entries do not exactly match the inventory")

      progress.startStep("verify", "verify_files", inventory.values.sumOf { it.bytes }, inventory.size)
      val stageMedia = request.optionalString("mode") != "verify_only"
      var expanded = 0L
      inventory.forEach { (path, expected) ->
        val limit = when {
          path == DATABASE_PATH -> limits.maxDatabaseBytes
          path.startsWith("media/sha256/") -> limits.maxMediaItemBytes
          else -> fail("UNEXPECTED_ENTRY", "Unsupported inventory path: $path")
        }
        if (expected.bytes > limit) fail("ENTRY_LIMIT_EXCEEDED", "Entry exceeds its allowed size: $path")
        val stage = path == DATABASE_PATH || stageMedia
        val actual = zip.getInputStream(zip.getFileHeader(path)).use { input ->
          if (stage) {
            val target = File(extracted, path)
            target.parentFile?.mkdirs()
            FileOutputStream(target).use { output ->
              validateArchiveEntry(input, expected.hex, expected.bytes, ArchiveValidationMode.STAGE, output, progress::addBytes)
            }
          } else {
            validateArchiveEntry(input, expected.hex, expected.bytes, ArchiveValidationMode.VERIFY_ONLY, null, progress::addBytes)
          }
        }
        progress.addItem()
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
    cachedPreview(archiveUri)?.let { cached ->
      try {
        return previewMap(cached)
      } catch (error: Exception) {
        Log.w("BackupRuntime", "Cached archive preview was invalid; rebuilding it", error)
      }
    }
    val preview = buildPreview(archiveUri)
    cachePreview(archiveUri, preview)
    return previewMap(preview)
  }

  private fun cachedPreview(archiveUri: String): JSONObject? {
    val archiveId = DriveClient.idFromUri(archiveUri) ?: return null
    val folderUri = context.getSharedPreferences(FOLDER_PREFERENCES, android.app.Activity.MODE_PRIVATE)
      .getString(FOLDER_URI, null) ?: return null
    val folderId = DriveClient.idFromUri(folderUri) ?: return null
    val cached = loadScanCache(folderId)[archiveId] ?: return null
    if (cached.optString("uri") != archiveUri || cached.optString("state") != "valid") return null
    val preview = cached.optJSONObject("preview") ?: return null
    if (preview.optString("archiveUri") != archiveUri) return null
    val archiveHash = preview.optString("archiveSha256")
    if (!Regex("^[a-f0-9]{64}$").matches(archiveHash)) return null
    if (cached.optString("archiveSha256") != archiveHash) return null
    if (preview.optString("createdAt").isBlank()) return null
    if (preview.optJSONArray("folders") == null || preview.optJSONArray("notes") == null) return null
    return preview
  }

  private fun cachePreview(archiveUri: String, preview: JSONObject) {
    val archiveId = DriveClient.idFromUri(archiveUri) ?: return
    val folderUri = context.getSharedPreferences(FOLDER_PREFERENCES, android.app.Activity.MODE_PRIVATE)
      .getString(FOLDER_URI, null) ?: return
    val folderId = DriveClient.idFromUri(folderUri) ?: return
    val cached = loadScanCache(folderId).toMutableMap()
    val entry = cached[archiveId] ?: return
    if (entry.optString("uri") != archiveUri) return
    entry.put("archiveSha256", preview.optString("archiveSha256"))
    entry.put("preview", preview)
    cached[archiveId] = entry
    saveScanCache(folderId, cached.values.toList())
  }

  private fun buildPreview(archiveUri: String): JSONObject {
    val work = newWorkDirectory("preview")
    try {
      val validationRequest = Arguments.createMap().apply {
        putString("archiveUri", archiveUri)
        putString("mode", "verify_only")
        putString("stagingDirectoryUri", Uri.fromFile(work).toString())
      }
      val summary = validate(validationRequest)
      val extracted = work.listFiles()?.singleOrNull { it.isDirectory && it.name.startsWith("validated-") }
        ?: fail("STAGING_UNAVAILABLE", "Validated import staging is missing")
      val db = SQLiteDatabase.openDatabase(File(extracted, DATABASE_PATH).path, null, SQLiteDatabase.OPEN_READONLY)
      val folders = JSONArray()
      val notes = JSONArray()
      try {
        val parentColumn = if (hasColumn(db, "Folders", "parentPortableId")) "parentPortableId" else "NULL"
        val folderRows = linkedMapOf<String, ArchivedFolderRow>()
        db.rawQuery("SELECT portableId,$parentColumn,name,createdAt,sortOrder FROM Folders ORDER BY sortOrder,portableId", null).use { cursor ->
          while (cursor.moveToNext()) folderRows[cursor.getString(0)] = ArchivedFolderRow(
            cursor.getString(0), cursor.getString(1), cursor.getString(2), cursor.getString(3), cursor.getInt(4),
          )
        }
        folderRows.values.forEach { folder ->
          folders.put(JSONObject().apply {
            put("portableId", folder.portableId); put("parentPortableId", folder.parentPortableId ?: JSONObject.NULL)
            put("name", folder.name); put("sortOrder", folder.sortOrder)
            put("path", JSONArray(folderPath(folder.portableId, folderRows)))
          })
        }
        db.rawQuery("SELECT n.portableId,n.folderPortableId,n.title,substr(n.content,1,180),n.updatedAt,(SELECT COUNT(*) FROM NoteAudios a WHERE a.notePortableId=n.portableId),(SELECT COUNT(*) FROM NoteFiles x WHERE x.notePortableId=n.portableId) FROM Notes n JOIN Folders f ON f.portableId=n.folderPortableId ORDER BY f.sortOrder,f.portableId,n.sortOrder,n.portableId", null).use { cursor ->
          while (cursor.moveToNext()) notes.put(JSONObject().apply {
            put("portableId", cursor.getString(0)); put("folderPortableId", cursor.getString(1)); put("title", cursor.getString(2))
            put("contentPreview", cursor.getString(3)?.take(180) ?: ""); put("updatedAt", cursor.getString(4))
            put("audioCount", cursor.getInt(5)); put("fileCount", cursor.getInt(6))
          })
        }
      } finally { db.close() }
      return JSONObject().apply {
        put("archiveUri", archiveUri); put("archiveSha256", summary.getString("archiveSha256"))
        put("createdAt", summary.getString("createdAt")); put("folders", folders); put("notes", notes)
      }
    } finally { work.deleteRecursively() }
  }

  private fun previewMap(preview: JSONObject): com.facebook.react.bridge.WritableMap {
    val archiveUri = preview.optString("archiveUri")
    val archiveSha256 = preview.optString("archiveSha256")
    val createdAt = preview.optString("createdAt")
    val folderJson = preview.optJSONArray("folders") ?: fail("INVALID_PREVIEW_CACHE", "Cached folders are missing")
    val noteJson = preview.optJSONArray("notes") ?: fail("INVALID_PREVIEW_CACHE", "Cached notes are missing")
    if (archiveUri.isBlank() || createdAt.isBlank() || !Regex("^[a-f0-9]{64}$").matches(archiveSha256)) {
      fail("INVALID_PREVIEW_CACHE", "Cached archive preview is invalid")
    }
    val folders = Arguments.createArray()
    for (index in 0 until folderJson.length()) {
      val folder = folderJson.optJSONObject(index) ?: fail("INVALID_PREVIEW_CACHE", "Cached folder is invalid")
      val pathJson = folder.optJSONArray("path") ?: fail("INVALID_PREVIEW_CACHE", "Cached folder path is missing")
      val path = Arguments.createArray()
      for (pathIndex in 0 until pathJson.length()) path.pushString(pathJson.getString(pathIndex))
      folders.pushMap(Arguments.createMap().apply {
        putString("portableId", folder.getString("portableId"))
        if (folder.isNull("parentPortableId")) putNull("parentPortableId") else putString("parentPortableId", folder.getString("parentPortableId"))
        putString("name", folder.getString("name")); putInt("sortOrder", folder.getInt("sortOrder")); putArray("path", path)
      })
    }
    val notes = Arguments.createArray()
    for (index in 0 until noteJson.length()) {
      val note = noteJson.optJSONObject(index) ?: fail("INVALID_PREVIEW_CACHE", "Cached note is invalid")
      notes.pushMap(Arguments.createMap().apply {
        putString("portableId", note.getString("portableId")); putString("folderPortableId", note.getString("folderPortableId"))
        putString("title", note.getString("title")); putString("contentPreview", note.getString("contentPreview"))
        putString("updatedAt", note.getString("updatedAt")); putInt("audioCount", note.getInt("audioCount")); putInt("fileCount", note.getInt("fileCount"))
      })
    }
    return Arguments.createMap().apply {
      putString("archiveUri", archiveUri); putString("archiveSha256", archiveSha256); putString("createdAt", createdAt)
      putArray("folders", folders); putArray("notes", notes)
    }
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
      progress.startStep("import", "restore_notes")
      if (summary.getString("archiveSha256") != expectedHash) fail("ARCHIVE_CHANGED", "The selected archive changed after preview")
      val extracted = work.listFiles()?.singleOrNull { it.isDirectory && it.name.startsWith("validated-") }
        ?: fail("STAGING_UNAVAILABLE", "Validated import staging is missing")
      val source = SQLiteDatabase.openDatabase(File(extracted, DATABASE_PATH).path, null, SQLiteDatabase.OPEN_READONLY)
      val live = SQLiteDatabase.openDatabase(databaseFile.path, null, SQLiteDatabase.OPEN_READWRITE)
      val createdMedia = mutableSetOf<File>()
      var mediaCommitted = false
      try {
        importReceiptResult(live, operationKey)?.let { return it }
        // Native connections do not inherit Expo's connection-local pragma.
        // Enable FK enforcement for the import transaction so newly restored
        // relations cannot introduce another orphaned row.
        live.execSQL("PRAGMA foreign_keys=ON")
        val available = mutableSetOf<String>()
        source.rawQuery("SELECT portableId FROM Notes", null).use { while (it.moveToNext()) available.add(it.getString(0)) }
        if (!available.containsAll(selected)) fail("INVALID_SELECTION", "The selection contains a note absent from the archive")

        if (!mediaRoot.exists() && !mediaRoot.mkdirs()) fail("STAGING_UNAVAILABLE", "Cannot create media directory")
        ensureSpace(mediaRoot, summary.getDouble("expandedBytes").toLong())
        val restrictions = MediaRestrictions(emptySet(), emptySet())

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
        var imported = 0; var recovered = 0; var skipped = 0; var repaired = 0
        live.beginTransaction()
        try {
          selected.sorted().forEach { noteId ->
            val note = source.rawQuery("SELECT n.portableId,n.folderPortableId,n.title,n.content,n.createdAt,n.updatedAt,n.sortOrder FROM Notes n WHERE n.portableId=?", arrayOf(noteId)).use { cursor ->
              if (!cursor.moveToFirst()) fail("INVALID_SELECTION", "Selected note is missing")
              List(cursor.columnCount) { index -> if (cursor.isNull(index)) null else cursor.getString(index) }
            }
            val sourceFolderPortableId = note[1]!!
            val folderId = ensureImportedFolderChain(source, live, sourceFolderPortableId)
            if (folderId <= 0L) fail("IMPORT_DEPENDENCY_FAILED", "The imported folder could not be resolved")
            Log.i(
              "BackupRuntime",
              "[DEBUG-BR-IMPORT] note=$noteId sourceFolder=$sourceFolderPortableId targetFolderRow=$folderId",
            )
            // Look up by note identity without requiring the current folder to
            // exist. Older databases can retain a note after its folder was
            // deleted (before FK cascade enforcement was enabled); treating
            // that row as absent would collide with the unique portableId
            // index on insert and incorrectly fail the whole import.
            val existing = live.rawQuery("SELECT n.id,f.portableId,n.title,n.content,n.createdAt,n.updatedAt,n.sortOrder FROM Notes n LEFT JOIN Folders f ON f.id=n.folderId WHERE n.portableId=?", arrayOf(noteId)).use { cursor ->
              if (!cursor.moveToFirst()) null else List(cursor.columnCount) { index -> if (cursor.isNull(index)) null else cursor.getString(index) }
            }
            val existingFolderPortableId = existing?.get(1)
            val repairedOrphan = existing != null && existingFolderPortableId == null
            if (repairedOrphan) {
              live.execSQL("UPDATE Notes SET folderId=? WHERE id=?", arrayOf(folderId, existing!![0]!!.toLong()))
              repaired++
              Log.i("BackupRuntime", "[DEBUG-BR-IMPORT] repaired_orphan note=$noteId targetFolderRow=$folderId")
            }
            val unchanged = existing != null &&
              (existingFolderPortableId ?: sourceFolderPortableId) == note[1] &&
              existing[2] == note[2] && (existing[3] ?: "") == (note[3] ?: "") &&
              existing[4] == note[4] && existing[5] == note[5] && existing[6] == note[6] &&
              mediaMatches(source, live, noteId, existing[0]!!.toLong())
            if (unchanged) { skipped++; return@forEach }
            val targetPortableId = if (existing == null) noteId else UUID.randomUUID().toString()
            val recoveredTitleSuffix = request.getString("recoveredTitleSuffix") ?: " (Recovered copy)"
            val targetTitle = if (existing == null) note[2]!! else "${note[2]}$recoveredTitleSuffix"
            val statement = live.compileStatement("INSERT INTO Notes(portableId,folderId,title,searchTitle,content,searchContent,audioUri,createdAt,updatedAt,sortOrder) VALUES(?,?,?,?,?,?,NULL,?,?,?)")
            statement.bindString(1, targetPortableId); statement.bindLong(2, folderId); statement.bindString(3, targetTitle)
            statement.bindString(4, targetTitle.lowercase(Locale.ROOT))
            if (note[3] == null) {
              statement.bindNull(5); statement.bindString(6, "")
            } else {
              statement.bindString(5, note[3]!!); statement.bindString(6, note[3]!!.lowercase(Locale.ROOT))
            }
            statement.bindString(7, note[4]!!); statement.bindString(8, note[5]!!)
            val nextSortOrder = live.rawQuery(
              "SELECT COALESCE(MAX(sortOrder),0)+1 FROM Notes WHERE folderId=?",
              arrayOf(folderId.toString()),
            ).use { cursor -> if (cursor.moveToFirst()) cursor.getLong(0) else 1L }
            statement.bindLong(9, nextSortOrder)
            val liveNoteId = statement.executeInsert()
            copyImportedMedia(source, live, "NoteAudios", noteId, liveNoteId, mediaUris, existing != null)
            copyImportedMedia(source, live, "NoteFiles", noteId, liveNoteId, mediaUris, existing != null)
            if (existing != null) {
              live.execSQL("INSERT INTO RecoveryProvenance(noteId,sourcePortableId,archiveSha256,archiveCreatedAt,archivedUpdatedAt,recoveredAt) VALUES(?,?,?,?,?,?)", arrayOf<Any>(liveNoteId, noteId, expectedHash, archiveCreatedAt, note[5]!!, java.time.Instant.now().toString()))
            }
            imported++; if (existing != null) recovered++
          }
          live.execSQL("INSERT INTO BackupImportReceipts(operationKey,archiveSha256,selectedNoteIds,importedCount,recoveredCount,skippedCount,restrictedAudioCount,restrictedFileCount,committedAt) VALUES(?,?,?,?,?,?,?,?,?)", arrayOf<Any>(operationKey, expectedHash, selected.sorted().joinToString(","), imported, recovered, skipped, restrictions.audioIds.size, restrictions.fileIds.size, java.time.Instant.now().toString()))
          if (imported > 0 || repaired > 0) live.execSQL("UPDATE ContentMetadata SET revision=revision+1 WHERE id=1")
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
    val preferences = context.getSharedPreferences(REPLACEMENT_PREFERENCES, android.app.Activity.MODE_PRIVATE)
    val supersededSnapshot = replacementSnapshotPath(preferences.getString(REPLACEMENT_UNDO, null))
    cleanupOrphanedReplacementSnapshots(setOfNotNull(supersededSnapshot))
    val archiveUri = requiredString(request, "archiveUri")
    val expectedHash = requiredString(request, "archiveSha256")
    val databaseFile = fileFromUri(requiredString(request, "databaseUri"))
    val mediaRoot = fileFromUri(requiredString(request, "mediaDirectoryUri"))
    val operationKey = requiredString(request, "operationKey")
    val existing = SQLiteDatabase.openDatabase(databaseFile.path, null, SQLiteDatabase.OPEN_READONLY)
    try {
      replacementReceiptResult(existing, operationKey)?.let { return it }
      if (importReceiptExists(existing, operationKey)) {
        fail("IMPORT_RESULT_UNAVAILABLE", "The replacement receipt is missing its safety snapshot")
      }
    } finally { existing.close() }

    val work = newWorkDirectory("replacement")
    val generationId = UUID.randomUUID().toString()
    val durableRoot = File(context.filesDir, "backup-replacement")
    val staged = File(durableRoot, "staged-$generationId")
    val snapshot = File(durableRoot, "snapshot-$generationId")
    var journalPersisted = false
    var snapshotOwnedByUndo = false
    try {
      if (!staged.mkdirs() || !snapshot.mkdirs()) fail("STAGING_UNAVAILABLE", "Cannot create replacement staging")
      val validationRequest = Arguments.createMap().apply {
        putString("archiveUri", archiveUri)
        putString("stagingDirectoryUri", Uri.fromFile(work).toString())
      }
      val summary = validate(validationRequest)
      progress.startStep("import", "restore_notes")
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
          "INSERT INTO BackupImportReceipts(operationKey,archiveSha256,selectedNoteIds,importedCount,recoveredCount,skippedCount,restrictedAudioCount,restrictedFileCount,safetySnapshotId,committedAt) VALUES(?,?,?,?,0,0,?,?,?,?)",
          arrayOf<Any>(operationKey, expectedHash, "__full_replacement__", noteCount, restrictions.audioIds.size, restrictions.fileIds.size, generationId, java.time.Instant.now().toString())
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
      if (!preferences.edit().putString(REPLACEMENT_JOURNAL, journal.toString()).commit()) {
        fail("JOURNAL_PERSIST_FAILED", "Replacement was not started because its recovery journal could not be saved")
      }
      journalPersisted = true
      try {
        replaceFile(stagedDatabase, databaseFile)
        replaceDirectory(stagedAudio, File(mediaRoot, "audio"))
        replaceDirectory(stagedFiles, File(mediaRoot, "files"))
        verifyLiveGeneration(databaseFile, File(mediaRoot, "audio"), File(mediaRoot, "files"), operationKey)
      } catch (error: Exception) {
        rollbackReplacement(journal)
        if (preferences.edit().remove(REPLACEMENT_JOURNAL).commit()) journalPersisted = false
        throw ArchiveException("REPLACEMENT_ROLLED_BACK", "Full replacement failed and the prior content was restored", error)
      }
      val completedAt = System.currentTimeMillis()
      val undo = JSONObject()
        .put("snapshotId", generationId).put("snapshot", snapshot.path)
        .put("database", databaseFile.path).put("mediaRoot", mediaRoot.path)
        .put("completedAt", completedAt).put("expiresAt", completedAt + UNDO_WINDOW_MILLIS)
        .put("fingerprint", snapshotFingerprint(snapshot))
      if (!preferences.edit().remove(REPLACEMENT_JOURNAL).putString(REPLACEMENT_UNDO, undo.toString()).commit()) {
        rollbackReplacement(journal)
        if (preferences.edit().remove(REPLACEMENT_JOURNAL).commit()) journalPersisted = false
        fail("UNDO_METADATA_FAILED", "Replacement was rolled back because its undo point could not be saved")
      }
      journalPersisted = false
      snapshotOwnedByUndo = true
      supersededSnapshot?.let(::deleteOwnedReplacementDirectory)
      val count = SQLiteDatabase.openDatabase(databaseFile.path, null, SQLiteDatabase.OPEN_READONLY).useDatabase {
        scalarCount(it, "SELECT COUNT(*) FROM Notes").toInt()
      }
      return replacementResult(false, count, generationId, restrictions.audioIds.size, restrictions.fileIds.size)
    } finally {
      work.deleteRecursively()
      staged.deleteRecursively()
      if (!journalPersisted && !snapshotOwnedByUndo) deleteOwnedReplacementDirectory(snapshot.path)
    }
  }

  private fun copyReplacementFolders(source: SQLiteDatabase, target: SQLiteDatabase) {
    val parentColumn = if (hasColumn(source, "Folders", "parentPortableId")) "parentPortableId" else "NULL"
    copyRows(source, target, "SELECT portableId,$parentColumn,name,createdAt,sortOrder FROM Folders ORDER BY portableId", "INSERT INTO Folders(portableId,parentPortableId,name,createdAt,sortOrder) VALUES(?,?,?,?,?)", 5)
  }

  private fun copyReplacementNotes(source: SQLiteDatabase, target: SQLiteDatabase) {
    source.rawQuery("SELECT portableId,folderPortableId,title,content,createdAt,updatedAt,sortOrder FROM Notes ORDER BY portableId", null).use { cursor ->
      val statement = target.compileStatement("INSERT INTO Notes(portableId,folderId,title,searchTitle,content,searchContent,audioUri,createdAt,updatedAt,sortOrder) VALUES(?,(SELECT id FROM Folders WHERE portableId=?),?,?,?,?,NULL,?,?,?)")
      while (cursor.moveToNext()) {
        statement.clearBindings()
        val title = cursor.getString(2)
        statement.bindString(1, cursor.getString(0))
        statement.bindString(2, cursor.getString(1))
        statement.bindString(3, title)
        statement.bindString(4, title.lowercase(Locale.ROOT))
        if (cursor.isNull(3)) {
          statement.bindNull(5); statement.bindString(6, "")
        } else {
          val content = cursor.getString(3)
          statement.bindString(5, content); statement.bindString(6, content.lowercase(Locale.ROOT))
        }
        statement.bindString(7, cursor.getString(4))
        statement.bindString(8, cursor.getString(5))
        statement.bindLong(9, cursor.getLong(6))
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
    val snapshotPath = undo.optString("snapshot")
    if (!isOwnedReplacementDirectory(snapshotPath)) return undoStatus("damaged", snapshotId, expiresAt)
    if (System.currentTimeMillis() >= expiresAt) {
      deleteOwnedReplacementDirectory(snapshotPath)
      preferences.edit().remove(REPLACEMENT_UNDO).commit()
      return undoStatus("expired", snapshotId, expiresAt)
    }
    val snapshot = File(snapshotPath)
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
        // Snapshots taken before the folder hierarchy column existed still undo;
        // their folders are all roots.
        val priorParentColumn = if (hasColumn(db, "prior.Folders", "parentPortableId")) "parentPortableId" else "NULL"
        db.execSQL("INSERT INTO Folders(id,portableId,parentPortableId,name,createdAt,sortOrder) SELECT id,portableId,$priorParentColumn,name,createdAt,sortOrder FROM prior.Folders")
        copyPriorNotes(db)
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

  private fun copyPriorNotes(db: SQLiteDatabase) {
    val statement = db.compileStatement(
      "INSERT INTO Notes(id,portableId,folderId,title,searchTitle,content,searchContent,audioUri,createdAt,updatedAt,sortOrder) VALUES(?,?,?,?,?,?,?,?,?,?,?)",
    )
    db.rawQuery(
      "SELECT id,portableId,folderId,title,content,audioUri,createdAt,updatedAt,sortOrder FROM prior.Notes",
      null,
    ).use { cursor ->
      while (cursor.moveToNext()) {
        statement.clearBindings()
        statement.bindLong(1, cursor.getLong(0))
        bind(statement, 2, cursor, 1)
        bind(statement, 3, cursor, 2)
        val title = cursor.getString(3)
        statement.bindString(4, title)
        statement.bindString(5, title.lowercase(Locale.ROOT))
        if (cursor.isNull(4)) {
          statement.bindNull(6)
          statement.bindString(7, "")
        } else {
          val content = cursor.getString(4)
          statement.bindString(6, content)
          statement.bindString(7, content.lowercase(Locale.ROOT))
        }
        bind(statement, 8, cursor, 5)
        bind(statement, 9, cursor, 6)
        if (cursor.isNull(7)) statement.bindString(10, cursor.getString(6)) else bind(statement, 10, cursor, 7)
        if (cursor.isNull(8)) statement.bindLong(11, 0L) else bind(statement, 11, cursor, 8)
        statement.executeInsert()
      }
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
        while (true) { val count = input.read(buffer); if (count < 0) break; digest.update(buffer, 0, count); progress.addBytes(count.toLong()) }
      }
    }
    return digest.digest().joinToString("") { "%02x".format(it) }
  }

  private fun recoverReplacementIfNeeded(): Boolean {
    val preferences = context.getSharedPreferences(REPLACEMENT_PREFERENCES, android.app.Activity.MODE_PRIVATE)
    val raw = preferences.getString(REPLACEMENT_JOURNAL, null)
    if (raw == null) {
      cleanupOrphanedReplacementSnapshots(setOfNotNull(replacementSnapshotPath(preferences.getString(REPLACEMENT_UNDO, null))))
      return false
    }
    val journal = runCatching { JSONObject(raw) }.getOrElse {
      throw ArchiveException("RECOVERY_JOURNAL_DAMAGED", "The replacement recovery journal is corrupted", it)
    }
    rollbackReplacement(journal)
    if (!preferences.edit().remove(REPLACEMENT_JOURNAL).commit()) {
      fail("RECOVERY_JOURNAL_PERSIST_FAILED", "The replacement recovery journal could not be cleared")
    }
    deleteOwnedReplacementDirectory(journal.optString("snapshot"))
    deleteOwnedReplacementDirectory(journal.optString("staged"))
    cleanupOrphanedReplacementSnapshots(setOfNotNull(replacementSnapshotPath(preferences.getString(REPLACEMENT_UNDO, null))))
    return true
  }

  private fun rollbackReplacement(journal: JSONObject) {
    val database = File(journal.getString("database")); val mediaRoot = File(journal.getString("mediaRoot"))
    val snapshot = File(journal.getString("snapshot"))
    verifySnapshot(snapshot)
    replaceFile(File(snapshot, "peacocknotes.db"), database, copy = true)
    replaceDirectory(File(snapshot, "audio"), File(mediaRoot, "audio"), copy = true)
    replaceDirectory(File(snapshot, "files"), File(mediaRoot, "files"), copy = true)
    val db = SQLiteDatabase.openDatabase(database.path, null, SQLiteDatabase.OPEN_READONLY)
    try {
      if (db.rawQuery("PRAGMA integrity_check", null).use { it.moveToFirst() && it.getString(0) == "ok" }.not()) fail("ROLLBACK_FAILED", "Safety snapshot database is invalid")
    } finally { db.close() }
  }

  private fun replacementSnapshotPath(raw: String?): String? = raw?.let {
    runCatching { JSONObject(it).optString("snapshot").takeIf(String::isNotBlank) }.getOrNull()
  }

  private fun isOwnedReplacementDirectory(path: String): Boolean = runCatching {
    val root = File(context.filesDir, "backup-replacement").canonicalFile
    val candidate = File(path).canonicalFile
    candidate.parentFile == root && (candidate.name.startsWith("snapshot-") || candidate.name.startsWith("staged-"))
  }.getOrDefault(false)

  private fun deleteOwnedReplacementDirectory(path: String) {
    if (isOwnedReplacementDirectory(path)) File(path).deleteRecursively()
  }

  private fun cleanupOrphanedReplacementSnapshots(protectedPaths: Set<String>) {
    val root = File(context.filesDir, "backup-replacement")
    val protected = protectedPaths.mapNotNull { runCatching { File(it).canonicalPath }.getOrNull() }.toSet()
    root.listFiles()
      ?.filter { it.isDirectory && (it.name.startsWith("snapshot-") || it.name.startsWith("staged-")) }
      ?.filter { runCatching { it.canonicalPath !in protected }.getOrDefault(false) }
      ?.forEach { it.deleteRecursively() }
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
    target.parentFile?.mkdirs()
    progress.startStep("import", "copy_media", source.length())
    FileInputStream(source).use { input ->
      FileOutputStream(target).use { output -> copyBounded(input, output, Long.MAX_VALUE) }
    }
    progress.startStep("import", "verify_media", source.length() * 2)
    if (FileInputStream(source).use(::sha256) != FileInputStream(target).use(::sha256)) fail(code, "Copied file verification failed")
    progress.startStep("import", "restore_notes")
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
    return if (isFullReplacementReceipt(db, key)) replacementReceiptResult(db, key) else selectiveReceiptResult(db, key)
  }

  private fun isFullReplacementReceipt(db: SQLiteDatabase, key: String): Boolean =
    db.rawQuery("SELECT selectedNoteIds FROM BackupImportReceipts WHERE operationKey=?", arrayOf(key)).use {
      it.moveToFirst() && it.getString(0) == "__full_replacement__"
    }

  private fun selectiveReceiptResult(db: SQLiteDatabase, key: String): com.facebook.react.bridge.WritableMap? {
    return db.rawQuery("SELECT importedCount,recoveredCount,skippedCount,restrictedAudioCount,restrictedFileCount FROM BackupImportReceipts WHERE operationKey=?", arrayOf(key)).use {
      if (it.moveToFirst()) importResult(true, it.getInt(0), it.getInt(1), it.getInt(2), it.getInt(3), it.getInt(4)) else null
    }
  }

  private fun replacementReceiptResult(db: SQLiteDatabase, key: String): com.facebook.react.bridge.WritableMap? {
    return db.rawQuery("SELECT importedCount,restrictedAudioCount,restrictedFileCount,safetySnapshotId FROM BackupImportReceipts WHERE operationKey=?", arrayOf(key)).use {
      if (!it.moveToFirst()) return null
      val snapshotId = it.getString(3) ?: return null
      replacementResult(true, it.getInt(0), snapshotId, it.getInt(1), it.getInt(2))
    }
  }

  private fun importResult(alreadyCommitted: Boolean, imported: Int, recovered: Int, skipped: Int = 0, restrictedAudio: Int = 0, restrictedFiles: Int = 0) = Arguments.createMap().apply {
    putBoolean("alreadyCommitted", alreadyCommitted); putInt("importedCount", imported); putInt("recoveredCount", recovered); putInt("skippedCount", skipped)
    putRecoveryRestriction(restrictedAudio, restrictedFiles)
  }

  private fun com.facebook.react.bridge.WritableMap.putRecoveryRestriction(audio: Int, files: Int) {
    putInt("restrictedAudioCount", audio); putInt("restrictedFileCount", files)
    putBoolean("recoveryComplete", audio == 0 && files == 0)
  }

  private data class ArchivedFolderRow(
    val portableId: String,
    val parentPortableId: String?,
    val name: String,
    val createdAt: String,
    val sortOrder: Int,
  )

  private fun folderPath(portableId: String, folders: Map<String, ArchivedFolderRow>, visited: MutableSet<String> = mutableSetOf()): List<String> {
    if (!visited.add(portableId)) fail("BROKEN_REFERENCE", "Folder hierarchy contains a cycle")
    val folder = folders[portableId] ?: fail("BROKEN_REFERENCE", "Folder hierarchy is missing a parent")
    return (folder.parentPortableId?.let { folderPath(it, folders, visited) } ?: emptyList()) + folder.name
  }

  // Recreates the archived folder and its missing ancestors from the root down.
  // An existing local folder is reused only when its parent matches, so equal
  // display names from different archive paths never merge.
  private fun ensureImportedFolderChain(source: SQLiteDatabase, live: SQLiteDatabase, portableId: String): Long {
    val parentColumn = if (hasColumn(source, "Folders", "parentPortableId")) "parentPortableId" else "NULL"
    val folder = source.rawQuery("SELECT portableId,$parentColumn,name,createdAt,sortOrder FROM Folders WHERE portableId=?", arrayOf(portableId)).use {
      if (!it.moveToFirst()) fail("IMPORT_DEPENDENCY_FAILED", "Archived folder is missing")
      ArchivedFolderRow(it.getString(0), it.getString(1), it.getString(2), it.getString(3), it.getInt(4))
    }
    folder.parentPortableId?.let { parentId -> ensureImportedFolderChain(source, live, parentId) }
    val liveParentColumn = if (hasColumn(live, "Folders", "parentPortableId")) "parentPortableId" else "NULL"
    live.rawQuery("SELECT id,$liveParentColumn FROM Folders WHERE portableId=?", arrayOf(portableId)).use {
      if (it.moveToFirst()) {
        if (it.getString(1) != folder.parentPortableId) fail("IMPORT_DEPENDENCY_FAILED", "Folder identity has a different parent locally")
        return it.getLong(0)
      }
    }
    val statement = live.compileStatement("INSERT INTO Folders(portableId,parentPortableId,name,createdAt,sortOrder) VALUES(?,?,?,?,?)")
    statement.bindString(1, folder.portableId)
    if (folder.parentPortableId == null) statement.bindNull(2) else statement.bindString(2, folder.parentPortableId)
    val nextSortOrder = live.rawQuery("SELECT COALESCE(MAX(sortOrder),0)+1 FROM Folders", null).use { cursor ->
      if (cursor.moveToFirst()) cursor.getLong(0) else 1L
    }
    statement.bindString(3, folder.name); statement.bindString(4, folder.createdAt); statement.bindLong(5, nextSortOrder)
    return statement.executeInsert()
  }

  private fun hasColumn(db: SQLiteDatabase, table: String, column: String): Boolean =
    db.rawQuery("PRAGMA table_info($table)", null).use { cursor ->
      while (cursor.moveToNext()) if (cursor.getString(1) == column) return@use true
      false
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
      output.execSQL("PRAGMA defer_foreign_keys=ON")
      output.execSQL("PRAGMA user_version=$DATABASE_VERSION")
      output.execSQL("CREATE TABLE Folders(portableId TEXT PRIMARY KEY,parentPortableId TEXT,name TEXT NOT NULL,createdAt TEXT NOT NULL,sortOrder INTEGER NOT NULL,FOREIGN KEY(parentPortableId) REFERENCES Folders(portableId))")
      output.execSQL("CREATE TABLE Notes(portableId TEXT PRIMARY KEY,folderPortableId TEXT NOT NULL,title TEXT NOT NULL,content TEXT,createdAt TEXT NOT NULL,updatedAt TEXT NOT NULL,sortOrder INTEGER NOT NULL,FOREIGN KEY(folderPortableId) REFERENCES Folders(portableId))")
      output.execSQL("CREATE TABLE NoteAudios(portableId TEXT PRIMARY KEY,notePortableId TEXT NOT NULL,mediaPath TEXT NOT NULL,displayName TEXT,groupId TEXT,segmentIndex INTEGER,orderIndex INTEGER NOT NULL,createdAt TEXT NOT NULL,FOREIGN KEY(notePortableId) REFERENCES Notes(portableId))")
      output.execSQL("CREATE TABLE NoteFiles(portableId TEXT PRIMARY KEY,notePortableId TEXT NOT NULL,mediaPath TEXT NOT NULL,displayName TEXT,mimeType TEXT,orderIndex INTEGER NOT NULL,createdAt TEXT NOT NULL,FOREIGN KEY(notePortableId) REFERENCES Notes(portableId))")
      output.beginTransaction()
      val parentColumn = if (hasColumn(input, "Folders", "parentPortableId")) {
        "CASE WHEN F.parentPortableId IS NULL OR EXISTS (SELECT 1 FROM Folders P WHERE P.portableId = F.parentPortableId) THEN F.parentPortableId ELSE NULL END"
      } else "NULL"
      copyRows(input, output, "SELECT F.portableId,$parentColumn,F.name,F.createdAt,F.sortOrder FROM Folders F", "INSERT INTO Folders VALUES(?,?,?,?,?)", 5)
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
      if (databaseVersion !in SUPPORTED_DATABASE_VERSIONS) fail("UNSUPPORTED_DATABASE_VERSION", "SQLite database version is not supported")
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
    if (manifest.optInt("databaseVersion", -1) !in SUPPORTED_DATABASE_VERSIONS) fail("UNSUPPORTED_DATABASE_VERSION", "Unsupported database version")
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
    copyBounded(input, zip, Long.MAX_VALUE); zip.closeEntry()
  }

  private fun readEntryBounded(zip: ZipFile, path: String, limit: Long): ByteArray {
    val header = zip.getFileHeader(path) ?: fail("MISSING_MANIFEST", "Manifest is missing")
    if (header.uncompressedSize > limit) fail("MANIFEST_LIMIT_EXCEEDED", "Manifest exceeds limit")
    return zip.getInputStream(header).use { input ->
      val output = java.io.ByteArrayOutputStream()
      copyBounded(input, output, limit); output.toByteArray()
    }
  }

  private fun sourceSize(uri: String): Long? = when {
    uri.startsWith("gdrive:") -> null
    uri.startsWith("content:") -> runCatching {
      context.contentResolver.openAssetFileDescriptor(Uri.parse(uri), "r")?.use { it.length.takeIf { size -> size >= 0 } }
    }.getOrNull()
    else -> fileFromUri(uri).length()
  }

  private fun materialize(uri: String, target: File, limit: Long): File { open(uri).use { input -> FileOutputStream(target).use { copyBounded(input, it, limit) } }; return target }
  private fun materializeDigest(uri: String, target: File, limit: Long): Digest = open(uri).use { input -> FileOutputStream(target).use { copyAndHash(input, it, limit, null) } }
  private fun copyToUri(source: File, uri: String) { FileInputStream(source).use { input -> openOutput(uri).use { output -> copyBounded(input, output, Long.MAX_VALUE) } } }
  private fun open(uri: String): InputStream = when {
    uri.startsWith("gdrive:") -> DriveClient.idFromUri(uri)?.let { DriveClient(context).download(it) }
      ?: fail("INVALID_URI", "Invalid Google Drive archive URI")
    uri.startsWith("content:") -> context.contentResolver.openInputStream(Uri.parse(uri))
    else -> FileInputStream(fileFromUri(uri))
  }
      ?: fail("SOURCE_UNAVAILABLE", "Cannot open source URI")
  private fun openOutput(uri: String): OutputStream =
    (if (uri.startsWith("content:")) context.contentResolver.openOutputStream(Uri.parse(uri), "wt") else FileOutputStream(fileFromUri(uri)))
      ?: fail("DESTINATION_UNAVAILABLE", "Cannot open destination URI")
  private fun fileFromUri(uri: String): File { val parsed = Uri.parse(uri); if (parsed.scheme != null && parsed.scheme != "file") fail("INVALID_URI", "Expected a file URI"); return File(parsed.path ?: uri) }

  private fun sha256(input: InputStream): Digest { val sink = object : OutputStream() { override fun write(b: Int) = Unit; override fun write(b: ByteArray, off: Int, len: Int) = Unit }; return copyAndHash(input, sink, Long.MAX_VALUE, null) }
  private fun copyAndHash(input: InputStream, output: OutputStream, limit: Long, exact: Long?): Digest {
    val digest = MessageDigest.getInstance("SHA-256"); val buffer = ByteArray(BUFFER_SIZE); var total = 0L
    while (true) { val count = input.read(buffer); if (count < 0) break; total = checkedAdd(total, count.toLong(), limit); output.write(buffer, 0, count); digest.update(buffer, 0, count); progress.addBytes(count.toLong()) }
    if (exact != null && total != exact) fail("SIZE_MISMATCH", "Entry size differs from inventory")
    return Digest(digest.digest().joinToString("") { "%02x".format(it) }, total)
  }
  private fun copyBounded(input: InputStream, output: OutputStream, limit: Long) { val buffer = ByteArray(BUFFER_SIZE); var total = 0L; while (true) { val count = input.read(buffer); if (count < 0) return; total = checkedAdd(total, count.toLong(), limit); output.write(buffer, 0, count); progress.addBytes(count.toLong()) } }
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
  private fun errorCode(error: Throwable) = when (error) {
    is ArchiveValidationException -> error.code
    is ArchiveException -> error.code
    is DriveException -> error.code
    else -> "ARCHIVE_OPERATION_FAILED"
  }
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
