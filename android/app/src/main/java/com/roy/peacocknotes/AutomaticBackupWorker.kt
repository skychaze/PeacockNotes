package com.roy.peacocknotes

import android.content.Context
import android.content.pm.ServiceInfo
import android.os.Build
import androidx.work.CoroutineWorker
import androidx.work.ForegroundInfo
import androidx.work.WorkerParameters
import kotlinx.coroutines.CancellationException

class AutomaticBackupWorker(context: Context, parameters: WorkerParameters) : CoroutineWorker(context, parameters) {
  companion object {
    private const val CHANNEL_ID = "automatic_backup"
    private const val NOTIFICATION_ID = 3202
  }

  override suspend fun doWork(): Result {
    val preferences = applicationContext.getSharedPreferences(
      AutomaticBackupModule.PREFERENCES,
      Context.MODE_PRIVATE,
    )
    if (!preferences.getBoolean(AutomaticBackupModule.ENABLED, false)) return Result.success()

    setForeground(createForegroundInfo())
    return try {
      AutomaticBackupTaskService.start(applicationContext).await()
      Result.success()
    } catch (error: CancellationException) {
      throw error
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
    val notification = BackupNotifications.builder(applicationContext, CHANNEL_ID)
      .setContentText("Automatic backup is continuing")
      .build()
    return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
      ForegroundInfo(NOTIFICATION_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC)
    } else {
      ForegroundInfo(NOTIFICATION_ID, notification)
    }
  }
}
