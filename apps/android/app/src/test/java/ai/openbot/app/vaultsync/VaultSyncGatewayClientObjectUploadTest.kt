package ai.openbot.app.vaultsync

import kotlinx.coroutines.runBlocking
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Test

/** Wave P: verifies mobile client prefers S3 objectUpload over HTTP gateway chunks. */
class VaultSyncGatewayClientObjectUploadTest {
  @Test
  fun storeCiphertextBlob_prefersObjectUploadOverHttpChunks() = runBlocking {
    val server = MockWebServer()
    server.start()
    try {
      server.enqueue(MockResponse().setResponseCode(200))
      var wsChunkCalls = 0
      val putUrl = server.url("/openbot-vault/vaults/v1/blobs/up-s3.bin").toString()
      val rpc =
        VaultSyncRpc { method, _ ->
          when (method) {
            "knowledge.vault-sync.blobs.upload-session.create" ->
              """
              {
                "session": {"uploadId":"up-s3","chunkSize":262144,"chunkCount":5},
                "objectUpload": {
                  "backend": "s3",
                  "put": {
                    "url": "$putUrl",
                    "headers": {"content-type": "application/octet-stream"}
                  }
                },
                "httpUpload": {
                  "token": "tok",
                  "chunkPutPathTemplate": "/__openbot/vault-sync/v1/{vaultId}/{uploadId}/chunks/{chunkIndex}"
                }
              }
              """.trimIndent()
            "knowledge.vault-sync.blobs.upload-session.complete" -> """{"blobId":"up-s3"}"""
            "knowledge.vault-sync.blobs.upload-session.put-chunk" -> {
              wsChunkCalls += 1
              "{}"
            }
            else -> throw AssertionError("unexpected RPC: $method")
          }
        }
      val client =
        VaultSyncGatewayClient(
          rpc = rpc,
          httpOriginProvider = { "https://gw.example:18789/" },
        )
      val ciphertext = ByteArray(VaultSyncConstants.DIRECT_PUT_MAX_BYTES + 128) { 7 }
      val hash = VaultSyncCrypto.sha256Hex(ciphertext)
      val blobId =
        client.storeCiphertextBlob(
          vaultId = "vault-1",
          deviceId = "device-a",
          ciphertextHash = hash,
          ciphertext = ciphertext,
        )
      assertEquals("up-s3", blobId)
      assertEquals(0, wsChunkCalls)
      val recorded = server.takeRequest()
      assertEquals("PUT", recorded.method)
      assertArrayEquals(ciphertext, recorded.body.readByteArray())
    } finally {
      server.shutdown()
    }
  }
}
