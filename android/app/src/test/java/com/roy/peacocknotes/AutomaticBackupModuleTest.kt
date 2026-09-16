package com.roy.peacocknotes

import org.junit.Assert.assertEquals
import org.junit.Test

class AutomaticBackupModuleTest {
  @Test
  fun acceptsSupportedIntervals() {
    listOf(1, 3, 6, 12, 24).forEach { interval ->
      assertEquals(interval, AutomaticBackupModule.validatedIntervalHours(interval))
      assertEquals(interval, AutomaticBackupModule.validatedIntervalHours(interval.toDouble()))
    }
  }

  @Test(expected = IllegalArgumentException::class)
  fun rejectsUnsupportedInterval() {
    AutomaticBackupModule.validatedIntervalHours(2)
  }

  @Test(expected = IllegalArgumentException::class)
  fun rejectsFractionalInterval() {
    AutomaticBackupModule.validatedIntervalHours(1.5)
  }
}
