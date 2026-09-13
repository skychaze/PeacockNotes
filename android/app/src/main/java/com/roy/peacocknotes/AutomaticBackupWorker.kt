package com.roy.peacocknotes

import android.app.NotificationChannel
import android.app.NotificationManager
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.work.CoroutineWorker
import androidx.work.ForegroundInfo
import androidx.work.WorkerParameters

class AutomaticBackupWorker(context: Context, parameters: WorkerParameters) : CoroutineWorker(context, parameters) {
  companion object {
    private const val CHANNEL_ID = "automatic_backup"
    private const val NOTIFICATION_ID = 3201
  }

  override suspend fun doWork(): Result {
    val preferences = applicationContext.getSharedPreferences(
      AutomaticBackupModule.PREFERENCES,
      Context.MODE_PRIVATE,
    )
    if (!preferences.getBoolean(AutomaticBackupModule.ENABLED, false)) return Result.success()

    setForeground(createForegroundInfo())
    return try {
      val intent = Intent(applicationContext, AutomaticBackupTaskService::class.java)
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
        applicationContext.startForegroundService(intent)
      } else {
        applicationContext.startService(intent)
      }
      Result.success()
    } catch (error: Exception) {
      AutomaticBackupModule.writeStatus(
        applicationContext,
        if (runAttemptCount < 2) "retrying" else "failed",
        runAttemptCount + 1,
        "BACKGROUND_START_FAILED",
      )
      if (runAttemptCount < 2) Result.retry() else Result.failure()
    }
  }

  override suspend fun getForegroundInfo(): ForegroundInfo = createForegroundInfo()

  private fun createForegroundInfo(): ForegroundInfo {
    val manager = applicationContext.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      manager.createNotificationChannel(NotificationChannel(
        CHANNEL_ID,
        "Automatic backup",
        NotificationManager.IMPORTANCE_LOW,
      ))
    }
    val notification = NotificationCompat.Builder(applicationContext, CHANNEL_ID)
      .setSmallIcon(android.R.drawable.stat_sys_upload)
      .setContentTitle("Peacock Notes")
      .setContentText("Automatic backup is continuing")
      .setOngoing(true)
      .build()
    return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
      ForegroundInfo(NOTIFICATION_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC)
    } else {
      ForegroundInfo(NOTIFICATION_ID, notification)
    }
  }
}
