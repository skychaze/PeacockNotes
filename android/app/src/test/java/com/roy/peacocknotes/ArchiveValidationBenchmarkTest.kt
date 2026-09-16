package com.roy.peacocknotes

import java.io.File
import java.io.FileOutputStream
import java.nio.file.Files
import java.security.MessageDigest
import java.util.zip.ZipFile
import org.junit.Assert.assertEquals
import org.junit.Assume.assumeTrue
import org.junit.Test

class ArchiveValidationBenchmarkTest {
  @Test
  fun compareVerifiedMediaWithAndWithoutExtraction() {
    val fixture = System.getenv("PEACOCK_BENCHMARK_ARCHIVE")
    assumeTrue(fixture != null)
    val directory = Files.createTempDirectory("peacock-validation-benchmark").toFile()
    try {
      ZipFile(fixture!!).use { zip ->
        val media = zip.entries().asSequence().filter { it.name.startsWith("media/sha256/") }.toList()
        assertEquals(262144000L, media.sumOf { it.size })
        repeat(3) { iteration ->
          for (stage in listOf(true, false)) {
            var written = 0L
            val started = System.nanoTime()
            for (entry in media) {
              zip.getInputStream(entry).use { input ->
                if (stage) {
                  val target = File(directory, entry.name.substringAfterLast('/'))
                  FileOutputStream(target).use { output ->
                    val digest = MessageDigest.getInstance("SHA-256")
                    val buffer = ByteArray(65536)
                    var total = 0L
                    while (true) {
                      val count = input.read(buffer)
                      if (count < 0) break
                      total += count
                      check(total <= entry.size)
                      output.write(buffer, 0, count)
                      digest.update(buffer, 0, count)
                    }
                    assertEquals(entry.size, total)
                    assertEquals(entry.name.substringAfterLast('/'), digest.digest().joinToString("") { "%02x".format(it) })
                    written += total
                  }
                  target.delete()
                } else {
                  validateArchiveEntry(input, entry.name.substringAfterLast('/'), entry.size, ArchiveValidationMode.VERIFY_ONLY, null)
                }
              }
            }
            println("BENCHMARK iteration=$iteration stage=$stage elapsedMs=${(System.nanoTime() - started) / 1_000_000} mediaWritten=$written")
          }
        }
      }
    } finally {
      directory.deleteRecursively()
    }
  }
}
