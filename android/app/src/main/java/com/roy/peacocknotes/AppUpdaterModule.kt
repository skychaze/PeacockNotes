package com.roy.peacocknotes

import android.app.DownloadManager
import android.content.Context
import android.net.Uri
import android.os.Build
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.WritableMap
import java.io.File

class AppUpdaterModule(private val reactContext: ReactApplicationContext) :
  ReactContextBaseJavaModule(reactContext) {

  private val manager = reactContext.getSystemService(Context.DOWNLOAD_SERVICE) as DownloadManager
  private val preferences = reactContext.getSharedPreferences("app_update_download", Context.MODE_PRIVATE)

  override fun getName() = "AppUpdater"

  @ReactMethod
  fun canRequestPackageInstalls(promise: Promise) {
    val allowed = Build.VERSION.SDK_INT < Build.VERSION_CODES.O ||
      reactContext.packageManager.canRequestPackageInstalls()
    promise.resolve(allowed)
  }

  @ReactMethod
  fun startDownload(url: String, fileName: String, versionCode: Int, sizeBytes: Double, promise: Promise) {
    try {
      require(url.startsWith("https://"))
      require(Regex("^peacocknotes-v[^/]+-[0-9]+\\.apk$").matches(fileName))
      require(versionCode > 0 && sizeBytes > 0 && sizeBytes.toLong().toDouble() == sizeBytes)

      val existing = readStatus()
      if (preferences.getInt("versionCode", 0) == versionCode &&
          existing.getString("state") != "failed" && existing.getString("state") != "missing") {
        promise.resolve(existing)
        return
      }
      removeDownload()

      val directory = File(checkNotNull(reactContext.getExternalFilesDir(null)), "updates")
      check(directory.isDirectory || directory.mkdirs())
      val request = DownloadManager.Request(Uri.parse(url))
        .setTitle("Peacock Notes update")
        .setMimeType("application/vnd.android.package-archive")
        .setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED)
        .setDestinationInExternalFilesDir(reactContext, null, "updates/$fileName")
      val id = manager.enqueue(request)
      val saved = preferences.edit()
        .putLong("id", id)
        .putInt("versionCode", versionCode)
        .putLong("sizeBytes", sizeBytes.toLong())
        .commit()
      if (!saved) {
        manager.remove(id)
        error("Could not save the download ID")
      }
      val result = Arguments.createMap()
      result.putString("state", "downloading")
      result.putInt("versionCode", versionCode)
      result.putDouble("progress", 0.0)
      promise.resolve(result)
    } catch (error: Exception) {
      promise.reject("DOWNLOAD_START_FAILED", error)
    }
  }

  @ReactMethod
  fun getDownloadStatus(promise: Promise) {
    try {
      promise.resolve(readStatus())
    } catch (error: Exception) {
      promise.reject("DOWNLOAD_STATUS_FAILED", error)
    }
  }

  private fun readStatus(): WritableMap {
    val result = Arguments.createMap()
    val id = preferences.getLong("id", -1)
    if (id < 0) {
      result.putString("state", "missing")
      return result
    }

    val versionCode = preferences.getInt("versionCode", 0)
    val installedCode = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
      reactContext.packageManager.getPackageInfo(reactContext.packageName, 0).longVersionCode
    } else {
      @Suppress("DEPRECATION")
      reactContext.packageManager.getPackageInfo(reactContext.packageName, 0).versionCode.toLong()
    }
    if (installedCode >= versionCode) {
      removeDownload()
      result.putString("state", "missing")
      return result
    }

    manager.query(DownloadManager.Query().setFilterById(id)).use { cursor ->
      if (!cursor.moveToFirst()) {
        preferences.edit().clear().apply()
        result.putString("state", "missing")
        return result
      }
      val status = cursor.getInt(cursor.getColumnIndexOrThrow(DownloadManager.COLUMN_STATUS))
      val written = cursor.getLong(cursor.getColumnIndexOrThrow(DownloadManager.COLUMN_BYTES_DOWNLOADED_SO_FAR))
      val expected = preferences.getLong("sizeBytes", 0)
      result.putInt("versionCode", versionCode)
      result.putDouble("progress", if (expected > 0) (written.toDouble() / expected).coerceIn(0.0, 1.0) else 0.0)
      when (status) {
        DownloadManager.STATUS_SUCCESSFUL -> {
          val uri = manager.getUriForDownloadedFile(id)
          val actualSize = runCatching { manager.openDownloadedFile(id).use { it.statSize } }.getOrDefault(-1)
          if (uri != null && actualSize == expected) {
            result.putString("state", "ready")
            result.putString("uri", uri.toString())
            result.putDouble("progress", 1.0)
          } else {
            removeDownload()
            result.putString("state", "failed")
          }
        }
        DownloadManager.STATUS_FAILED -> {
          removeDownload()
          result.putString("state", "failed")
        }
        DownloadManager.STATUS_PAUSED -> {
          result.putString("state", "paused")
          val reason = cursor.getInt(cursor.getColumnIndexOrThrow(DownloadManager.COLUMN_REASON))
          result.putString("reason", if (reason == DownloadManager.PAUSED_QUEUED_FOR_WIFI) "wifi" else "network")
        }
        else -> result.putString("state", "downloading")
      }
    }
    return result
  }

  private fun removeDownload() {
    val id = preferences.getLong("id", -1)
    if (id >= 0) manager.remove(id)
    preferences.edit().clear().apply()
  }
}
