package com.roy.peacocknotes

import android.app.NotificationChannel
import android.app.NotificationManager
import android.content.Context
import android.os.Build
import androidx.core.app.NotificationCompat

object BackupNotifications {
  fun builder(context: Context, channelId: String): NotificationCompat.Builder {
    val manager = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      manager.createNotificationChannel(NotificationChannel(channelId, "Backup progress", NotificationManager.IMPORTANCE_LOW).apply {
        setSound(null, null)
        enableVibration(false)
      })
    }
    return NotificationCompat.Builder(context, channelId)
      .setSmallIcon(android.R.drawable.stat_sys_upload)
      .setContentTitle("Peacock Notes backup")
      .setOngoing(true)
      .setSilent(true)
      .setOnlyAlertOnce(true)
  }
}
