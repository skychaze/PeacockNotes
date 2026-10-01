package com.roy.peacocknotes

import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import com.facebook.react.bridge.Arguments
import com.facebook.react.HeadlessJsTaskService
import com.facebook.react.jstasks.HeadlessJsTaskConfig
import androidx.core.content.ContextCompat
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.Deferred

class AutomaticBackupTaskService : HeadlessJsTaskService() {
  companion object {
    private const val CHANNEL_ID = "automatic_backup"
    private const val NOTIFICATION_ID = 3202
    private var completion: CompletableDeferred<Unit>? = null

    @Synchronized
    fun start(context: Context): Deferred<Unit> {
      completion?.let { return it }
      val pending = CompletableDeferred<Unit>()
      completion = pending
      try {
        ContextCompat.startForegroundService(context, Intent(context, AutomaticBackupTaskService::class.java))
      } catch (error: Exception) {
        completion = null
        pending.completeExceptionally(error)
        throw error
      }
      return pending
    }
  }

  override fun onCreate() {
    super.onCreate()
    synchronized(Companion) { if (completion == null) completion = CompletableDeferred() }
    val notification = BackupNotifications.builder(this, CHANNEL_ID)
      .setContentText("Automatic backup is continuing")
      .build()
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
      startForeground(NOTIFICATION_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC)
    } else {
      startForeground(NOTIFICATION_ID, notification)
    }
    BackupProgressStore.setNotificationTarget(this, CHANNEL_ID, NOTIFICATION_ID)
  }

  override fun onDestroy() {
    BackupProgressStore.clearNotificationTarget(this)
    stopForeground(STOP_FOREGROUND_REMOVE)
    synchronized(Companion) {
      completion?.complete(Unit)
      completion = null
    }
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

}
