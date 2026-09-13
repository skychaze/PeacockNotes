package com.roy.peacocknotes

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import androidx.core.app.NotificationCompat
import androidx.core.content.ContextCompat

/** Keeps a user-started export alive when Peacock Notes is no longer visible. */
class ManualBackupForegroundService : Service() {
  companion object {
    const val CHANNEL_ID = "backup_progress"
    const val NOTIFICATION_ID = 3203
  }

  override fun onCreate() {
    super.onCreate()
    startAsForeground()
  }

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    // The explicit start from the visible Backup screen only owns the
    // notification. If Android recreates this sticky service after the app
    // process was killed, launch a headless JS task that resumes the durable
    // operation from SQLite rather than replaying stale intent extras.
    if (intent == null) {
      val recovery = Intent(this, ManualBackupTaskService::class.java)
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
        ContextCompat.startForegroundService(this, recovery)
      } else {
        startService(recovery)
      }
    }
    return START_STICKY
  }

  private fun startAsForeground() {
    val manager = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      manager.createNotificationChannel(NotificationChannel(CHANNEL_ID, "Backup progress", NotificationManager.IMPORTANCE_LOW))
    }
    val notification = NotificationCompat.Builder(this, CHANNEL_ID)
      .setSmallIcon(android.R.drawable.stat_sys_upload)
      .setContentTitle("Peacock Notes backup")
      .setContentText("Preparing backup…")
      .setProgress(100, 0, true)
      .setOngoing(true)
      .setOnlyAlertOnce(true)
      .build()
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
      startForeground(NOTIFICATION_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC)
    } else {
      startForeground(NOTIFICATION_ID, notification)
    }
  }

  override fun onBind(intent: Intent?): IBinder? = null
}
