package com.roy.peacocknotes

import android.app.Activity
import android.content.Context
import android.content.Intent
import android.util.Log
import com.google.android.gms.auth.api.identity.AuthorizationRequest
import com.google.android.gms.auth.api.identity.Identity
import com.google.android.gms.common.api.ApiException
import com.google.android.gms.common.api.Scope
import com.google.android.gms.tasks.Tasks
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.io.FileInputStream
import java.io.FilterInputStream
import java.io.InputStream
import java.net.HttpURLConnection
import java.net.URL
import java.net.URLEncoder
import java.time.Instant
import java.io.IOException
import java.util.concurrent.ExecutionException
import java.util.concurrent.TimeUnit
import java.util.concurrent.TimeoutException
import kotlin.math.min

class DriveException(val code: String, override val message: String, cause: Throwable? = null) : Exception(message, cause)

/** Drive v3 client for Peacock Notes' app-owned collection (drive.file scope). */
class DriveClient(private val context: Context, private val accessToken: (() -> String)? = null) {
  data class Item(val id: String, val name: String, val size: Long?, val modifiedTime: Long?)

  private data class UploadResult(val status: Int, val body: String, val nextOffset: Long?)

  companion object {
    private const val SCOPE = "https://www.googleapis.com/auth/drive.file"
    private const val DRIVE_ID_PATTERN = "[A-Za-z0-9_-]+"
    private const val CONNECT_TIMEOUT_MILLIS = 15_000
    private const val READ_TIMEOUT_MILLIS = 60_000
    private const val UPLOAD_CHUNK_BYTES = 256 * 1024
    private const val MAX_UPLOAD_RETRIES = 3
    private const val RESUME_INCOMPLETE = 308

    fun uri(id: String) = "gdrive://$id"

    fun idFromUri(value: String): String? {
      val parsed = android.net.Uri.parse(value)
      val authority = parsed.encodedAuthority ?: return null
      return authority.takeIf {
        parsed.scheme == "gdrive" &&
          parsed.encodedPath.isNullOrEmpty() &&
          parsed.encodedQuery == null &&
          parsed.encodedFragment == null &&
          !authority.contains(':') &&
          Regex(DRIVE_ID_PATTERN).matches(authority)
      }
    }
  }

  private fun requestSpec() = AuthorizationRequest.builder()
    .setRequestedScopes(listOf(Scope(SCOPE)))
    .build()

  private fun token(): String = accessToken?.invoke() ?: try {
    // A background discovery/scan must never wait indefinitely for an
    // authorization resolution that requires an Activity.  The caller can
    // surface DRIVE_AUTH_REQUIRED and let the user reconnect interactively.
    val result = Tasks.await(
      Identity.getAuthorizationClient(context).authorize(requestSpec()),
      CONNECT_TIMEOUT_MILLIS.toLong(),
      TimeUnit.MILLISECONDS,
    )
    if (result.hasResolution()) {
      throw DriveException("DRIVE_AUTH_REQUIRED", "Google Drive needs to be connected again.")
    }
    result.accessToken ?: throw DriveException("DRIVE_AUTH_REQUIRED", "Google Drive access is unavailable.")
  } catch (e: DriveException) {
    throw e
  } catch (e: TimeoutException) {
    throw DriveException("DRIVE_UNAVAILABLE", "Google Drive authorization timed out.", e)
  } catch (e: IOException) {
    throw DriveException("DRIVE_UNAVAILABLE", "Google Drive authorization is temporarily unavailable.", e)
  } catch (e: ExecutionException) {
    throw authorizationException(e.cause ?: e)
  } catch (e: ApiException) {
    throw authorizationException(e)
  } catch (e: Exception) {
    // Do not turn an arbitrary provider/runtime failure into "revoked". A
    // saved account remains connected unless Drive explicitly reports an
    // authentication failure; transient failures are recoverable.
    throw DriveException("DRIVE_UNAVAILABLE", "Google Drive authorization is temporarily unavailable.", e)
  }

  private fun authorizationException(error: Throwable): DriveException {
    val api = error as? ApiException
    val transient = api?.statusCode == 7 || api?.statusCode == 8 || api?.statusCode == 15
    return DriveException(
      if (transient) "DRIVE_UNAVAILABLE" else "DRIVE_AUTH_REQUIRED",
      if (transient) "Google Drive is temporarily unavailable." else "Google Drive authorization is unavailable.",
      error,
    )
  }

  fun beginAuthorization(
    activity: Activity,
    requestCode: Int,
    completed: (String) -> Unit,
    failed: (DriveException) -> Unit,
  ) {
    Identity.getAuthorizationClient(activity).authorize(requestSpec())
      .addOnSuccessListener { result ->
        try {
          val accessToken = result.accessToken
          if (!accessToken.isNullOrBlank()) {
            completed(accessToken)
          } else if (result.hasResolution()) {
            val pendingIntent = result.pendingIntent
              ?: throw DriveException("DRIVE_AUTH_FAILED", "Google Drive authorization did not provide a sign-in action.")
            activity.startIntentSenderForResult(pendingIntent.intentSender, requestCode, null, 0, 0, 0)
          } else {
            failed(DriveException("DRIVE_AUTH_REQUIRED", "Google Drive authorization did not return an access token."))
          }
        } catch (e: DriveException) {
          failed(e)
        } catch (e: Exception) {
          failed(DriveException("DRIVE_AUTH_FAILED", "Could not open Google Drive authorization.", e))
        }
      }
      .addOnFailureListener { failed(DriveException("DRIVE_AUTH_FAILED", "Could not authorize Google Drive.", it)) }
  }

  fun completeAuthorization(intent: Intent): String = try {
    Identity.getAuthorizationClient(context)
      .getAuthorizationResultFromIntent(intent)
      .accessToken
      ?: throw DriveException("DRIVE_AUTH_REQUIRED", "Google Drive did not return an access token.")
  } catch (e: DriveException) {
    throw e
  } catch (e: Exception) {
    throw DriveException("DRIVE_AUTH_FAILED", "Google Drive authorization failed.", e)
  }

  fun findOrCreateFolder(name: String): Item = query(
    "name='${name.replace("'", "\\'")}' and mimeType='application/vnd.google-apps.folder' and trashed=false",
  ).firstOrNull() ?: create(JSONObject().put("name", name).put("mimeType", "application/vnd.google-apps.folder"))

  fun folder(id: String): Item = get("https://www.googleapis.com/drive/v3/files/$id?fields=id,name,size,modifiedTime")

  fun list(parentId: String): List<Item> = query("'$parentId' in parents and trashed=false")

  fun delete(id: String) {
    val connection = request("DELETE", "https://www.googleapis.com/drive/v3/files/$id", null, null)
    try {
      // DELETE is idempotent for our cache/retry path. A file can disappear
      // between listing it and deleting it (for example, from another Drive
      // client), so a 404 is already the desired end state.
      val status = connection.responseCode
      if (status !in 200..299 && status != HttpURLConnection.HTTP_NOT_FOUND) {
        throw driveError(status, readBody(connection, status))
      }
    } finally {
      connection.disconnect()
    }
  }

  fun download(id: String): InputStream {
    val connection = request("GET", "https://www.googleapis.com/drive/v3/files/$id?alt=media", null, null)
    return try {
      if (connection.responseCode !in 200..299) {
        throw driveError(connection.responseCode, readBody(connection, connection.responseCode))
      }
      object : FilterInputStream(connection.inputStream) {
        override fun close() {
          try {
            super.close()
          } finally {
            connection.disconnect()
          }
        }
      }
    } catch (error: Throwable) {
      connection.disconnect()
      throw error
    }
  }

  fun uploadResumable(parent: String, name: String, file: File, mime: String, onProgress: (Long) -> Unit = {}): Item {
    val totalBytes = file.length()
    Log.i("BackupRuntime", "[DEBUG-BR-DRIVE] upload_start name=$name bytes=$totalBytes")
    val session = startUploadSession(parent, name, totalBytes, mime)
    var offset = 0L
    var retries = 0

    while (offset < totalBytes || totalBytes == 0L) {
      val length = if (totalBytes == 0L) 0 else min(UPLOAD_CHUNK_BYTES.toLong(), totalBytes - offset).toInt()
      val end = if (length == 0) -1L else offset + length - 1
      val result = sendChunk(session, file, offset, length, totalBytes, mime)
      Log.i("BackupRuntime", "[DEBUG-BR-DRIVE] upload_chunk offset=$offset length=$length status=${result.status}")

      when {
        result.status in 200..299 -> {
          // The 2xx resumable response is the upload commit boundary. Do not
          // issue a second metadata GET here: that request can fail or wait for
          // Drive's eventual-consistency window even though the file is already
          // safely stored. The requested upload fields contain enough metadata
          // for the caller to verify the byte count, with a local-size fallback
          // for responses that omit `size`.
          val committed = parseUpload(result.body, name, totalBytes)
          Log.i("BackupRuntime", "[DEBUG-BR-DRIVE] upload_committed id=${committed.id} bytes=${committed.size}")
          onProgress(totalBytes)
          return committed
        }
        result.status == RESUME_INCOMPLETE -> {
          if (totalBytes == 0L) {
            throw DriveException("DRIVE_UPLOAD_FAILED", "Google Drive did not complete the empty archive upload.")
          }
          val next = result.nextOffset ?: (offset + length)
          if (next < offset || next > totalBytes) {
            throw DriveException("DRIVE_UPLOAD_FAILED", "Google Drive returned an invalid upload offset.")
          }
          offset = next
          onProgress(offset)
          retries = 0
        }
        result.status == 429 || result.status >= 500 -> {
          if (retries >= MAX_UPLOAD_RETRIES) {
            throw driveError(result.status, result.body)
          }
          retries += 1
          val status = queryUploadOffset(session, totalBytes, mime)
          if (status.status in 200..299) {
            val committed = parseUpload(status.body, name, totalBytes)
            Log.i("BackupRuntime", "[DEBUG-BR-DRIVE] upload_committed_after_retry id=${committed.id} bytes=${committed.size}")
            onProgress(totalBytes)
            return committed
          }
          if (status.status != RESUME_INCOMPLETE) throw driveError(status.status, status.body)
          offset = status.nextOffset ?: offset
          onProgress(offset)
        }
        else -> throw driveError(result.status, result.body)
      }
    }

    throw DriveException("DRIVE_UPLOAD_FAILED", "Google Drive did not complete the archive upload.")
  }

  private fun startUploadSession(parent: String, name: String, totalBytes: Long, mime: String): String {
    val metadata = JSONObject()
      .put("name", name)
      .put("parents", JSONArray().put(parent))
      .toString()
      .toByteArray(Charsets.UTF_8)
    val connection = request(
      "POST",
      "https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&fields=id,name,size,modifiedTime",
      metadata,
      "application/json; charset=UTF-8",
      mapOf(
        "X-Upload-Content-Type" to mime,
        "X-Upload-Content-Length" to totalBytes.toString(),
      ),
    )
    return try {
      if (connection.responseCode !in 200..299) {
        throw driveError(connection.responseCode, readBody(connection, connection.responseCode))
      }
      connection.getHeaderField("Location")
        ?: throw DriveException("DRIVE_UPLOAD_FAILED", "Google Drive did not start an upload.")
    } finally {
      connection.disconnect()
    }
  }

  private fun sendChunk(
    session: String,
    file: File,
    offset: Long,
    length: Int,
    totalBytes: Long,
    mime: String,
  ): UploadResult {
    val end = if (length == 0) -1L else offset + length - 1
    val range = if (length == 0) "bytes */$totalBytes" else "bytes $offset-$end/$totalBytes"
    val connection = openConnection(
      "PUT",
      session,
      mapOf(
        "Content-Type" to mime,
        "Content-Range" to range,
      ),
    )
    return try {
      connection.doOutput = true
      connection.setFixedLengthStreamingMode(length.toLong())
      connection.outputStream.use { output ->
        if (length > 0) {
          FileInputStream(file).use { input ->
            skipExactly(input, offset)
            copyExactly(input, output, length)
          }
        }
      }
      val status = connection.responseCode
      UploadResult(status, readBody(connection, status), uploadOffset(connection))
    } finally {
      connection.disconnect()
    }
  }

  private fun queryUploadOffset(session: String, totalBytes: Long, mime: String): UploadResult {
    val connection = openConnection(
      "PUT",
      session,
      mapOf(
        "Content-Type" to mime,
        "Content-Range" to "bytes */$totalBytes",
      ),
    )
    return try {
      connection.doOutput = true
      connection.setFixedLengthStreamingMode(0)
      connection.outputStream.use { }
      val status = connection.responseCode
      UploadResult(status, readBody(connection, status), uploadOffset(connection))
    } finally {
      connection.disconnect()
    }
  }

  private fun skipExactly(input: InputStream, bytes: Long) {
    var remaining = bytes
    while (remaining > 0) {
      val skipped = input.skip(remaining)
      if (skipped > 0) {
        remaining -= skipped
      } else if (input.read() >= 0) {
        remaining -= 1
      } else {
        throw DriveException("STAGING_MISSING", "The staged archive ended before the upload offset.")
      }
    }
  }

  private fun copyExactly(input: InputStream, output: java.io.OutputStream, bytes: Int) {
    var remaining = bytes
    val buffer = ByteArray(64 * 1024)
    while (remaining > 0) {
      val count = input.read(buffer, 0, min(buffer.size, remaining))
      if (count < 0) throw DriveException("STAGING_MISSING", "The staged archive ended during upload.")
      output.write(buffer, 0, count)
      remaining -= count
    }
  }

  private fun uploadOffset(connection: HttpURLConnection): Long? {
    val range = connection.getHeaderField("Range") ?: return null
    val match = Regex("bytes[ =]\\d+-(\\d+)").find(range) ?: return null
    return match.groupValues[1].toLongOrNull()?.plus(1)
  }

  private fun query(q: String): List<Item> {
    val files = mutableListOf<Item>()
    var pageToken: String? = null
    var pageCount = 0
    do {
      val query = buildString {
        append("https://www.googleapis.com/drive/v3/files?q=")
        append(URLEncoder.encode(q, "UTF-8"))
        append("&fields=")
        append(URLEncoder.encode("files(id,name,size,modifiedTime),nextPageToken", "UTF-8"))
        append("&pageSize=1000")
        if (!pageToken.isNullOrEmpty()) {
          append("&pageToken=")
          append(URLEncoder.encode(pageToken, "UTF-8"))
        }
      }
      val json = JSONObject(jsonText(query))
      pageCount += 1
      val page = json.optJSONArray("files") ?: JSONArray()
      for (index in 0 until page.length()) files += parse(page.getJSONObject(index).toString())
      pageToken = json.optString("nextPageToken").takeIf { it.isNotEmpty() }
    } while (pageToken != null)
    Log.i("BackupRuntime", "[DEBUG-BR-DRIVE] list_complete pages=$pageCount items=${files.size}")
    return files
  }

  private fun create(metadata: JSONObject): Item = get(
    "https://www.googleapis.com/drive/v3/files?fields=id,name,size,modifiedTime",
    "POST",
    metadata.toString().toByteArray(Charsets.UTF_8),
    "application/json; charset=UTF-8",
  )

  private fun get(url: String, method: String = "GET", body: ByteArray? = null, type: String? = null): Item =
    parse(jsonText(url, method, body, type))

  private fun jsonText(
    url: String,
    method: String = "GET",
    body: ByteArray? = null,
    type: String? = null,
  ): String {
    val connection = request(method, url, body, type)
    return try {
      response(connection)
    } finally {
      connection.disconnect()
    }
  }

  private fun request(
    method: String,
    url: String,
    body: ByteArray?,
    type: String?,
    headers: Map<String, String> = emptyMap(),
  ): HttpURLConnection {
    val connection = openConnection(method, url, headers)
    try {
      if (body != null) {
        connection.doOutput = true
        if (type != null) connection.setRequestProperty("Content-Type", type)
        connection.setFixedLengthStreamingMode(body.size)
        connection.outputStream.use { it.write(body) }
      }
      return connection
    } catch (error: Throwable) {
      connection.disconnect()
      throw error
    }
  }

  private fun openConnection(method: String, url: String, headers: Map<String, String> = emptyMap()): HttpURLConnection =
    (URL(url).openConnection() as HttpURLConnection).apply {
      requestMethod = method
      connectTimeout = CONNECT_TIMEOUT_MILLIS
      readTimeout = READ_TIMEOUT_MILLIS
      setRequestProperty("Authorization", "Bearer ${token()}")
      headers.forEach { (key, value) -> setRequestProperty(key, value) }
    }

  private fun response(connection: HttpURLConnection): String {
    val status = connection.responseCode
    val text = readBody(connection, status)
    if (status !in 200..299) throw driveError(status, text)
    return text
  }

  private fun readBody(connection: HttpURLConnection, status: Int): String {
    val stream = if (status in 200..299 || status == RESUME_INCOMPLETE) {
      connection.inputStream
    } else {
      connection.errorStream
    }
    return stream?.bufferedReader(Charsets.UTF_8)?.use { it.readText() } ?: ""
  }

  private fun driveError(status: Int, body: String): DriveException {
    val normalized = body.lowercase()
    val authFailure = status == 401 || (status == 403 && listOf(
      "autherror",
      "invalidcredentials",
      "insufficientfilepermissions",
      "insufficientpermissions",
      "invalid_grant",
    ).any(normalized::contains))
    val code = when {
      authFailure -> "DRIVE_AUTH_REQUIRED"
      status == 403 -> "DRIVE_API_FORBIDDEN"
      status == 408 || status == 429 -> "DRIVE_RATE_LIMITED"
      status >= 500 -> "DRIVE_UNAVAILABLE"
      else -> "DRIVE_API_FAILED"
    }
    return DriveException(code, "Google Drive request failed ($status): $body")
  }

  private fun parse(text: String): Item {
    val json = JSONObject(text)
    val modified = json.optString("modifiedTime").takeIf { it.isNotEmpty() }?.let {
      runCatching { Instant.parse(it).toEpochMilli() }.getOrNull()
    }
    return Item(
      json.getString("id"),
      json.getString("name"),
      if (json.has("size") && !json.isNull("size")) json.getLong("size") else null,
      modified,
    )
  }

  private fun parseUpload(text: String, fallbackName: String, fallbackSize: Long): Item {
    val json = try { JSONObject(text) } catch (error: Exception) {
      throw DriveException("DRIVE_UPLOAD_FAILED", "Google Drive returned an invalid upload acknowledgement.", error)
    }
    val id = json.optString("id").takeIf { it.isNotBlank() }
      ?: throw DriveException("DRIVE_UPLOAD_FAILED", "Google Drive did not identify the uploaded archive.")
    val name = json.optString("name").takeIf { it.isNotBlank() } ?: fallbackName
    val size = if (json.has("size") && !json.isNull("size")) json.optLong("size", fallbackSize) else fallbackSize
    val modified = json.optString("modifiedTime").takeIf { it.isNotEmpty() }?.let {
      runCatching { Instant.parse(it).toEpochMilli() }.getOrNull()
    }
    return Item(id, name, size, modified)
  }
}
