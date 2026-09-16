package com.roy.peacocknotes

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.ByteArrayOutputStream
import java.security.MessageDigest

class BackupProgressRegistryTest {
  @Test
  fun newOperationCanReplaceAnInterruptedSnapshotAndIgnoreOldCallbacks() {
    val registry = BackupProgressRegistry { 1000L }
    registry.restore(BackupProgressSnapshot("old", "export", "resuming", "resuming", "interrupted", 0, null, 0, null, 1))
    assertTrue(registry.begin("new", "import", "verify", "files", 100L, null))
    assertFalse(registry.finish("old", "succeeded"))
    assertFalse(registry.update("old", bytesDone = 90L))
    assertEquals("new", registry.snapshot()?.operationId)
  }

  @Test
  fun changingStepsResetsCountersAndUnknownTotals() {
    val registry = BackupProgressRegistry { 1000L }
    registry.begin("export", "export", "build", "files", 100L, 2)
    registry.add("export", bytes = 80, items = 1)
    registry.startStep("export", "verify", "download", null, null)
    assertEquals(0L, registry.snapshot()?.bytesDone)
    assertEquals(0, registry.snapshot()?.itemsDone)
    assertNull(registry.snapshot()?.bytesTotal)
    assertNull(registry.snapshot()?.itemsTotal)
  }

  @Test
  fun onlyTheCurrentOperationCanOwnProgress() {
    val registry = BackupProgressRegistry { 1_000L }
    assertTrue(registry.begin("export-1", "export", "capture", "media", 200L, 2))
    assertFalse(registry.begin("scan-1", "scan", "scan", "archive", null, 4))
    assertFalse(registry.update("scan-1", phase = "scan", step = "archive", bytesDone = 1L, itemsDone = 1))
    assertEquals("export-1", registry.snapshot("export-1")?.operationId)
    assertNull(registry.snapshot("scan-1"))
  }

  @Test
  fun publishesThrottledUpdatesAndClearsAfterTerminalState() {
    var now = 1_000L
    val registry = BackupProgressRegistry { now }
    val events = mutableListOf<BackupProgressSnapshot?>()
    registry.subscribe(events::add)

    assertTrue(registry.begin("import-1", "import", "verify", "media", 200L, 2))
    now += 100L
    assertTrue(registry.update("import-1", phase = "verify", step = "media", bytesDone = 50L, itemsDone = 1))
    assertEquals(1, events.size)
    assertEquals(50L, registry.snapshot("import-1")?.bytesDone)

    now += 150L
    assertTrue(registry.update("import-1", phase = "verify", step = "media", bytesDone = 100L, itemsDone = 1))
    assertEquals(2, events.size)
    assertEquals(100L, events.last()?.bytesDone)

    assertTrue(registry.finish("import-1", "succeeded"))
    assertNull(registry.snapshot("import-1"))
    assertNull(events.last())
    assertFalse(registry.finish("import-1", "failed"))
  }
}
