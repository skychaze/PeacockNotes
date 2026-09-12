package com.roy.peacocknotes

import android.content.Context
import android.net.ConnectivityManager
import android.net.NetworkCapabilities
import android.os.BatteryManager
import androidx.work.BackoffPolicy
import androidx.work.Constraints
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.NetworkType
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import java.util.concurrent.TimeUnit

class AutomaticBackupModule(private val context: ReactApplicationContext) : ReactContextBaseJavaModule(context) {
  companion object {
    const val PREFERENCES = "peacock_notes_automatic_backup"
    const val ENABLED = "enabled"
    const val PHASE = "phase"
    const val ATTEMPT = "attempt"
    const val ERROR_CODE = "error_code"
    const val UPDATED_AT = "updated_at"
    const val WORK_NAME = "peacock-notes-automatic-backup"
    private const val MAX_RETRY_ATTEMPTS = 3

    fun schedule(context: Context) {
      val constraints = Constraints.Builder()
        .setRequiredNetworkType(NetworkType.CONNECTED)
        .setRequiresBatteryNotLow(true)
        .build()
      val work = PeriodicWorkRequestBuilder<AutomaticBackupWorker>(24, TimeUnit.HOURS, 1, TimeUnit.HOURS)
        .setConstraints(constraints)
        .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, 15, TimeUnit.MINUTES)
        .build()
      WorkManager.getInstance(context).enqueueUniquePeriodicWork(
        WORK_NAME,
        ExistingPeriodicWorkPolicy.UPDATE,
        work,
      )
    }

    fun cancel(context: Context) = WorkManager.getInstance(context).cancelUniqueWork(WORK_NAME)

    fun writeStatus(context: Context, phase: String, attempt: Int, errorCode: String?) {
      context.getSharedPreferences(PREFERENCES, Context.MODE_PRIVATE).edit()
        .putString(PHASE, phase)
        .putInt(ATTEMPT, attempt.coerceIn(0, MAX_RETRY_ATTEMPTS))
        .putString(ERROR_CODE, errorCode)
        .putLong(UPDATED_AT, System.currentTimeMillis())
        .apply()
    }
  }

  override fun getName() = "AutomaticBackup"

  @ReactMethod
  fun getState(promise: Promise) = promise.resolve(state())

  @ReactMethod
  fun setEnabled(enabled: Boolean, promise: Promise) {
    preferences().edit().putBoolean(ENABLED, enabled).apply()
    if (enabled) {
      writeStatus(context, "not_due", 0, null)
      schedule(context)
    } else {
      cancel(context)
      writeStatus(context, "disabled", 0, null)
    }
    promise.resolve(state())
  }

  @ReactMethod
  fun setStatus(phase: String, attempt: Double, errorCode: String?, promise: Promise) {
    writeStatus(context, phase, attempt.toInt(), errorCode)
    promise.resolve(null)
  }

  @ReactMethod
  fun constraintsMet(promise: Promise) {
    val connectivity = context.getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager
    val network = connectivity.activeNetwork
    val capabilities = network?.let(connectivity::getNetworkCapabilities)
    val connected = capabilities?.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET) == true &&
      capabilities.hasCapability(NetworkCapabilities.NET_CAPABILITY_VALIDATED)
    val battery = context.getSystemService(Context.BATTERY_SERVICE) as BatteryManager
    val batteryOkay = battery.isCharging ||
      battery.getIntProperty(BatteryManager.BATTERY_PROPERTY_CAPACITY) > 15
    promise.resolve(Arguments.createMap().apply {
      putBoolean("connected", connected)
      putBoolean("batteryOkay", batteryOkay)
    })
  }

  private fun preferences() = context.getSharedPreferences(PREFERENCES, Context.MODE_PRIVATE)

  private fun state() = Arguments.createMap().apply {
    val preferences = preferences()
    val enabled = preferences.getBoolean(ENABLED, false)
    putBoolean("enabled", enabled)
    putString("phase", if (enabled) preferences.getString(PHASE, "not_due") else "disabled")
    putInt("attempt", preferences.getInt(ATTEMPT, 0))
    val error = preferences.getString(ERROR_CODE, null)
    if (error == null) putNull("errorCode") else putString("errorCode", error)
    val updated = preferences.getLong(UPDATED_AT, 0)
    if (updated == 0L) putNull("updatedAt") else putDouble("updatedAt", updated.toDouble())
  }
}
