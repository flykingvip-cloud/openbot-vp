package ai.openbot.app.vaultsync

import java.time.Instant
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.longOrNull
import kotlinx.serialization.json.put

/**
 * Real mobile vault sync runner (Wave E/I / P3): unlock → push (≤1MiB direct / >1MiB HTTP session)
 * → pull apply.
 */
class VaultSyncRunner(
  private val gateway: VaultSyncGatewayClient,
  private val secureStore: VaultSyncSecureStore,
  private val fileStore: VaultSyncLocalFileStore,
  private val baselineStore: VaultSyncInventoryBaseline = VaultSyncInventoryBaseline(fileStore),
  private val json: Json = Json { ignoreUnknownKeys = true },
) : VaultSyncRunning {
  override suspend fun runSync(trigger: VaultSyncTrigger): VaultSyncRunResult {
    val bindings = secureStore.listBindings()
    if (bindings.isEmpty()) {
      return VaultSyncRunResult(ok = true, message = "no vault bindings")
    }
    var uploaded = 0
    var downloaded = 0
    val errors = ArrayList<String>()
    for (binding in bindings) {
      val password =
        VaultSyncUnlockMemory.password(binding.vaultId)
          ?: if (binding.rememberPassword) secureStore.loadPassword(binding.vaultId) else null
      if (password.isNullOrEmpty()) {
        errors.add("${binding.vaultId}: locked")
        continue
      }
      try {
        val result = syncVault(binding, password)
        uploaded += result.uploaded
        downloaded += result.downloaded
        errors.addAll(result.errors)
      } catch (err: Exception) {
        errors.add("${binding.vaultId}: ${err.message ?: "sync failed"}")
      }
    }
    val ok = errors.isEmpty() || uploaded + downloaded > 0
    return VaultSyncRunResult(
      ok = ok,
      uploaded = uploaded,
      downloaded = downloaded,
      message = if (errors.isEmpty()) null else errors.take(3).joinToString("; "),
    )
  }

  private data class VaultResult(
    val uploaded: Int,
    val downloaded: Int,
    val errors: List<String>,
  )

  private suspend fun syncVault(binding: VaultSyncBinding, password: String): VaultResult {
    fileStore.ensureVaultLayout(binding.vaultId, binding.deviceId)
    val status = gateway.status(binding.vaultId)
    val keys =
      VaultSyncCrypto.unlockVaultKeys(
        password = password,
        saltB64 = status.saltB64,
        encryptionVersion = status.encryptionVersion,
      )
    val push = pushVault(binding, keys, status.encryptionVersion)
    val pull = pullVault(binding, keys)
    return VaultResult(push.first, pull.first, push.second + pull.second)
  }

  private suspend fun pushVault(
    binding: VaultSyncBinding,
    keys: VaultSyncCrypto.VaultKeySet,
    encryptionVersion: Int,
  ): Pair<Int, List<String>> {
    val errors = ArrayList<String>()
    var uploaded = 0
    var deviceSequence = gateway.deviceLastSequence(binding.vaultId, binding.deviceId)
    val baseline = baselineStore.load(binding.vaultId, binding.deviceId)
    val files = VaultSyncFileWalker.walk(fileStore.vaultFilesDir(binding.vaultId))
    for (entry in files) {
      if (!baselineStore.changed(baseline, entry.relativePath, entry.sizeBytes, entry.mtimeMs)) {
        continue
      }
      try {
        deviceSequence += 1
        val plaintext = entry.file.readBytes()
        val opaquePathId = VaultSyncCrypto.computeOpaquePathId(keys.pathLookupKey, entry.relativePath)
        val parents = gateway.headsForPath(binding.vaultId, opaquePathId)
        val contentAad =
          VaultSyncCrypto.buildContentAad(
            vaultId = binding.vaultId,
            opaquePathId = opaquePathId,
            deviceId = binding.deviceId,
            deviceSequence = deviceSequence,
            encryptionVersion = encryptionVersion,
          )
        val body =
          VaultSyncCrypto.encryptAead(
            key = keys.contentKey,
            plaintext = plaintext,
            vaultId = binding.vaultId,
            opaquePathId = opaquePathId,
            revisionId = "content",
            encryptionVersion = encryptionVersion,
            aad = contentAad,
          )
        val bodyHash = VaultSyncCrypto.sha256Hex(body)
        val revisionId =
          VaultSyncCrypto.computeRevisionId(
            vaultId = binding.vaultId,
            opaquePathId = opaquePathId,
            deviceId = binding.deviceId,
            deviceSequence = deviceSequence,
            ciphertextHash = bodyHash,
            parentRevisionIds = parents,
          )
        val blobId =
          gateway.storeCiphertextBlob(
            vaultId = binding.vaultId,
            deviceId = binding.deviceId,
            ciphertextHash = bodyHash,
            ciphertext = body,
          )
        val metaJson =
          buildJsonObject {
              put("relativePath", entry.relativePath)
              put("fileName", entry.fileName)
              put("mimeType", VaultSyncFileWalker.guessMime(entry.fileName))
              put("mtimeMs", entry.mtimeMs)
            }
            .toString()
        val metaEnc =
          VaultSyncCrypto.encryptAead(
            key = keys.metadataKey,
            plaintext = VaultSyncCrypto.utf8(metaJson),
            vaultId = binding.vaultId,
            opaquePathId = opaquePathId,
            revisionId = revisionId,
            encryptionVersion = encryptionVersion,
          )
        val revision =
          VaultSyncRevisionWire(
            vaultId = binding.vaultId,
            opaquePathId = opaquePathId,
            revisionId = revisionId,
            parentRevisionIds = parents,
            deviceId = binding.deviceId,
            deviceSequence = deviceSequence,
            encryptedMetadataB64 = VaultSyncCrypto.bytesToBase64(metaEnc),
            ciphertextBlobId = blobId,
            plaintextSize = plaintext.size.toLong(),
            ciphertextHash = bodyHash,
            tombstone = false,
            createdAt = Instant.now().toString(),
            protocolVersion = VaultSyncConstants.PROTOCOL_VERSION,
            encryptionVersion = encryptionVersion,
          )
        val status =
          gateway.commitRevision(
            vaultSyncRevisionJson(revision),
            "${binding.deviceId}:$deviceSequence",
          )
        if (status == "accepted" || status == "duplicate" || status == "conflict") {
          if (status != "conflict") uploaded += 1
          baselineStore.upsert(
            baseline,
            entry.relativePath,
            entry.sizeBytes,
            entry.mtimeMs,
            revisionId,
          )
        } else {
          errors.add("${entry.relativePath}: commit $status")
        }
      } catch (err: Exception) {
        errors.add("${entry.relativePath}: ${err.message ?: "push failed"}")
      }
    }
    baselineStore.save(baseline)
    return uploaded to errors
  }

  private suspend fun pullVault(
    binding: VaultSyncBinding,
    keys: VaultSyncCrypto.VaultKeySet,
  ): Pair<Int, List<String>> {
    val errors = ArrayList<String>()
    var applied = 0
    var cursor: String? = null
    val baseline = baselineStore.load(binding.vaultId, binding.deviceId)
    for (page in 0 until 50) {
      val (revisions, next) = gateway.listRevisionsSince(binding.vaultId, cursor)
      for (rev in revisions) {
        if (rev.deviceId == binding.deviceId) continue
        try {
          val metaPlain =
            VaultSyncCrypto.decryptAead(
              key = keys.metadataKey,
              ciphertext = VaultSyncCrypto.base64ToBytes(rev.encryptedMetadataB64),
              vaultId = rev.vaultId,
              opaquePathId = rev.opaquePathId,
              revisionId = rev.revisionId,
              encryptionVersion = rev.encryptionVersion,
            )
          val meta = json.parseToJsonElement(String(metaPlain, Charsets.UTF_8)).jsonObject
          val relativePath = meta["relativePath"]?.jsonPrimitive?.contentOrNull.orEmpty()
          if (relativePath.isEmpty()) {
            errors.add("${rev.revisionId}: missing relativePath")
            continue
          }
          if (rev.tombstone || rev.ciphertextBlobId.isNullOrBlank()) {
            baselineStore.remove(baseline, relativePath)
            applied += 1
            continue
          }
          val ciphertext = gateway.getBlob(rev.vaultId, rev.ciphertextBlobId)
          val contentAad =
            VaultSyncCrypto.buildContentAad(
              vaultId = rev.vaultId,
              opaquePathId = rev.opaquePathId,
              deviceId = rev.deviceId,
              deviceSequence = rev.deviceSequence,
              encryptionVersion = rev.encryptionVersion,
            )
          val plaintext =
            VaultSyncCrypto.decryptAead(
              key = keys.contentKey,
              ciphertext = ciphertext,
              vaultId = rev.vaultId,
              opaquePathId = rev.opaquePathId,
              revisionId = "content",
              encryptionVersion = rev.encryptionVersion,
              aad = contentAad,
            )
          fileStore.writeFile(binding.vaultId, relativePath, plaintext)
          val mtimeMs =
            meta["mtimeMs"]?.jsonPrimitive?.longOrNull ?: System.currentTimeMillis()
          baselineStore.upsert(
            baseline,
            relativePath,
            plaintext.size.toLong(),
            mtimeMs,
            rev.revisionId,
          )
          applied += 1
        } catch (err: Exception) {
          errors.add("${rev.revisionId}: ${err.message ?: "pull failed"}")
        }
      }
      if (next.isNullOrBlank()) break
      cursor = next
    }
    baselineStore.save(baseline)
    return applied to errors
  }
}
