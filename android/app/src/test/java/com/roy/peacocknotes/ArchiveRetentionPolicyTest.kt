package com.roy.peacocknotes

import org.junit.Assert.assertEquals
import org.junit.Test

class ArchiveRetentionPolicyTest {
  private val week = 168L * 60 * 60 * 1000
  private val now = 2 * week

  @Test
  fun retainsTheExactWindowBoundary() {
    val candidates = listOf(
      RetentionArchiveCandidate("boundary", "valid", now - week),
      RetentionArchiveCandidate("newest", "valid", now - 1),
    )

    assertEquals(emptySet<String>(), ArchiveRetentionPolicy.expiredVerifiedArchiveKeys(candidates, now, week))
  }

  @Test
  fun preservesNewestValidArchiveOutsideWindow() {
    val candidates = listOf(
      RetentionArchiveCandidate("older", "valid", now - week - 2),
      RetentionArchiveCandidate("newest", "valid", now - week - 1),
    )

    assertEquals(setOf("older"), ArchiveRetentionPolicy.expiredVerifiedArchiveKeys(candidates, now, week))
  }

  @Test
  fun neverPrunesUncertainDamagedOrUnrelatedEntries() {
    val candidates = listOf(
      RetentionArchiveCandidate("valid-old", "valid", now - week - 2),
      RetentionArchiveCandidate("valid-new", "valid", now - 1),
      RetentionArchiveCandidate("uncertain", "uncertain", now - week - 3),
      RetentionArchiveCandidate("damaged", "damaged", now - week - 4),
      RetentionArchiveCandidate("unrelated", "unrelated", now - week - 5),
    )

    assertEquals(setOf("valid-old"), ArchiveRetentionPolicy.expiredVerifiedArchiveKeys(candidates, now, week))
  }
}
