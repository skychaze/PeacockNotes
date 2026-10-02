package com.roy.peacocknotes

import android.util.AtomicFile
import org.json.JSONObject
import java.io.File

class DriveUploadSession(private val source: File, private val parent: String, private val name: String) {
  private val storage = AtomicFile(File("${source.path}.upload-session"))

  fun read(): String? {
    if (!storage.baseFile.exists()) return null
    return try {
      val json = JSONObject(storage.openRead().bufferedReader().use { it.readText() })
      if (json.getString("parent") != parent || json.getString("name") != name ||
        json.getLong("bytes") != source.length() || json.getLong("modified") != source.lastModified()) {
        clear()
        null
      } else {
        json.getString("uri")
      }
    } catch (error: Exception) {
      throw DriveException("STAGING_UNAVAILABLE", "The saved upload session could not be read.", error)
    }
  }

  fun write(uri: String) {
    val json = JSONObject().put("parent", parent).put("name", name)
      .put("bytes", source.length()).put("modified", source.lastModified()).put("uri", uri)
    val output = try {
      storage.startWrite()
    } catch (error: Exception) {
      throw DriveException("STAGING_UNAVAILABLE", "The upload session could not be saved.", error)
    }
    try {
      output.write(json.toString().toByteArray(Charsets.UTF_8))
      storage.finishWrite(output)
    } catch (error: Throwable) {
      storage.failWrite(output)
      throw DriveException("STAGING_UNAVAILABLE", "The upload session could not be saved.", error)
    }
  }

  fun clear() = storage.delete()
}
