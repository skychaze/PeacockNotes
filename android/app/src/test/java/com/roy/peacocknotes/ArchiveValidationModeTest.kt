package com.roy.peacocknotes

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.ByteArrayOutputStream
import java.security.MessageDigest

class ArchiveValidationModeTest {
  @Test
  fun rejectsOversizedMediaBeforeWritingBeyondTheDeclaredSize() {
    val sink = ByteArrayOutputStream()
    val error = runCatching {
      validateArchiveEntry("too long".byteInputStream(), "0".repeat(64), 3L, ArchiveValidationMode.STAGE, sink)
    }.exceptionOrNull()
    assertTrue(error is ArchiveValidationException)
    assertEquals(0, sink.size())
  }

  @Test
  fun verifyOnlyHashesMediaWithoutWritingIt() {
    val bytes = "media bytes".toByteArray()
    val expected = "b6acae78c76442a73a94762eb91711a59c642ac3cfdaad636a061bdb7fad6975"
    val sink = ByteArrayOutputStream()

    val result = validateArchiveEntry(
      bytes.inputStream(),
      expected,
      bytes.size.toLong(),
      ArchiveValidationMode.VERIFY_ONLY,
      sink,
    )

    assertEquals(expected, result.sha256)
    assertEquals(bytes.size.toLong(), result.bytes)
    assertEquals(0, sink.size())
  }

  @Test
  fun verifyOnlyRejectsDigestMismatch() {
    val error = runCatching {
      validateArchiveEntry(
        "media bytes".byteInputStream(),
        "0".repeat(64),
        11L,
        ArchiveValidationMode.VERIFY_ONLY,
        null,
      )
    }.exceptionOrNull()

    assertTrue(error is ArchiveValidationException)
    assertEquals("HASH_MISMATCH", (error as ArchiveValidationException).code)
  }

  @Test
  fun verifyOnlyRejectsTruncatedMedia() {
    val error = runCatching {
      validateArchiveEntry(
        "short".byteInputStream(),
        "0".repeat(64),
        11L,
        ArchiveValidationMode.VERIFY_ONLY,
        null,
      )
    }.exceptionOrNull()

    assertTrue(error is ArchiveValidationException)
    assertEquals("SIZE_MISMATCH", (error as ArchiveValidationException).code)
  }
}
