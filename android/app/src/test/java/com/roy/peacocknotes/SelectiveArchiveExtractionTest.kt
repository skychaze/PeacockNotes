package com.roy.peacocknotes

import java.io.File
import java.nio.file.Files
import java.security.MessageDigest
import java.util.zip.ZipEntry
import java.util.zip.ZipOutputStream
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertThrows
import org.junit.Test

class SelectiveArchiveExtractionTest {
  private fun digest(bytes: ByteArray) = ArchiveValidationDigest(
    MessageDigest.getInstance("SHA-256").digest(bytes).joinToString("") { "%02x".format(it) }, bytes.size.toLong(),
  )

  @Test
  fun extractsAndVerifiesOnlySelectedEntries() {
    val work = Files.createTempDirectory("selective-archive").toFile()
    try {
      val selected = "selected attachment".toByteArray()
      val unrelated = "unrelated attachment".toByteArray()
      val selectedPath = "media/sha256/${digest(selected).sha256}"
      val unrelatedPath = "media/sha256/${digest(unrelated).sha256}"
      val archive = File(work, "incoming.zip")
      ZipOutputStream(archive.outputStream()).use { zip ->
        zip.putNextEntry(ZipEntry(selectedPath)); zip.write(selected); zip.closeEntry()
        zip.putNextEntry(ZipEntry(unrelatedPath)); zip.write("corrupted unrelated bytes".toByteArray()); zip.closeEntry()
      }
      val inventory = mapOf(selectedPath to digest(selected), unrelatedPath to digest(unrelated))
      val output = File(work, "selected")
      var verifiedBytes = 0L
      extractVerifiedArchiveEntries(archive, output, inventory, setOf(selectedPath), { verifiedBytes += it })
      assertEquals(String(selected), File(output, selectedPath).readText())
      assertEquals(selected.size.toLong(), verifiedBytes)
      assertFalse(File(output, unrelatedPath).exists())
      val error = assertThrows(ArchiveValidationException::class.java) {
        extractVerifiedArchiveEntries(archive, output, inventory, setOf(unrelatedPath))
      }
      assertEquals("EXPANSION_LIMIT_EXCEEDED", error.code)
    } finally { work.deleteRecursively() }
  }

  @Test
  fun rejectsSelectedContentWithTheWrongHash() {
    val work = Files.createTempDirectory("selective-corruption").toFile()
    try {
      val expected = "original".toByteArray()
      val path = "media/sha256/${digest(expected).sha256}"
      val archive = File(work, "incoming.zip")
      ZipOutputStream(archive.outputStream()).use { zip ->
        zip.putNextEntry(ZipEntry(path)); zip.write("modified".toByteArray()); zip.closeEntry()
      }
      val error = assertThrows(ArchiveValidationException::class.java) {
        extractVerifiedArchiveEntries(archive, File(work, "output"), mapOf(path to digest(expected)), setOf(path))
      }
      assertEquals("HASH_MISMATCH", error.code)
    } finally { work.deleteRecursively() }
  }
}
