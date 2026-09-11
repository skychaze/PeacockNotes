package com.roy.peacocknotes

import android.app.Activity
import android.content.Intent
import android.database.Cursor
import android.net.Uri
import android.provider.OpenableColumns
import com.facebook.react.bridge.ActivityEventListener
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod

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
    if (persistedPermission == null) return state("revoked", uri, displayName(uri))

    return try {
      reactContext.contentResolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null)
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

  private fun displayName(uri: Uri): String? = try {
    reactContext.contentResolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null)
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

  private fun state(status: String, uri: Uri?, name: String?) = Arguments.createMap().apply {
    putString("status", status)
    if (uri == null) putNull("uri") else putString("uri", uri.toString())
    if (name == null) putNull("name") else putString("name", name)
  }
}
