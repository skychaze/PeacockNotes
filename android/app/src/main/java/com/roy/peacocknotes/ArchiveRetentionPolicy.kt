package com.roy.peacocknotes

data class RetentionArchiveCandidate(
  val key: String,
  val state: String,
  val createdAt: Long?,
)

object ArchiveRetentionPolicy {
  const val MAX_VALID_ARCHIVES = 7

  fun excessValidArchiveKeys(
    archives: List<RetentionArchiveCandidate>,
  ): Set<String> {
    return archives.asSequence()
      .filter { it.state == "valid" && it.createdAt != null }
      .sortedWith(compareByDescending<RetentionArchiveCandidate> { it.createdAt }.thenBy { it.key })
      .drop(MAX_VALID_ARCHIVES)
      .map { it.key }
      .toSet()
  }
}
