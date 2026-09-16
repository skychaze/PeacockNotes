package com.roy.peacocknotes

import android.app.NotificationChannel
import android.app.NotificationManager
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import androidx.core.app.NotificationCompat
import com.facebook.react.bridge.Arguments
import com.facebook.react.HeadlessJsTaskService
import com.facebook.react.jstasks.HeadlessJsTaskConfig

class AutomaticBackupTaskService : HeadlessJsTaskService() {
  companion object {
    private const val CHANNEL_ID = "automatic_backup"
    private const val NOTIFICATION_ID = 3202
  }

  override fun onCreate() {
    super.onCreate()
    val manager = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      manager.createNotificationChannel(NotificationChannel(
        CHANNEL_ID,
        "Automatic backup",
        NotificationManager.IMPORTANCE_LOW,
      ))
    }
    val notification = NotificationCompat.Builder(this, CHANNEL_ID)
      .setSmallIcon(android.R.drawable.stat_sys_upload)
      .setContentTitle("Peacock Notes")
      .setContentText("Automatic backup is continuing")
      .setOngoing(true)
      .build()
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
      startForeground(NOTIFICATION_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC)
    } else {
      startForeground(NOTIFICATION_ID, notification)
    }
    BackupProgressStore.setNotificationTarget(this, CHANNEL_ID, NOTIFICATION_ID)
  }

  override fun onDestroy() {
    BackupProgressStore.clearNotificationTarget(NOTIFICATION_ID)
    super.onDestroy()
  }

  override fun onTimeout(startId: Int, fgsType: Int) {
    stopForeground(STOP_FOREGROUND_REMOVE)
    stopSelf()
  }

  override fun getTaskConfig(intent: Intent?): HeadlessJsTaskConfig = HeadlessJsTaskConfig(
    "PeacockNotesAutomaticBackup",
    Arguments.createMap(),
    30 * 60 * 1000L,
    true,
  )

  override fun onHeadlessJsTaskFinish(taskId: Int) {
    super.onHeadlessJsTaskFinish(taskId)
    stopForeground(true)
    stopSelf()
  }
}
