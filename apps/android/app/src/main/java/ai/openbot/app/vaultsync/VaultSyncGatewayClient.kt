package ai.openbot.app.vaultsync

import java.util.concurrent.TimeUnit
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.intOrNull
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.longOrNull
import kotlinx.serialization.json.put
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody

fun interface VaultSyncRpc {
  suspend fun request(method: String, paramsJson: String): String
}

data class VaultSyncStatusSnapshot(
  val saltB64: String,
  val encryptionVersion: Int,
)

data class VaultSyncRevisionWire(
  val vaultId: String,
  val opaquePathId: String,
  val revisionId: String,
  val parentRevisionIds: List<String>,
  val deviceId: String,
  val deviceSequence: Long,
  val encryptedMetadataB64: String,
  val ciphertextBlobId: String?,
  val plaintextSize: Long,
  val ciphertextHash: String,
  val tombstone: Boolean,
  val createdAt: String,
  val protocolVersion: Int,
  val encryptionVersion: Int,
)

data class VaultSyncUploadSessionWire(
  val uploadId: String,
  val chunkSize: Int,
  val chunkCount: Int,
)

data class VaultSyncHttpUploadWire(
  val token: String,
  val chunkPutPathTemplate: String,
)

/** Thin JSON-RPC client for vault-sync (operator gateway session). */
class VaultSyncGatewayClient(
  private val rpc: VaultSyncRpc,
  private val httpOriginProvider: () -> String? = { null },
  private val httpClient: OkHttpClient =
    OkHttpClient.Builder()
      .connectTimeout(30, TimeUnit.SECONDS)
      .readTimeout(120, TimeUnit.SECONDS)
      .writeTimeout(120, TimeUnit.SECONDS)
      .build(),
  private val json: Json = Json { ignoreUnknownKeys = true },
) {
  suspend fun status(vaultId: String): VaultSyncStatusSnapshot {
    val raw =
      rpc.request(
        "knowledge.vault-sync.status",
        buildJsonObject { put("vaultId", vaultId) }.toString(),
      )
    val obj = json.parseToJsonElement(raw).jsonObject
    val salt = obj["saltB64"]?.jsonPrimitive?.contentOrNull?.trim().orEmpty()
    require(salt.isNotEmpty()) { "vault salt unavailable" }
    return VaultSyncStatusSnapshot(
      saltB64 = salt,
      encryptionVersion = obj["encryptionVersion"]?.jsonPrimitive?.intOrNull ?: 1,
    )
  }

  suspend fun deviceLastSequence(vaultId: String, deviceId: String): Long {
    val raw =
      rpc.request(
        "knowledge.vault-sync.devices.list",
        buildJsonObject { put("vaultId", vaultId) }.toString(),
      )
    val devices = json.parseToJsonElement(raw).jsonObject["devices"]?.jsonArray ?: return 0L
    for (el in devices) {
      val row = el.jsonObject
      if (row["deviceId"]?.jsonPrimitive?.contentOrNull == deviceId) {
        return row["lastSequence"]?.jsonPrimitive?.longOrNull ?: 0L
      }
    }
    return 0L
  }

  suspend fun headsForPath(vaultId: String, opaquePathId: String): List<String> {
    val raw =
      rpc.request(
        "knowledge.vault-sync.inventory",
        buildJsonObject {
            put("vaultId", vaultId)
            put("cursor", JsonNull)
            put("limit", 2000)
          }
          .toString(),
      )
    val items = json.parseToJsonElement(raw).jsonObject["items"]?.jsonArray ?: return emptyList()
    for (el in items) {
      val row = el.jsonObject
      if (row["opaquePathId"]?.jsonPrimitive?.contentOrNull == opaquePathId) {
        return row["heads"]?.jsonArray?.mapNotNull { it.jsonPrimitive.contentOrNull } ?: emptyList()
      }
    }
    return emptyList()
  }

  suspend fun putBlob(
    vaultId: String,
    deviceId: String,
    ciphertextHash: String,
    contentBase64: String,
  ): String {
    val raw =
      rpc.request(
        "knowledge.vault-sync.blobs.put",
        buildJsonObject {
            put("vaultId", vaultId)
            put("deviceId", deviceId)
            put("ciphertextHash", ciphertextHash)
            put("contentBase64", contentBase64)
          }
          .toString(),
      )
    val blobId = json.parseToJsonElement(raw).jsonObject["blobId"]?.jsonPrimitive?.contentOrNull
    require(!blobId.isNullOrBlank()) { "blob upload rejected" }
    return blobId
  }

  /**
   * Store ciphertext: direct put ≤1MiB; larger uses upload-session with HTTP binary chunks when
   * httpOrigin is available, otherwise WS Base64 chunks.
   */
  suspend fun storeCiphertextBlob(
    vaultId: String,
    deviceId: String,
    ciphertextHash: String,
    ciphertext: ByteArray,
  ): String {
    if (ciphertext.size <= VaultSyncConstants.DIRECT_PUT_MAX_BYTES) {
      return putBlob(
        vaultId = vaultId,
        deviceId = deviceId,
        ciphertextHash = ciphertextHash,
        contentBase64 = VaultSyncCrypto.bytesToBase64(ciphertext),
      )
    }
    val httpOrigin = httpOriginProvider()?.trim().orEmpty()
    val httpAvailable = httpOrigin.isNotEmpty()
    val chunkSize = VaultSyncBlobUpload.preferredChunkSize(httpAvailable)
    val created = createUploadSession(vaultId, deviceId, ciphertextHash, ciphertext.size, chunkSize)
    try {
      if (created.objectUpload != null) {
        putObjectUploadDirect(created.objectUpload, ciphertext)
        return completeUploadSession(vaultId, created.session.uploadId)
      }
      val useHttp = httpAvailable && created.http != null
      for (range in
        VaultSyncBlobUpload.iterChunkRanges(
          ciphertext.size,
          created.session.chunkSize,
          created.session.chunkCount,
        )) {
        val chunk = ciphertext.copyOfRange(range.start, range.end)
        if (useHttp) {
          val http = created.http
          putUploadChunkHttp(
            vaultId = vaultId,
            uploadId = created.session.uploadId,
            chunkIndex = range.chunkIndex,
            bytes = chunk,
            uploadToken = http.token,
            chunkPutPathTemplate = http.chunkPutPathTemplate,
            httpOrigin = httpOrigin,
          )
        } else {
          putUploadChunkWs(
            vaultId = vaultId,
            uploadId = created.session.uploadId,
            chunkIndex = range.chunkIndex,
            contentBase64 = VaultSyncCrypto.bytesToBase64(chunk),
          )
        }
      }
      return completeUploadSession(vaultId, created.session.uploadId)
    } catch (err: Exception) {
      runCatching { abortUploadSession(vaultId, created.session.uploadId) }
      throw err
    }
  }

  private data class CreatedUpload(
    val session: VaultSyncUploadSessionWire,
    val http: VaultSyncHttpUploadWire?,
    val objectUpload: VaultSyncObjectUploadWire?,
  )

  private data class VaultSyncObjectUploadWire(
    val url: String,
    val headers: Map<String, String>,
  )

  private suspend fun createUploadSession(
    vaultId: String,
    deviceId: String,
    ciphertextHash: String,
    totalSizeBytes: Int,
    chunkSize: Int,
  ): CreatedUpload {
    val raw =
      rpc.request(
        "knowledge.vault-sync.blobs.upload-session.create",
        buildJsonObject {
            put("vaultId", vaultId)
            put("deviceId", deviceId)
            put("ciphertextHash", ciphertextHash)
            put("totalSizeBytes", totalSizeBytes)
            put("chunkSize", chunkSize)
          }
          .toString(),
      )
    val obj = json.parseToJsonElement(raw).jsonObject
    val sessionObj = obj["session"]?.jsonObject ?: error("upload session create failed")
    val uploadId = sessionObj["uploadId"]?.jsonPrimitive?.contentOrNull.orEmpty()
    require(uploadId.isNotEmpty()) { "upload session create failed" }
    val session =
      VaultSyncUploadSessionWire(
        uploadId = uploadId,
        chunkSize = sessionObj["chunkSize"]?.jsonPrimitive?.intOrNull ?: chunkSize,
        chunkCount = sessionObj["chunkCount"]?.jsonPrimitive?.intOrNull ?: 1,
      )
    val httpObj = obj["httpUpload"]?.jsonObject
    val http =
      if (httpObj != null) {
        val token = httpObj["token"]?.jsonPrimitive?.contentOrNull.orEmpty()
        val template =
          httpObj["chunkPutPathTemplate"]?.jsonPrimitive?.contentOrNull
            ?: VaultSyncConstants.HTTP_CHUNK_PATH_TEMPLATE
        if (token.isNotEmpty()) VaultSyncHttpUploadWire(token, template) else null
      } else {
        null
      }
    val objectObj = obj["objectUpload"]?.jsonObject?.get("put")?.jsonObject
    val objectUpload =
      if (objectObj != null) {
        val url = objectObj["url"]?.jsonPrimitive?.contentOrNull.orEmpty()
        if (url.isNotEmpty()) {
          val headers =
            objectObj["headers"]?.jsonObject?.entries?.associate { (k, v) ->
              k to (v.jsonPrimitive.contentOrNull.orEmpty())
            } ?: emptyMap()
          VaultSyncObjectUploadWire(url, headers)
        } else {
          null
        }
      } else {
        null
      }
    return CreatedUpload(session, http, objectUpload)
  }

  private suspend fun putObjectUploadDirect(
    objectUpload: VaultSyncObjectUploadWire,
    ciphertext: ByteArray,
  ) =
    withContext(Dispatchers.IO) {
      val body = ciphertext.toRequestBody("application/octet-stream".toMediaType())
      val builder = Request.Builder().url(objectUpload.url).put(body)
      for ((key, value) in objectUpload.headers) {
        builder.header(key, value)
      }
      httpClient.newCall(builder.build()).execute().use { response ->
        if (!response.isSuccessful) {
          val text = response.body.string()
          error(text.ifBlank { "object upload failed (${response.code})" })
        }
      }
    }

  private suspend fun putUploadChunkWs(
    vaultId: String,
    uploadId: String,
    chunkIndex: Int,
    contentBase64: String,
  ) {
    rpc.request(
      "knowledge.vault-sync.blobs.upload-session.put-chunk",
      buildJsonObject {
          put("vaultId", vaultId)
          put("uploadId", uploadId)
          put("chunkIndex", chunkIndex)
          put("contentBase64", contentBase64)
        }
        .toString(),
    )
  }

  private suspend fun putUploadChunkHttp(
    vaultId: String,
    uploadId: String,
    chunkIndex: Int,
    bytes: ByteArray,
    uploadToken: String,
    chunkPutPathTemplate: String,
    httpOrigin: String,
  ) =
    withContext(Dispatchers.IO) {
      val url =
        VaultSyncBlobUpload.buildChunkPutUrl(
          template = chunkPutPathTemplate,
          vaultId = vaultId,
          uploadId = uploadId,
          chunkIndex = chunkIndex,
          httpOrigin = httpOrigin,
        )
      val body = bytes.toRequestBody("application/octet-stream".toMediaType())
      val request =
        Request.Builder()
          .url(url)
          .put(body)
          .header("X-OpenBot-Vault-Upload-Token", uploadToken)
          .header("Content-Type", "application/octet-stream")
          .build()
      httpClient.newCall(request).execute().use { response ->
        if (!response.isSuccessful) {
          val text = response.body.string()
          error(text.ifBlank { "http chunk upload failed (${response.code})" })
        }
      }
    }

  private suspend fun completeUploadSession(vaultId: String, uploadId: String): String {
    val raw =
      rpc.request(
        "knowledge.vault-sync.blobs.upload-session.complete",
        buildJsonObject {
            put("vaultId", vaultId)
            put("uploadId", uploadId)
          }
          .toString(),
      )
    val blobId = json.parseToJsonElement(raw).jsonObject["blobId"]?.jsonPrimitive?.contentOrNull
    require(!blobId.isNullOrBlank()) { "upload session complete failed" }
    return blobId
  }

  private suspend fun abortUploadSession(vaultId: String, uploadId: String) {
    rpc.request(
      "knowledge.vault-sync.blobs.upload-session.abort",
      buildJsonObject {
          put("vaultId", vaultId)
          put("uploadId", uploadId)
        }
        .toString(),
    )
  }

  suspend fun getBlob(vaultId: String, blobId: String): ByteArray {
    val raw =
      rpc.request(
        "knowledge.vault-sync.blobs.get",
        buildJsonObject {
            put("vaultId", vaultId)
            put("blobId", blobId)
          }
          .toString(),
      )
    val b64 = json.parseToJsonElement(raw).jsonObject["contentBase64"]?.jsonPrimitive?.contentOrNull
    require(!b64.isNullOrBlank()) { "blob missing" }
    return VaultSyncCrypto.base64ToBytes(b64)
  }

  suspend fun commitRevision(revision: JsonObject, idempotencyKey: String): String {
    val raw =
      rpc.request(
        "knowledge.vault-sync.revisions.commit",
        buildJsonObject {
            put("revision", revision)
            put("idempotencyKey", idempotencyKey)
          }
          .toString(),
      )
    val result = json.parseToJsonElement(raw).jsonObject["result"]?.jsonObject
    return result?.get("status")?.jsonPrimitive?.contentOrNull ?: "rejected"
  }

  suspend fun listRevisionsSince(
    vaultId: String,
    cursor: String?,
    limit: Int = 100,
  ): Pair<List<VaultSyncRevisionWire>, String?> {
    val raw =
      rpc.request(
        "knowledge.vault-sync.revisions.list-since",
        buildJsonObject {
            put("vaultId", vaultId)
            if (cursor != null) put("cursor", cursor) else put("cursor", JsonNull)
            put("limit", limit)
          }
          .toString(),
      )
    val obj = json.parseToJsonElement(raw).jsonObject
    val revisions =
      obj["revisions"]?.jsonArray?.map { el ->
        val r = el.jsonObject
        VaultSyncRevisionWire(
          vaultId = r.str("vaultId"),
          opaquePathId = r.str("opaquePathId"),
          revisionId = r.str("revisionId"),
          parentRevisionIds =
            r["parentRevisionIds"]?.jsonArray?.mapNotNull { it.jsonPrimitive.contentOrNull }
              ?: emptyList(),
          deviceId = r.str("deviceId"),
          deviceSequence = r["deviceSequence"]?.jsonPrimitive?.longOrNull ?: 0L,
          encryptedMetadataB64 = r.str("encryptedMetadataB64"),
          ciphertextBlobId = r["ciphertextBlobId"]?.jsonPrimitive?.contentOrNull,
          plaintextSize = r["plaintextSize"]?.jsonPrimitive?.longOrNull ?: 0L,
          ciphertextHash = r.str("ciphertextHash"),
          tombstone = r["tombstone"]?.jsonPrimitive?.booleanOrNull == true,
          createdAt = r.str("createdAt"),
          protocolVersion = r["protocolVersion"]?.jsonPrimitive?.intOrNull ?: 1,
          encryptionVersion = r["encryptionVersion"]?.jsonPrimitive?.intOrNull ?: 1,
        )
      } ?: emptyList()
    val next = obj["nextCursor"]?.jsonPrimitive?.contentOrNull
    return revisions to next
  }

  private fun JsonObject.str(key: String): String =
    this[key]?.jsonPrimitive?.contentOrNull?.trim().orEmpty()
}

fun vaultSyncRevisionJson(rev: VaultSyncRevisionWire): JsonObject =
  buildJsonObject {
    put("vaultId", rev.vaultId)
    put("opaquePathId", rev.opaquePathId)
    put("revisionId", rev.revisionId)
    put("parentRevisionIds", JsonArray(rev.parentRevisionIds.map { JsonPrimitive(it) }))
    put("deviceId", rev.deviceId)
    put("deviceSequence", rev.deviceSequence)
    put("encryptedMetadataB64", rev.encryptedMetadataB64)
    if (rev.ciphertextBlobId == null) {
      put("ciphertextBlobId", JsonNull)
    } else {
      put("ciphertextBlobId", rev.ciphertextBlobId)
    }
    put("plaintextSize", rev.plaintextSize)
    put("ciphertextHash", rev.ciphertextHash)
    put("tombstone", rev.tombstone)
    put("createdAt", rev.createdAt)
    put("protocolVersion", rev.protocolVersion)
    put("encryptionVersion", rev.encryptionVersion)
  }
