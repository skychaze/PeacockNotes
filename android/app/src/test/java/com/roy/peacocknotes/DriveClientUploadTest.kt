package com.roy.peacocknotes

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.After
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Config
import java.io.ByteArrayInputStream
import java.io.ByteArrayOutputStream
import java.io.File
import java.io.IOException
import java.net.HttpURLConnection
import java.net.SocketTimeoutException
import java.net.URL

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35], manifest = Config.NONE)
class DriveClientUploadTest {
  private lateinit var file: File
  private lateinit var server: UploadServer

  @Before
  fun setUp() {
    file = File.createTempFile("upload", ".pnbak", RuntimeEnvironment.getApplication().filesDir)
    file.writeBytes(ByteArray(3 * 256 * 1024) { (it % 251).toByte() })
    server = UploadServer(file.readBytes())
  }

  @After
  fun tearDown() {
    DriveUploadSession(file, "folder", "backup.pnbak").clear()
    file.delete()
  }

  private fun client() = DriveClient(RuntimeEnvironment.getApplication(), connectionFactory = server::connection) { "test-token" }

  @Test
  fun resumesAcceptedChunkAfterLostResponse() {
    val waiting = mutableListOf<Boolean>()
    val item = client().uploadResumable("folder", "backup.pnbak", file, "application/octet-stream", onWaiting = waiting::add)
    assertEquals(file.length(), item.size)
    assertEquals(listOf(0L, 262144L, 524288L), server.chunkOffsets)
    assertEquals(1, server.queries)
    assertTrue(waiting.contains(true))
    assertFalse(waiting.last())
    assertEquals(1, server.sessions)
  }

  @Test
  fun resendsUnacceptedChunkAfterTimeout() {
    server.acceptFault = false
    server.fault = SocketTimeoutException("timeout")
    client().uploadResumable("folder", "backup.pnbak", file, "application/octet-stream")
    assertEquals(listOf(0L, 262144L, 262144L, 524288L), server.chunkOffsets)
    assertEquals(1, server.queries)
  }

  @Test
  fun recoversLostFinalAcknowledgementWithoutCreatingAnotherArchive() {
    server.faultAt = 3
    val item = client().uploadResumable("folder", "backup.pnbak", file, "application/octet-stream")
    assertEquals("archive", item.id)
    assertEquals(3, server.chunks)
    assertEquals(1, server.queries)
    assertEquals(1, server.sessions)
  }

  @Test
  fun newClientResumesPersistedSessionInsteadOfStartingOver() {
    server.faultAt = -1
    try {
      client().uploadResumable("folder", "backup.pnbak", file, "application/octet-stream", onProgress = {
        throw InterruptedException("process stopped")
      })
      throw AssertionError("The first client must be interrupted")
    } catch (_: InterruptedException) {
      assertTrue(File("${file.path}.upload-session").isFile)
    }
    client().uploadResumable("folder", "backup.pnbak", file, "application/octet-stream")
    assertEquals(listOf(0L, 262144L, 524288L), server.chunkOffsets)
    assertEquals(1, server.sessions)
    assertEquals(1, server.queries)
  }

  @Test
  fun rejectsOffsetsBeyondTheStagedArchive() {
    server.invalidOffset = true
    try {
      client().uploadResumable("folder", "backup.pnbak", file, "application/octet-stream")
      throw AssertionError("An invalid offset must fail")
    } catch (error: DriveException) {
      assertEquals("DRIVE_UPLOAD_FAILED", error.code)
      assertEquals(1, server.chunks)
    }
  }

  @Test
  fun reusesCompletedSessionAfterClientRestart() {
    server.faultAt = -1
    client().uploadResumable("folder", "backup.pnbak", file, "application/octet-stream")
    val item = client().uploadResumable("folder", "backup.pnbak", file, "application/octet-stream")
    assertEquals("archive", item.id)
    assertEquals(1, server.sessions)
    assertEquals(3, server.chunks)
    assertEquals(1, server.queries)
  }

  @Test
  fun restartsExpiredPartialSessionAfterCheckingForACompletedArchive() {
    server.faultAt = -1
    try {
      client().uploadResumable("folder", "backup.pnbak", file, "application/octet-stream", onProgress = {
        throw InterruptedException("process stopped")
      })
    } catch (_: InterruptedException) {
      server.expired = true
    }
    client().uploadResumable("folder", "backup.pnbak", file, "application/octet-stream")
    assertEquals(2, server.sessions)
    assertEquals(1, server.listings)
    assertEquals(listOf(0L, 0L, 262144L, 524288L), server.chunkOffsets)
  }

  @Test
  fun restartsWhenTheSessionExpiresDuringAChunkRequest() {
    server.faultAt = -1
    server.expiresOnChunk = true
    client().uploadResumable("folder", "backup.pnbak", file, "application/octet-stream")
    assertEquals(2, server.sessions)
    assertEquals(1, server.listings)
    assertEquals(listOf(0L, 0L, 262144L, 524288L), server.chunkOffsets)
  }

  private class UploadServer(private val expected: ByteArray) {
    var acceptFault = true
    var fault: IOException = IOException("connection closed")
    var faultAt = 2
    var invalidOffset = false
    var expired = false
    var expiresOnChunk = false
    var listings = 0
    var sessions = 0
    var queries = 0
    var chunks = 0
    var offset = 0
    val chunkOffsets = mutableListOf<Long>()

    fun connection(url: URL) = object : HttpURLConnection(url) {
      private val output = ByteArrayOutputStream()
      private var result: Response? = null
      private fun response(): Response = result ?: dispatch(requestMethod, getRequestProperty("Content-Range"), output.toByteArray()).also { result = it }
      override fun getOutputStream() = output
      override fun getResponseCode() = response().status
      override fun getInputStream() = ByteArrayInputStream(response().body.toByteArray())
      override fun getErrorStream() = inputStream
      override fun getHeaderField(name: String) = response().headers[name]
      override fun connect() = Unit
      override fun disconnect() = Unit
      override fun usingProxy() = false
    }

    private fun dispatch(method: String, range: String?, bytes: ByteArray): Response {
      if (method == "POST") {
        sessions += 1
        offset = 0
        return Response(200, headers = mapOf("Location" to "https://www.googleapis.com/session"))
      }
      if (method == "GET") {
        listings += 1
        return Response(200, """{"files":[]}""")
      }
      if (range?.startsWith("bytes */") == true) {
        queries += 1
        if (expired) {
          expired = false
          return Response(404)
        }
        return acknowledgement()
      }
      val start = Regex("bytes (\\d+)-").find(range ?: "")!!.groupValues[1].toInt()
      chunks += 1
      chunkOffsets += start.toLong()
      if (expiresOnChunk) {
        expiresOnChunk = false
        return Response(404)
      }
      assertEquals(offset, start)
      assertTrue(expected.copyOfRange(start, start + bytes.size).contentEquals(bytes))
      if (chunks != faultAt || acceptFault) offset += bytes.size
      if (chunks == faultAt) throw fault
      return acknowledgement()
    }

    private fun acknowledgement(): Response = if (offset == expected.size) {
      Response(200, """{"id":"archive","name":"backup.pnbak","size":${expected.size}}""")
    } else {
      Response(308, headers = if (offset == 0) emptyMap() else mapOf("Range" to "bytes=0-${if (invalidOffset) expected.size + 1 else offset - 1}"))
    }
  }

  private data class Response(val status: Int, val body: String = "", val headers: Map<String, String> = emptyMap())
}
