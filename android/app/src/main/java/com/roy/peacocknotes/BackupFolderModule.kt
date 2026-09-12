package com.roy.peacocknotes

import android.app.Activity
import android.content.Intent
import android.database.Cursor
import android.net.Uri
import android.provider.DocumentsContract
import android.provider.OpenableColumns
import android.system.Os
import com.facebook.react.bridge.ActivityEventListener
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.ReadableMap
import java.io.FileInputStream

class BackupFolderModule(
  private val reactContext: ReactApplicationContext
) : ReactContextBaseJavaModule(reactContext), ActivityEventListener {
  companion object {
    private const val PICK_FOLDER_REQUEST = 9402
    private const val PREFERENCES = "peacock_notes_backup_folder"
    private const val FOLDER_URI = "folder_uri"
  }

  private var pickerPromise: Promise? = null

  init {
    reactContext.addActivityEventListener(this)
  }

  override fun getName() = "BackupFolder"

  @ReactMethod
  fun getFolderState(promise: Promise) {
    promise.resolve(readFolderState())
  }

  @ReactMethod
  fun chooseFolder(promise: Promise) {
    if (pickerPromise != null) {
      promise.reject("PICKER_ACTIVE", "The folder picker is already open.")
      return
    }

    val activity = reactContext.getCurrentActivity()
    if (activity == null) {
      promise.reject("ACTIVITY_UNAVAILABLE", "The folder picker is unavailable.")
      return
    }

    val intent = Intent(Intent.ACTION_OPEN_DOCUMENT_TREE).apply {
      addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
      addFlags(Intent.FLAG_GRANT_WRITE_URI_PERMISSION)
      addFlags(Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION)
      addFlags(Intent.FLAG_GRANT_PREFIX_URI_PERMISSION)
      storedUri()?.let { putExtra("android.provider.extra.INITIAL_URI", it) }
    }

    pickerPromise = promise
    try {
      activity.startActivityForResult(intent, PICK_FOLDER_REQUEST)
    } catch (error: Exception) {
      pickerPromise = null
      promise.reject("PICKER_UNAVAILABLE", "The folder picker could not be opened.", error)
    }
  }

  @ReactMethod
  fun publishArchive(request: ReadableMap, promise: Promise) {
    val folder = storedUri()
    if (folder == null) {
      promise.reject("FOLDER_NOT_CONNECTED", "No backup folder is connected.")
      return
    }
    Thread {
      var document: Uri? = null
      try {
        val stagedUri = requireString(request, "stagedUri")
        val requestedName = requireString(request, "displayName")
        val expectedBytes = requireNonNegativeLong(request, "expectedBytes")
        val parent = DocumentsContract.buildDocumentUriUsingTree(
          folder,
          DocumentsContract.getTreeDocumentId(folder)
        )
        document = DocumentsContract.createDocument(
          reactContext.contentResolver,
          parent,
          "application/octet-stream",
          requestedName
        ) ?: throw PublishException("PROVIDER_INTERRUPTED", "The provider did not create the backup document.")

        reactContext.contentResolver.openFileDescriptor(document, "rw").use { descriptor ->
          if (descriptor == null) throw PublishException("PROVIDER_INTERRUPTED", "The provider output is unavailable.")
          val stats = try { Os.fstatvfs(descriptor.fileDescriptor) } catch (_: Exception) { null }
          if (stats != null && stats.f_bavail * stats.f_bsize < expectedBytes) {
            throw PublishException("DESTINATION_STORAGE_INSUFFICIENT", "The backup folder does not have enough free space.")
          }
        }

        val source = if (stagedUri.startsWith("file:")) FileInputStream(Uri.parse(stagedUri).path!!) else
          reactContext.contentResolver.openInputStream(Uri.parse(stagedUri))
        source.use { input ->
          if (input == null) throw PublishException("STAGING_MISSING", "The staged archive is missing.")
          reactContext.contentResolver.openOutputStream(document, "wt").use { output ->
            if (output == null) throw PublishException("PROVIDER_INTERRUPTED", "The provider output is unavailable.")
            input.copyTo(output, 64 * 1024)
            output.flush()
          }
        }
        val actualName = displayName(document)
        if (actualName != requestedName) {
          throw PublishException("OUTPUT_RENAMED", "The provider stored '$actualName' instead of '$requestedName'.")
        }
        val actualBytes = reactContext.contentResolver.openAssetFileDescriptor(document, "r").use { it?.length ?: -1L }
        if (actualBytes != expectedBytes) {
          throw PublishException("PARTIAL_WRITE", "The provider stored an incomplete backup document.")
        }
        promise.resolve(Arguments.createMap().apply {
          putString("uri", document.toString())
          putString("name", actualName)
        })
      } catch (error: Exception) {
        if (document != null && !DocumentsContract.deleteDocument(reactContext.contentResolver, document)) {
          promise.reject("PARTIAL_OUTPUT_REMAINS", "Export failed and a partial document may remain in the backup folder.", error)
        } else {
          val code = (error as? PublishException)?.code ?: "PROVIDER_INTERRUPTED"
          promise.reject(code, error.message, error)
        }
      }
    }.start()
  }

  @ReactMethod
  fun disconnect(promise: Promise) {
    val uri = storedUri()
    if (uri != null) {
      try {
        reactContext.contentResolver.releasePersistableUriPermission(
          uri,
          Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_GRANT_WRITE_URI_PERMISSION
        )
      } catch (_: SecurityException) {
        // The provider may already have revoked the grant.
      }
    }
    preferences().edit().remove(FOLDER_URI).apply()
    promise.resolve(state("disconnected", null, null))
  }

  override fun onActivityResult(activity: Activity, requestCode: Int, resultCode: Int, data: Intent?) {
    if (requestCode != PICK_FOLDER_REQUEST) return
    val promise = pickerPromise ?: return
    pickerPromise = null

    if (resultCode != Activity.RESULT_OK || data?.data == null) {
      promise.reject("PICKER_CANCELLED", "No folder was selected.")
      return
    }

    val uri = data.data!!
    val requestedFlags = data.flags and
      (Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_GRANT_WRITE_URI_PERMISSION)
    val requiredFlags = Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_GRANT_WRITE_URI_PERMISSION

    if (requestedFlags and requiredFlags != requiredFlags) {
      promise.reject("PERMISSION_INCOMPLETE", "The selected folder did not grant read and write access.")
      return
    }

    try {
      reactContext.contentResolver.takePersistableUriPermission(uri, requiredFlags)
      val oldUri = storedUri()
      preferences().edit().putString(FOLDER_URI, uri.toString()).apply()
      if (oldUri != null && oldUri != uri) releaseOldPermission(oldUri)
      promise.resolve(readFolderState())
    } catch (error: SecurityException) {
      promise.reject("PERMISSION_NOT_PERSISTED", "Folder access could not be saved.", error)
    }
  }

  override fun onNewIntent(intent: Intent) = Unit

  private fun readFolderState(): com.facebook.react.bridge.WritableMap {
    val uri = storedUri() ?: return state("disconnected", null, null)
    val persistedPermission = reactContext.contentResolver.persistedUriPermissions.firstOrNull {
      it.uri == uri && it.isReadPermission && it.isWritePermission
    }
    if (persistedPermission == null) return state("revoked", uri, displayName(uri, resolveTreeRoot = true))

    return try {
      val document = DocumentsContract.buildDocumentUriUsingTree(uri, DocumentsContract.getTreeDocumentId(uri))
      reactContext.contentResolver.query(document, arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null)
        .use { cursor ->
          if (cursor == null || !cursor.moveToFirst()) {
            state("unavailable", uri, null)
          } else {
            state("connected", uri, cursor.stringOrNull(OpenableColumns.DISPLAY_NAME))
          }
        }
    } catch (_: Exception) {
      state("unavailable", uri, null)
    }
  }

  private fun Cursor.stringOrNull(columnName: String): String? {
    val index = getColumnIndex(columnName)
    return if (index >= 0 && !isNull(index)) getString(index) else null
  }

  private fun requireString(map: ReadableMap, key: String): String =
    if (map.hasKey(key) && !map.isNull(key)) map.getString(key)?.takeIf { it.isNotBlank() }
      ?: throw PublishException("INVALID_REQUEST", "$key is required")
    else throw PublishException("INVALID_REQUEST", "$key is required")

  private fun requireNonNegativeLong(map: ReadableMap, key: String): Long {
    if (!map.hasKey(key) || map.isNull(key)) throw PublishException("INVALID_REQUEST", "$key is required")
    val value = map.getDouble(key)
    if (!value.isFinite() || value < 0 || value % 1.0 != 0.0) throw PublishException("INVALID_REQUEST", "$key is invalid")
    return value.toLong()
  }

  private fun displayName(uri: Uri, resolveTreeRoot: Boolean = false): String? = try {
    val document = if (resolveTreeRoot && DocumentsContract.isTreeUri(uri)) {
      DocumentsContract.buildDocumentUriUsingTree(uri, DocumentsContract.getTreeDocumentId(uri))
    } else uri
    reactContext.contentResolver.query(document, arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null)
      .use { cursor ->
        if (cursor != null && cursor.moveToFirst()) cursor.stringOrNull(OpenableColumns.DISPLAY_NAME) else null
      }
  } catch (_: Exception) {
    null
  }

  private fun releaseOldPermission(uri: Uri) {
    try {
      reactContext.contentResolver.releasePersistableUriPermission(
        uri,
        Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_GRANT_WRITE_URI_PERMISSION
      )
    } catch (_: SecurityException) {
      // A replaced grant may already be gone.
    }
  }

  private fun storedUri(): Uri? = preferences().getString(FOLDER_URI, null)?.let(Uri::parse)

  private fun preferences() = reactContext.getSharedPreferences(PREFERENCES, Activity.MODE_PRIVATE)

  private class PublishException(val code: String, message: String) : Exception(message)

  private fun state(status: String, uri: Uri?, name: String?) = Arguments.createMap().apply {
    putString("status", status)
    if (uri == null) putNull("uri") else putString("uri", uri.toString())
    if (name == null) putNull("name") else putString("name", name)
  }
}
