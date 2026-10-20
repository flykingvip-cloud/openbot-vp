package ai.openbot.app.vaultsync

import android.util.Base64
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.security.MessageDigest
import java.security.SecureRandom
import javax.crypto.Cipher
import javax.crypto.Mac
import javax.crypto.spec.GCMParameterSpec
import javax.crypto.spec.SecretKeySpec
import org.bouncycastle.crypto.generators.SCrypt

/** Mobile crypto port of `ui/src/ui/vault-sync/client-crypto.ts` (wire-compatible). */
object VaultSyncCrypto {
  const val PROTOCOL_VERSION = VaultSyncConstants.PROTOCOL_VERSION
  private const val NONCE_LEN = 12
  private const val TAG_LEN = 16

  data class ScryptParams(val N: Int = 16384, val r: Int = 8, val p: Int = 1, val dkLen: Int = 32)

  data class VaultKeySet(
    val contentKey: ByteArray,
    val metadataKey: ByteArray,
    val pathLookupKey: ByteArray,
    val manifestAuthKey: ByteArray,
  )

  private val hkdfInfo =
    mapOf(
      "content" to "openbot-vault-sync/content/v1",
      "metadata" to "openbot-vault-sync/metadata/v1",
      "pathLookup" to "openbot-vault-sync/path-lookup/v1",
      "manifest" to "openbot-vault-sync/manifest-auth/v1",
    )

  fun utf8(s: String): ByteArray = s.toByteArray(Charsets.UTF_8)

  fun bytesToBase64(bytes: ByteArray): String = Base64.encodeToString(bytes, Base64.NO_WRAP)

  fun base64ToBytes(b64: String): ByteArray = Base64.decode(b64, Base64.DEFAULT)

  fun bytesToBase64Url(bytes: ByteArray): String =
    bytesToBase64(bytes).replace('+', '-').replace('/', '_').replace("=", "")

  fun bytesToHex(bytes: ByteArray): String = bytes.joinToString("") { "%02x".format(it) }

  fun hexToBytes(hex: String): ByteArray {
    val n = hex.trim()
    require(n.length % 2 == 0)
    return ByteArray(n.length / 2) { i -> n.substring(i * 2, i * 2 + 2).toInt(16).toByte() }
  }

  fun sha256(bytes: ByteArray): ByteArray = MessageDigest.getInstance("SHA-256").digest(bytes)

  fun sha256Hex(bytes: ByteArray): String = bytesToHex(sha256(bytes))

  fun hmacSha256(key: ByteArray, data: ByteArray): ByteArray {
    val mac = Mac.getInstance("HmacSHA256")
    mac.init(SecretKeySpec(key, "HmacSHA256"))
    return mac.doFinal(data)
  }

  fun concat(vararg parts: ByteArray): ByteArray {
    val total = parts.sumOf { it.size }
    val out = ByteArray(total)
    var offset = 0
    for (part in parts) {
      System.arraycopy(part, 0, out, offset, part.size)
      offset += part.size
    }
    return out
  }

  fun hkdfSha256(ikm: ByteArray, salt: ByteArray, info: ByteArray, length: Int): ByteArray {
    val prk = hmacSha256(salt, ikm)
    val out = ByteArray(length)
    var prev = ByteArray(0)
    var offset = 0
    var counter = 1
    while (offset < length) {
      val block = hmacSha256(prk, concat(prev, info, byteArrayOf(counter.toByte())))
      val take = minOf(block.size, length - offset)
      System.arraycopy(block, 0, out, offset, take)
      offset += take
      prev = block
      counter += 1
    }
    return out
  }

  private fun hkdfInfoLabel(base: String, encryptionVersion: Int): ByteArray =
    if (encryptionVersion <= 1) utf8(base) else utf8("$base/epoch/$encryptionVersion")

  fun deriveBaseKey(password: String, salt: ByteArray, kdf: ScryptParams = ScryptParams()): ByteArray {
    require(password.isNotEmpty()) { "password required" }
    return SCrypt.generate(utf8(password), salt, kdf.N, kdf.r, kdf.p, kdf.dkLen)
  }

  fun deriveVaultKeySet(baseKey: ByteArray, encryptionVersion: Int = 1): VaultKeySet {
    val salt = ByteArray(32)
    return VaultKeySet(
      contentKey =
        hkdfSha256(baseKey, salt, hkdfInfoLabel(hkdfInfo.getValue("content"), encryptionVersion), 32),
      metadataKey =
        hkdfSha256(baseKey, salt, hkdfInfoLabel(hkdfInfo.getValue("metadata"), encryptionVersion), 32),
      pathLookupKey =
        hkdfSha256(
          baseKey,
          salt,
          hkdfInfoLabel(hkdfInfo.getValue("pathLookup"), encryptionVersion),
          32,
        ),
      manifestAuthKey =
        hkdfSha256(baseKey, salt, hkdfInfoLabel(hkdfInfo.getValue("manifest"), encryptionVersion), 32),
    )
  }

  fun unlockVaultKeys(
    password: String,
    saltB64: String,
    kdf: ScryptParams = ScryptParams(),
    encryptionVersion: Int = 1,
    baseKey: ByteArray? = null,
  ): VaultKeySet {
    val resolved = baseKey ?: deriveBaseKey(password, base64ToBytes(saltB64), kdf)
    return deriveVaultKeySet(resolved, encryptionVersion)
  }

  fun buildAad(vaultId: String, opaquePathId: String, revisionId: String, encryptionVersion: Int = 1):
    ByteArray = utf8("$vaultId|$opaquePathId|$revisionId|$encryptionVersion")

  fun buildContentAad(
    vaultId: String,
    opaquePathId: String,
    deviceId: String,
    deviceSequence: Long,
    encryptionVersion: Int = 1,
  ): ByteArray = utf8("$vaultId|$opaquePathId|$deviceId|$deviceSequence|$encryptionVersion")

  fun encryptAead(
    key: ByteArray,
    plaintext: ByteArray,
    vaultId: String,
    opaquePathId: String,
    revisionId: String,
    encryptionVersion: Int = 1,
    nonce: ByteArray? = null,
    aad: ByteArray? = null,
  ): ByteArray {
    require(key.size == 32) { "encryption failed" }
    val iv = nonce ?: ByteArray(NONCE_LEN).also { SecureRandom().nextBytes(it) }
    require(iv.size == NONCE_LEN) { "encryption failed" }
    val associated = aad ?: buildAad(vaultId, opaquePathId, revisionId, encryptionVersion)
    val cipher = Cipher.getInstance("AES/GCM/NoPadding")
    cipher.init(Cipher.ENCRYPT_MODE, SecretKeySpec(key, "AES"), GCMParameterSpec(TAG_LEN * 8, iv))
    cipher.updateAAD(associated)
    val encrypted = cipher.doFinal(plaintext) // ciphertext||tag
    return concat(iv, encrypted)
  }

  fun decryptAead(
    key: ByteArray,
    ciphertext: ByteArray,
    vaultId: String,
    opaquePathId: String,
    revisionId: String,
    encryptionVersion: Int = 1,
    aad: ByteArray? = null,
  ): ByteArray {
    require(key.size == 32 && ciphertext.size >= NONCE_LEN + TAG_LEN) { "decryption failed" }
    val iv = ciphertext.copyOfRange(0, NONCE_LEN)
    val payload = ciphertext.copyOfRange(NONCE_LEN, ciphertext.size)
    val associated = aad ?: buildAad(vaultId, opaquePathId, revisionId, encryptionVersion)
    return try {
      val cipher = Cipher.getInstance("AES/GCM/NoPadding")
      cipher.init(Cipher.DECRYPT_MODE, SecretKeySpec(key, "AES"), GCMParameterSpec(TAG_LEN * 8, iv))
      cipher.updateAAD(associated)
      cipher.doFinal(payload)
    } catch (_: Exception) {
      throw IllegalStateException("decryption failed")
    }
  }

  fun computeOpaquePathId(pathLookupKey: ByteArray, relativePath: String): String {
    val normalized =
      relativePath.replace('\\', '/').removePrefix("./").removePrefix("/").trim()
    require(normalized.isNotEmpty() && !normalized.contains("..")) { "invalid relative path" }
    return bytesToBase64Url(hmacSha256(pathLookupKey, utf8(normalized)))
  }

  fun encodeUint64Be(n: Long): ByteArray =
    ByteBuffer.allocate(8).order(ByteOrder.BIG_ENDIAN).putLong(n).array()

  fun computeRevisionId(
    vaultId: String,
    opaquePathId: String,
    deviceId: String,
    deviceSequence: Long,
    ciphertextHash: String,
    parentRevisionIds: List<String>,
    protocolVersion: Int = PROTOCOL_VERSION,
  ): String {
    val parents = parentRevisionIds.map { it.trim() }.filter { it.isNotEmpty() }.sorted()
    val parts =
      concat(
        utf8(vaultId),
        byteArrayOf(0),
        utf8(opaquePathId),
        byteArrayOf(0),
        utf8(deviceId),
        byteArrayOf(0),
        encodeUint64Be(deviceSequence),
        byteArrayOf(0),
        utf8(ciphertextHash),
        byteArrayOf(0),
        utf8(parents.joinToString("\n")),
        byteArrayOf(0),
        utf8(protocolVersion.toString()),
      )
    return bytesToBase64Url(sha256(parts))
  }
}
