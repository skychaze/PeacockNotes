package com.roy.peacocknotes

import android.content.ClipData
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReadableArray
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod

class AttachmentShareModule(private val reactContext: ReactApplicationContext) :
  ReactContextBaseJavaModule(reactContext) {

  override fun getName() = "AttachmentShare"

  @ReactMethod
  fun shareMultiple(
    uriValues: ReadableArray,
    mimeValues: ReadableArray,
    mimeType: String,
    dialogTitle: String,
    promise: Promise,
  ) {
    try {
      val uris = ArrayList<Uri>(uriValues.size())
      for (index in 0 until uriValues.size()) {
        val value = uriValues.getString(index)
        if (!value.isNullOrBlank()) {
          uris.add(Uri.parse(value))
        }
      }
      if (uris.isEmpty()) {
        promise.reject("EMPTY_ATTACHMENTS", "At least one attachment is required")
        return
      }

      val mimeTypes = ArrayList<String>(mimeValues.size())
      for (index in 0 until mimeValues.size()) {
        mimeValues.getString(index)?.let(mimeTypes::add)
      }

      val sendIntent = Intent(Intent.ACTION_SEND_MULTIPLE).apply {
        type = mimeType
        putParcelableArrayListExtra(Intent.EXTRA_STREAM, uris)
        if (mimeTypes.isNotEmpty()) {
          putStringArrayListExtra(Intent.EXTRA_MIME_TYPES, mimeTypes)
        }
        addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
        clipData = ClipData.newRawUri("Peacock Notes attachments", uris.first())
        uris.drop(1).forEach { clipData?.addItem(ClipData.Item(it)) }
      }

      val packageManager = reactContext.packageManager
      packageManager.queryIntentActivities(sendIntent, PackageManager.MATCH_DEFAULT_ONLY).forEach { resolveInfo ->
        uris.forEach { uri ->
          reactContext.grantUriPermission(
            resolveInfo.activityInfo.packageName,
            uri,
            Intent.FLAG_GRANT_READ_URI_PERMISSION,
          )
        }
      }

      val activity = reactContext.currentActivity
      if (activity == null) {
        promise.reject("NO_ACTIVITY", "The app is not in the foreground")
        return
      }

      activity.startActivity(Intent.createChooser(sendIntent, dialogTitle))
      promise.resolve(null)
    } catch (error: Exception) {
      promise.reject("SHARE_FAILED", error.message, error)
    }
  }
}
