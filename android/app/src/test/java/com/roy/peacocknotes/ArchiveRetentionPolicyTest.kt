package com.roy.peacocknotes

import org.junit.Assert.assertEquals
import org.junit.Test

class ArchiveRetentionPolicyTest {
  @Test
  fun keepsNewestSevenValidArchives() {
    val candidates = (1L..9L).map { createdAt ->
      RetentionArchiveCandidate("archive-$createdAt", "valid", createdAt)
    }

    assertEquals(
      setOf("archive-1", "archive-2"),
      ArchiveRetentionPolicy.excessValidArchiveKeys(candidates),
    )
  }

  @Test
  fun damagedArchivesDoNotCountTowardTheLimit() {
    val candidates = listOf(
      RetentionArchiveCandidate("damaged-newest", "damaged", 100),
      RetentionArchiveCandidate("uncertain", "uncertain", 99),
      *(1L..8L).map { RetentionArchiveCandidate("valid-$it", "valid", it) }.toTypedArray(),
    )

    assertEquals(setOf("valid-1"), ArchiveRetentionPolicy.excessValidArchiveKeys(candidates))
  }

  @Test
  fun orderingIsDeterministicWhenTimestampsMatch() {
    val candidates = listOf(
      RetentionArchiveCandidate("h", "valid", 1),
      RetentionArchiveCandidate("g", "valid", 1),
      RetentionArchiveCandidate("f", "valid", 1),
      RetentionArchiveCandidate("e", "valid", 1),
      RetentionArchiveCandidate("d", "valid", 1),
      RetentionArchiveCandidate("c", "valid", 1),
      RetentionArchiveCandidate("b", "valid", 1),
      RetentionArchiveCandidate("a", "valid", 1),
    )

    assertEquals(setOf("h"), ArchiveRetentionPolicy.excessValidArchiveKeys(candidates))
  }

  @Test
  fun sevenOrFewerValidArchivesIsNoOp() {
    val candidates = (1L..7L).map { createdAt ->
      RetentionArchiveCandidate("archive-$createdAt", "valid", createdAt)
    } + RetentionArchiveCandidate("missing-date", "valid", null)

    assertEquals(emptySet<String>(), ArchiveRetentionPolicy.excessValidArchiveKeys(candidates))
  }
}
