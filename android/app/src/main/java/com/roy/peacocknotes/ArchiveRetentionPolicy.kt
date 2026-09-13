package com.roy.peacocknotes

data class RetentionArchiveCandidate(
  val key: String,
  val state: String,
  val createdAt: Long?,
)

object ArchiveRetentionPolicy {
  fun expiredVerifiedArchiveKeys(
    archives: List<RetentionArchiveCandidate>,
    now: Long,
    retentionWindowMillis: Long,
  ): Set<String> {
    require(retentionWindowMillis >= 0) { "retentionWindowMillis must not be negative" }
    val verified = archives.filter { it.state == "valid" && it.createdAt != null }
    val newest = verified.maxByOrNull { it.createdAt!! }
    val cutoff = now - retentionWindowMillis
    return verified.asSequence()
      .filter { it !== newest && it.createdAt!! < cutoff }
      .map { it.key }
      .toSet()
  }
}
