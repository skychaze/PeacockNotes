package com.roy.peacocknotes

import android.app.Activity
import android.content.Intent
import android.net.Uri
import android.provider.DocumentsContract
import com.facebook.react.bridge.ActivityEventListener
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReadableArray
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import java.io.IOException
import java.util.concurrent.Executors

/** Saves app-private attachments into a user-selected device folder. */
class AttachmentDownloadModule(private val reactContext: ReactApplicationContext) :
  ReactContextBaseJavaModule(reactContext), ActivityEventListener {

  companion object {
    private const val PICK_FOLDER_REQUEST = 9404
  }

  private data class PendingDownload(
    val sourceUris: List<String>,
    val fileNames: List<String>,
    val mimeTypes: List<String>,
    val promise: Promise,
  )

  private val executor = Executors.newSingleThreadExecutor()
  private var pending: PendingDownload? = null

  init {
    reactContext.addActivityEventListener(this)
  }

  override fun getName() = "AttachmentDownload"

  override fun invalidate() {
    executor.shutdownNow()
    super.invalidate()
  }

  @ReactMethod
  fun saveMultiple(
    sourceValues: ReadableArray,
    fileNameValues: ReadableArray,
    mimeTypeValues: ReadableArray,
    promise: Promise,
  ) {
    if (pending != null) {
      promise.reject("DOWNLOAD_BUSY", "Another attachment download is already open.")
      return
    }

    val sourceUris = strings(sourceValues)
    val fileNames = strings(fileNameValues)
    val mimeTypes = strings(mimeTypeValues)
    if (sourceUris.isEmpty() || sourceUris.size != fileNames.size || sourceUris.size != mimeTypes.size) {
      promise.reject("INVALID_DOWNLOAD", "Attachment download data is incomplete.")
      return
    }

    val activity = reactContext.currentActivity
    if (activity == null) {
      promise.reject("ACTIVITY_UNAVAILABLE", "The device folder picker is unavailable.")
      return
    }

    pending = PendingDownload(sourceUris, fileNames, mimeTypes, promise)
    try {
      val intent = Intent(Intent.ACTION_OPEN_DOCUMENT_TREE).apply {
        addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
        addFlags(Intent.FLAG_GRANT_WRITE_URI_PERMISSION)
        addFlags(Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION)
      }
      activity.startActivityForResult(intent, PICK_FOLDER_REQUEST)
    } catch (error: Throwable) {
      pending = null
      promise.reject("DOWNLOAD_PICKER_FAILED", error.message, error)
    }
  }

  override fun onActivityResult(activity: Activity, requestCode: Int, resultCode: Int, data: Intent?) {
    if (requestCode != PICK_FOLDER_REQUEST) return

    val request = pending ?: return
    pending = null
    if (resultCode != Activity.RESULT_OK || data?.data == null) {
      resolveResult(request.promise, savedCount = 0, failedCount = 0, cancelled = true)
      return
    }

    val treeUri = data.data!!
    runCatching {
      val takeFlags = data.flags and
        (Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_GRANT_WRITE_URI_PERMISSION)
      if (takeFlags != 0) {
        reactContext.contentResolver.takePersistableUriPermission(treeUri, takeFlags)
      }
    }

    executor.execute {
      var savedCount = 0
      var failedCount = 0
      for (index in request.sourceUris.indices) {
        try {
          saveFile(
            treeUri = treeUri,
            sourceUri = Uri.parse(request.sourceUris[index]),
            fileName = request.fileNames[index],
            mimeType = request.mimeTypes[index],
          )
          savedCount += 1
        } catch (_: Throwable) {
          failedCount += 1
        }
      }
      resolveResult(request.promise, savedCount, failedCount, cancelled = false)
    }
  }

  override fun onNewIntent(intent: Intent) = Unit

  private fun saveFile(treeUri: Uri, sourceUri: Uri, fileName: String, mimeType: String) {
    val documentId = DocumentsContract.getTreeDocumentId(treeUri)
    val parentUri = DocumentsContract.buildDocumentUriUsingTree(treeUri, documentId)
    val outputUri = DocumentsContract.createDocument(
      reactContext.contentResolver,
      parentUri,
      mimeType.ifBlank { "application/octet-stream" },
      fileName,
    ) ?: throw IOException("Could not create the destination file")

    val resolver = reactContext.contentResolver
    resolver.openInputStream(sourceUri).use { input ->
      resolver.openOutputStream(outputUri, "w").use { output ->
        if (input == null || output == null) throw IOException("Could not open attachment streams")
        input.copyTo(output)
      }
    }
  }

  private fun strings(values: ReadableArray): List<String> = buildList {
    for (index in 0 until values.size()) {
      values.getString(index)?.let(::add)
    }
  }

  private fun resolveResult(promise: Promise, savedCount: Int, failedCount: Int, cancelled: Boolean) {
    val result = Arguments.createMap().apply {
      putInt("savedCount", savedCount)
      putInt("failedCount", failedCount)
      putBoolean("cancelled", cancelled)
    }
    promise.resolve(result)
  }
}
