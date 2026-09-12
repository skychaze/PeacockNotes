package com.roy.peacocknotes

import android.app.NotificationChannel
import android.app.NotificationManager
import android.content.Context
import android.content.Intent
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
    startForeground(NOTIFICATION_ID, notification)
  }

  override fun getTaskConfig(intent: Intent?): HeadlessJsTaskConfig = HeadlessJsTaskConfig(
    "PeacockNotesAutomaticBackup",
    Arguments.createMap(),
    30 * 60 * 1000L,
    true,
  )
}
