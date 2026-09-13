package com.roy.peacocknotes

import android.app.Activity
import android.app.NotificationChannel
import android.app.NotificationManager
import android.content.Intent
import android.content.Context
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.net.Uri
import android.util.Log
import androidx.core.app.NotificationCompat
import androidx.core.content.ContextCompat
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.ActivityEventListener
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReadableMap
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import java.io.File
import java.util.concurrent.Executors

/** Preserves the JS BackupFolder API while backing it with Google Drive OAuth. */
class BackupFolderModule(private val reactContext: ReactApplicationContext) :
  ReactContextBaseJavaModule(reactContext), ActivityEventListener {

  companion object {
    const val PREFERENCES = "peacock_notes_backup_folder"
    const val FOLDER_URI = "folder_uri"
    private const val FOLDER_NAME = "Peacock Notes Backups"
    private const val AUTH_REQUEST = 9402
    private const val AUTH_TIMEOUT_MILLIS = 120_000L
    private const val BACKUP_CHANNEL_ID = ManualBackupForegroundService.CHANNEL_ID
    private const val BACKUP_NOTIFICATION_ID = ManualBackupForegroundService.NOTIFICATION_ID
  }

  private val executor = Executors.newSingleThreadExecutor()
  private val mainHandler = Handler(Looper.getMainLooper())
  private var pending: Promise? = null
  private var authorizationTimeout: Runnable? = null

  init {
    reactContext.addActivityEventListener(this)
  }

  override fun getName() = "BackupFolder"

  @ReactMethod
  fun getFolderState(promise: Promise) = executor.execute {
    val saved = saved()
    if (saved == null) {
      promise.resolve(state("disconnected", null, null))
      return@execute
    }
    runCatching {
      DriveClient(reactContext).folder(saved.first)
      state("connected", DriveClient.uri(saved.first), saved.second)
    }.onSuccess(promise::resolve).onFailure {
      val status = if ((it as? DriveException)?.code == "DRIVE_AUTH_REQUIRED") "revoked" else "unavailable"
      promise.resolve(state(status, DriveClient.uri(saved.first), saved.second))
    }
  }

  @ReactMethod
  fun chooseFolder(promise: Promise) {
    if (pending != null) {
      promise.reject("PICKER_ACTIVE", "Google authorization is already open.")
      return
    }
    val activity = reactContext.currentActivity
    if (activity == null) {
      promise.reject("ACTIVITY_UNAVAILABLE", "Google authorization is unavailable.")
      return
    }
    pending = promise
    authorizationTimeout = Runnable {
      rejectAuthorization(DriveException("DRIVE_AUTH_TIMEOUT", "Google Drive authorization timed out."))
    }.also { mainHandler.postDelayed(it, AUTH_TIMEOUT_MILLIS) }
    try {
      DriveClient(reactContext).beginAuthorization(
        activity,
        AUTH_REQUEST,
        completed = ::finishAuthorization,
        failed = ::rejectAuthorization,
      )
    } catch (error: Throwable) {
      rejectAuthorization(asDriveException(error, "DRIVE_AUTH_FAILED"))
    }
  }

  @ReactMethod
  fun publishArchive(request: ReadableMap, promise: Promise) = executor.execute {
    runCatching {
      val folder = saved() ?: throw DriveException("FOLDER_NOT_CONNECTED", "Google Drive is not connected.")
      val staged = Uri.parse(string(request, "stagedUri"))
      val sourcePath = staged.path.takeIf { staged.scheme == "file" }
      val source: File = sourcePath?.let(::File)
        ?: throw DriveException("STAGING_MISSING", "The staged archive is not a local file.")
      val expected = request.getDouble("expectedBytes").toLong()
      if (!source.isFile || source.length() != expected) {
        throw DriveException("STAGING_MISSING", "The staged archive is missing.")
      }
      val displayName = string(request, "displayName")
      val drive = DriveClient(reactContext)
      val item = try {
        drive.uploadResumable(
          folder.first,
          displayName,
          source,
          "application/octet-stream",
        )
      } catch (uploadError: Throwable) {
        // A resumable PUT can commit remotely and then lose its response to a
        // socket timeout/process interruption. Reconcile the deterministic
        // operation name before reporting failure; this is the idempotency
        // boundary for an otherwise-unknown upload outcome.
        val reconciled = runCatching {
          drive.list(folder.first).firstOrNull { it.name == displayName && it.size == expected }
        }.getOrNull()
        if (reconciled == null) throw uploadError
        Log.i(
          "BackupRuntime",
          "[DEBUG-BR-DRIVE] publish_reconciled id=${reconciled.id} bytes=${reconciled.size}",
        )
        reconciled
      }
      Log.i("BackupRuntime", "[DEBUG-BR-DRIVE] publish_acknowledged id=${item.id} bytes=${item.size}")
      if (item.size != expected) {
        runCatching { DriveClient(reactContext).delete(item.id) }
        throw DriveException("PARTIAL_WRITE", "Google Drive stored an incomplete archive.")
      }
      Arguments.createMap().apply {
        putString("uri", DriveClient.uri(item.id))
        putString("name", item.name)
      }
    }.onSuccess(promise::resolve).onFailure { error ->
      promise.reject((error as? DriveException)?.code ?: "DRIVE_UPLOAD_FAILED", error.message, error)
    }
  }

  /** Keeps the user informed while a foreground export is being staged, uploaded, and verified. */
  @ReactMethod
  fun startBackupForegroundService(promise: Promise) {
    try {
      ContextCompat.startForegroundService(
        reactContext,
        Intent(reactContext, ManualBackupForegroundService::class.java),
      )
      promise.resolve(null)
    } catch (error: Exception) {
      promise.reject("FOREGROUND_START_FAILED", error.message, error)
    }
  }

  @ReactMethod
  fun updateBackupNotification(message: String, progress: Double) {
    val manager = reactContext.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      manager.createNotificationChannel(NotificationChannel(
        BACKUP_CHANNEL_ID,
        "Backup progress",
        NotificationManager.IMPORTANCE_LOW,
      ))
    }
    val percent = progress.toInt().coerceIn(0, 100)
    manager.notify(BACKUP_NOTIFICATION_ID, NotificationCompat.Builder(reactContext, BACKUP_CHANNEL_ID)
      .setSmallIcon(android.R.drawable.stat_sys_upload)
      .setContentTitle("Peacock Notes backup")
      .setContentText("$message ($percent%)")
      .setProgress(100, percent, false)
      .setOngoing(true)
      .setOnlyAlertOnce(true)
      .build())
  }

  @ReactMethod
  fun finishBackupNotification(success: Boolean) {
    val manager = reactContext.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
    manager.cancel(BACKUP_NOTIFICATION_ID)
    reactContext.stopService(Intent(reactContext, ManualBackupForegroundService::class.java))
    reactContext.stopService(Intent(reactContext, ManualBackupTaskService::class.java))
  }

  @ReactMethod
  fun disconnect(promise: Promise) {
    prefs().edit().clear().apply()
    promise.resolve(state("disconnected", null, null))
  }

  override fun onActivityResult(activity: Activity, code: Int, result: Int, data: Intent?) {
    if (code != AUTH_REQUEST) return
    if (result != Activity.RESULT_OK || data == null) {
      rejectAuthorization(DriveException("PICKER_CANCELLED", "Google Drive authorization was cancelled."))
      return
    }
    try {
      finishAuthorization(DriveClient(reactContext).completeAuthorization(data))
    } catch (error: Throwable) {
      rejectAuthorization(asDriveException(error, "DRIVE_AUTH_FAILED"))
    }
  }

  override fun onNewIntent(intent: Intent) = Unit

  private fun finishAuthorization(token: String) {
    val promise = pending ?: return
    pending = null
    clearAuthorizationTimeout()
    executor.execute {
      runCatching {
        Log.i("BackupRuntime", "[DEBUG-BR-AUTH] authorization_acknowledged; resolving backup folder")
        val folder = DriveClient(reactContext) { token }.findOrCreateFolder(FOLDER_NAME)
        prefs().edit()
          .putString(FOLDER_URI, DriveClient.uri(folder.id))
          .putString("folder_name", folder.name)
          .apply()
        state("connected", DriveClient.uri(folder.id), folder.name)
      }.onSuccess(promise::resolve).onFailure { error ->
        promise.reject((error as? DriveException)?.code ?: "DRIVE_AUTH_FAILED", error.message, error)
      }
    }
  }

  private fun rejectAuthorization(error: DriveException) {
    pending?.also {
      pending = null
      clearAuthorizationTimeout()
      it.reject(error.code, error.message, error)
    }
  }

  private fun clearAuthorizationTimeout() {
    authorizationTimeout?.let(mainHandler::removeCallbacks)
    authorizationTimeout = null
  }

  private fun asDriveException(error: Throwable, fallbackCode: String) =
    (error as? DriveException) ?: DriveException(fallbackCode, error.message ?: "Google Drive authorization failed.", error)

  private fun saved(): Pair<String, String>? {
    val uri = prefs().getString(FOLDER_URI, null) ?: return null
    val id = DriveClient.idFromUri(uri) ?: return null
    return id to (prefs().getString("folder_name", null) ?: FOLDER_NAME)
  }

  private fun prefs() = reactContext.getSharedPreferences(PREFERENCES, Activity.MODE_PRIVATE)

  private fun string(map: ReadableMap, key: String) =
    map.getString(key)?.takeIf { it.isNotBlank() }
      ?: throw DriveException("INVALID_REQUEST", "$key is required")

  private fun state(status: String, uri: String?, name: String?) = Arguments.createMap().apply {
    putString("status", status)
    if (uri == null) putNull("uri") else putString("uri", uri)
    if (name == null) putNull("name") else putString("name", name)
  }
}
