package com.roy.peacocknotes

import android.os.Build
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod

/** Reports whether Android allows this app to prompt for an APK install. */
class AppUpdaterModule(private val reactContext: ReactApplicationContext) :
  ReactContextBaseJavaModule(reactContext) {

  override fun getName() = "AppUpdater"

  @ReactMethod
  fun canRequestPackageInstalls(promise: Promise) {
    val allowed = Build.VERSION.SDK_INT < Build.VERSION_CODES.O ||
      reactContext.packageManager.canRequestPackageInstalls()
    promise.resolve(allowed)
  }
}
