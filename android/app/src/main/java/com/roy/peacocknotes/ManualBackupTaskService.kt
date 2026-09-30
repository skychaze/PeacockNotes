package com.roy.peacocknotes

import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import com.facebook.react.HeadlessJsTaskService
import com.facebook.react.bridge.Arguments
import com.facebook.react.jstasks.HeadlessJsTaskConfig

class ManualBackupTaskService : HeadlessJsTaskService() {
  override fun onCreate() {
    super.onCreate()
    val notification = BackupNotifications.builder(this, ManualBackupForegroundService.CHANNEL_ID)
      .setContentText("Resuming backup")
      .setProgress(100, 0, true)
      .build()
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
      startForeground(
        ManualBackupForegroundService.NOTIFICATION_ID,
        notification,
        ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC,
      )
    } else {
      startForeground(ManualBackupForegroundService.NOTIFICATION_ID, notification)
    }
    BackupProgressStore.setNotificationTarget(this, ManualBackupForegroundService.CHANNEL_ID, ManualBackupForegroundService.NOTIFICATION_ID)
  }

  override fun onDestroy() {
    BackupProgressStore.clearNotificationTarget(this)
    super.onDestroy()
  }

  override fun onTimeout(startId: Int, fgsType: Int) {
    stopForeground(STOP_FOREGROUND_REMOVE)
    stopSelf()
  }

  override fun getTaskConfig(intent: Intent?): HeadlessJsTaskConfig = HeadlessJsTaskConfig(
    "PeacockNotesManualBackup",
    Arguments.createMap(),
    30 * 60 * 1000L,
    true,
  )

  override fun onHeadlessJsTaskFinish(taskId: Int) {
    stopForeground(STOP_FOREGROUND_DETACH)
    super.onHeadlessJsTaskFinish(taskId)
  }
}
