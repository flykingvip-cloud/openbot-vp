package ai.openbot.app.vaultsync

import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Test

/**
 * Cross-platform vectors from browser `client-crypto` (bun-generated 2026-07-23).
 * Ensures Android wire format matches Web/Node.
 */
class VaultSyncCryptoTest {
  @Test
  fun unlockAndOpaquePathMatchBrowserVectors() {
    val password = "correct horse battery staple"
    val saltHex = "00112233445566778899aabbccddeeff"
    val keys =
      VaultSyncCrypto.unlockVaultKeys(
        password = password,
        saltB64 = VaultSyncCrypto.bytesToBase64(VaultSyncCrypto.hexToBytes(saltHex)),
      )
    assertEquals(
      "501715d6aa975b61296e14f9b5793ea433a2c823dae5d5c830d9216be07f8c81",
      VaultSyncCrypto.bytesToHex(keys.contentKey),
    )
    assertEquals(
      "90223ae447a1f5d4ea7e5c1c75be2f07b881c5177da3f171341435f4b1ddc85d",
      VaultSyncCrypto.bytesToHex(keys.metadataKey),
    )
    assertEquals(
      "c884d15da7ce2cb98afce453721c61fff0f6aca4835b7ba390205e83308f52ae",
      VaultSyncCrypto.bytesToHex(keys.pathLookupKey),
    )
    val opaque =
      VaultSyncCrypto.computeOpaquePathId(keys.pathLookupKey, "notes/welcome.md")
    assertEquals("q4hCoWXTK-s2rbCe6NVEPF6iRh4hQv-4BpHtb_OW1P4", opaque)
  }

  @Test
  fun encryptAeadMatchesBrowserVectorWithFixedNonce() {
    val password = "correct horse battery staple"
    val saltHex = "00112233445566778899aabbccddeeff"
    val keys =
      VaultSyncCrypto.unlockVaultKeys(
        password = password,
        saltB64 = VaultSyncCrypto.bytesToBase64(VaultSyncCrypto.hexToBytes(saltHex)),
      )
    val vaultId = "11111111-1111-1111-1111-111111111111"
    val opaquePathId = VaultSyncCrypto.computeOpaquePathId(keys.pathLookupKey, "notes/welcome.md")
    val nonce = ByteArray(12) { 7 }
    val body =
      VaultSyncCrypto.encryptAead(
        key = keys.contentKey,
        plaintext = VaultSyncCrypto.utf8("hello vault sync"),
        vaultId = vaultId,
        opaquePathId = opaquePathId,
        revisionId = "rev-fixed-for-aad",
        encryptionVersion = 1,
        nonce = nonce,
      )
    assertEquals(
      "0707070707070707070707077752da5b4d6ff7ffaf6311e42602ef2d215b44b1782ec80f933a6facc9a53e10",
      VaultSyncCrypto.bytesToHex(body),
    )
    assertEquals(
      "478b316e5a0a892a0b996a6ee3d976fac236c4b19ba01143d97d98492ca6e9d1",
      VaultSyncCrypto.sha256Hex(body),
    )
    val plain =
      VaultSyncCrypto.decryptAead(
        key = keys.contentKey,
        ciphertext = body,
        vaultId = vaultId,
        opaquePathId = opaquePathId,
        revisionId = "rev-fixed-for-aad",
      )
    assertArrayEquals(VaultSyncCrypto.utf8("hello vault sync"), plain)
  }
}
