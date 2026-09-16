package com.roy.peacocknotes

import android.app.NotificationChannel
import android.app.NotificationManager
import android.content.Context
import android.os.Build
import androidx.core.app.NotificationCompat
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.ReadableMap
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.modules.core.DeviceEventManagerModule
import org.json.JSONObject
import java.util.concurrent.ConcurrentHashMap

data class BackupProgressSnapshot(
  val operationId: String,
  val operationKind: String,
  val phase: String,
  val step: String,
  val state: String,
  val bytesDone: Long,
  val bytesTotal: Long?,
  val itemsDone: Int,
  val itemsTotal: Int?,
  val updatedAt: Long,
)

class BackupProgressRegistry(private val now: () -> Long = { System.currentTimeMillis() }) {
  private val listeners = mutableSetOf<(BackupProgressSnapshot?) -> Unit>()
  private var current: BackupProgressSnapshot? = null
  private var lastPublishedAt = 0L

  @Synchronized
  fun begin(operationId: String, operationKind: String, phase: String, step: String, bytesTotal: Long?, itemsTotal: Int?): Boolean {
    if (current?.state == "running" && current?.operationId != operationId) return false
    publish(BackupProgressSnapshot(operationId, operationKind, phase, step, "running", 0, bytesTotal, 0, itemsTotal, now()), true)
    return true
  }

  @Synchronized
  fun startStep(operationId: String, phase: String, step: String, bytesTotal: Long?, itemsTotal: Int?): Boolean {
    val existing = current?.takeIf { it.operationId == operationId } ?: return false
    publish(existing.copy(phase = phase, step = step, bytesDone = 0, bytesTotal = bytesTotal,
      itemsDone = 0, itemsTotal = itemsTotal, updatedAt = now()), true)
    return true
  }

  @Synchronized
  fun update(
    operationId: String,
    phase: String? = null,
    step: String? = null,
    bytesDone: Long? = null,
    bytesTotal: Long? = null,
    itemsDone: Int? = null,
    itemsTotal: Int? = null,
    force: Boolean = false,
  ): Boolean {
    val existing = current?.takeIf { it.operationId == operationId } ?: return false
    val next = existing.copy(
      phase = phase ?: existing.phase, step = step ?: existing.step,
      bytesDone = (bytesDone ?: existing.bytesDone).coerceAtLeast(0),
      bytesTotal = bytesTotal ?: existing.bytesTotal,
      itemsDone = (itemsDone ?: existing.itemsDone).coerceAtLeast(0),
      itemsTotal = itemsTotal ?: existing.itemsTotal, updatedAt = now(),
    )
    publish(next, force || next.phase != existing.phase || next.step != existing.step)
    return true
  }

  @Synchronized
  fun add(operationId: String, bytes: Long = 0, items: Int = 0) {
    val existing = current?.takeIf { it.operationId == operationId } ?: return
    update(operationId, bytesDone = existing.bytesDone + bytes, itemsDone = existing.itemsDone + items)
  }

  @Synchronized
  fun finish(operationId: String, state: String): Boolean {
    val existing = current?.takeIf { it.operationId == operationId } ?: return false
    current = null
    emit(existing.copy(state = state, updatedAt = now()))
    emit(null)
    return true
  }

  @Synchronized
  fun snapshot(operationId: String? = null): BackupProgressSnapshot? =
    current?.takeIf { operationId == null || it.operationId == operationId }

  @Synchronized
  fun restore(snapshot: BackupProgressSnapshot) {
    if (current == null) current = snapshot
  }

  @Synchronized
  fun subscribe(listener: (BackupProgressSnapshot?) -> Unit): () -> Unit {
    listeners += listener
    return { synchronized(this) { listeners -= listener } }
  }

  private fun publish(snapshot: BackupProgressSnapshot, force: Boolean) {
    current = snapshot
    if (force || snapshot.updatedAt - lastPublishedAt >= 250L) {
      lastPublishedAt = snapshot.updatedAt
      emit(snapshot)
    }
  }

  private fun emit(snapshot: BackupProgressSnapshot?) {
    listeners.toList().forEach { callback -> runCatching { callback(snapshot) } }
  }
}

class BackupProgressReporter(
  private val operationId: String?,
  private val operationKind: String?,
) {
  fun startStep(phase: String, step: String, bytesTotal: Long? = null, itemsTotal: Int? = null): Boolean =
    if (operationId == null) false
    else BackupProgressStore.registry.startStep(operationId, phase, step, bytesTotal, itemsTotal)

  fun update(
    phase: String? = null,
    step: String? = null,
    bytesDone: Long? = null,
    bytesTotal: Long? = null,
    itemsDone: Int? = null,
    itemsTotal: Int? = null,
    force: Boolean = false,
  ): Boolean = if (operationId == null) false else BackupProgressStore.registry.update(
    operationId, phase, step, bytesDone, bytesTotal, itemsDone, itemsTotal, force,
  )

  fun addBytes(bytes: Long) {
    if (operationId == null) return
    BackupProgressStore.registry.add(operationId, bytes = bytes)
  }

  fun addItem() {
    if (operationId == null) return
    BackupProgressStore.registry.add(operationId, items = 1)
  }

}

fun progressReporter(request: ReadableMap): BackupProgressReporter = BackupProgressReporter(
  request.optionalString("operationId"),
  request.optionalString("operationKind"),
)

object BackupProgressStore {
  private const val PREFERENCES = "peacock_notes_backup_progress"
  private const val ACTIVE = "active"
  private const val EVENT = "backupProgress"

  val registry = BackupProgressRegistry()
  private var context: ReactApplicationContext? = null
  private val notificationTargets = ConcurrentHashMap<Int, NotificationTarget>()
  private var unsubscribe: (() -> Unit)? = null

  @Synchronized
  fun attach(reactContext: ReactApplicationContext) {
    if (context === reactContext) return
    unsubscribe?.invoke()
    context = reactContext
    unsubscribe = registry.subscribe { snapshot ->
      persist(snapshot)
      notificationTargets.values.forEach { target -> runCatching { notify(target, snapshot) } }
      val payload = snapshot?.toWritableMap()
      reactContext.runOnJSQueueThread {
        if (!reactContext.hasActiveReactInstance()) return@runOnJSQueueThread
        reactContext.getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java).emit(EVENT, payload)
      }
    }
    if (registry.snapshot() == null) restorePersisted()
  }

  @Synchronized
  fun detach(reactContext: ReactApplicationContext) {
    if (context !== reactContext) return
    unsubscribe?.invoke()
    unsubscribe = null
    context = null
  }

  fun snapshot(operationId: String? = null): BackupProgressSnapshot? = registry.snapshot(operationId)


  fun setNotificationTarget(context: Context, channelId: String, notificationId: Int) {
    val target = NotificationTarget(context.applicationContext, channelId, notificationId)
    notificationTargets[notificationId] = target
    registry.snapshot()?.let { notify(target, it) }
  }

  fun clearNotificationTarget(notificationId: Int) {
    notificationTargets.remove(notificationId)
  }

  private fun persist(snapshot: BackupProgressSnapshot?) {
    val reactContext = context ?: return
    val preferences = reactContext.getSharedPreferences(PREFERENCES, Context.MODE_PRIVATE)
    if (snapshot == null || snapshot.state != "running" || snapshot.operationKind == "scan" || snapshot.operationKind == "preview") {
      preferences.edit().remove(ACTIVE).apply()
      return
    }
    preferences.edit().putString(ACTIVE, JSONObject().apply {
      put("operationId", snapshot.operationId)
      put("operationKind", snapshot.operationKind)
      put("phase", snapshot.phase)
      put("step", snapshot.step)
      put("updatedAt", snapshot.updatedAt)
    }.toString()).apply()
  }

  private fun restorePersisted() {
    val reactContext = context ?: return
    val preferences = reactContext.getSharedPreferences(PREFERENCES, Context.MODE_PRIVATE)
    val raw = preferences.getString(ACTIVE, null) ?: return
    val restored = runCatching {
      val json = JSONObject(raw)
      BackupProgressSnapshot(
        operationId = json.getString("operationId"),
        operationKind = json.getString("operationKind"),
        phase = "resuming",
        step = "resuming",
        state = "interrupted",
        bytesDone = 0L,
        bytesTotal = null,
        itemsDone = 0,
        itemsTotal = null,
        updatedAt = System.currentTimeMillis(),
      )
    }.getOrNull() ?: return
    registry.restore(restored)
  }

  private fun notify(target: NotificationTarget, snapshot: BackupProgressSnapshot?) {
    val manager = target.context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      manager.createNotificationChannel(NotificationChannel(target.channelId, "Backup progress", NotificationManager.IMPORTANCE_LOW))
    }
    if (snapshot == null) {
      return
    }
    val knownProgress = (snapshot.bytesTotal != null && snapshot.bytesTotal > 0L) ||
      (snapshot.bytesTotal == null && snapshot.itemsTotal != null && snapshot.itemsTotal > 0)
    val percent = when {
      snapshot.bytesTotal != null && snapshot.bytesTotal > 0L ->
        (snapshot.bytesDone * 100L / snapshot.bytesTotal).toInt().coerceIn(0, 100)
      snapshot.itemsTotal != null && snapshot.itemsTotal > 0 ->
        (snapshot.itemsDone * 100L / snapshot.itemsTotal).toInt().coerceIn(0, 100)
      else -> 0
    }
    if (snapshot.state != "running") {
      manager.notify(target.notificationId, NotificationCompat.Builder(target.context, target.channelId)
        .setSmallIcon(android.R.drawable.stat_sys_upload)
        .setContentTitle("Peacock Notes backup")
        .setContentText("Finishing backup")
        .setProgress(0, 0, true)
        .setOngoing(true)
        .setOnlyAlertOnce(true)
        .build())
      return
    }
    val detail = if (snapshot.bytesTotal != null && snapshot.bytesTotal > 0L) {
      "${snapshot.bytesDone} / ${snapshot.bytesTotal} bytes"
    } else if (snapshot.itemsTotal != null) {
      "${snapshot.itemsDone} / ${snapshot.itemsTotal} items"
    } else {
      "Working"
    }
    manager.notify(target.notificationId, NotificationCompat.Builder(target.context, target.channelId)
      .setSmallIcon(android.R.drawable.stat_sys_upload)
      .setContentTitle("Peacock Notes backup")
      .setContentText("${snapshot.step.replace('_', ' ').replaceFirstChar { it.uppercase() }} · $detail")
      .setProgress(if (knownProgress) 100 else 0, percent, !knownProgress)
      .setOngoing(true)
      .setOnlyAlertOnce(true)
      .build())
  }

  private data class NotificationTarget(val context: Context, val channelId: String, val notificationId: Int)
}

fun BackupProgressSnapshot.toWritableMap() = Arguments.createMap().apply {
  putString("operationId", operationId)
  putString("operationKind", operationKind)
  putString("phase", phase)
  putString("step", step)
  putString("state", state)
  putDouble("bytesDone", bytesDone.toDouble())
  if (bytesTotal == null) putNull("bytesTotal") else putDouble("bytesTotal", bytesTotal.toDouble())
  putInt("itemsDone", itemsDone)
  if (itemsTotal == null) putNull("itemsTotal") else putInt("itemsTotal", itemsTotal)
  putDouble("updatedAt", updatedAt.toDouble())
}

fun ReadableMap.optionalString(key: String): String? = if (hasKey(key) && !isNull(key)) getString(key) else null
