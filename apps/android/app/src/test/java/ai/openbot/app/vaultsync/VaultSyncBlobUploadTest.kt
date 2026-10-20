package ai.openbot.app.vaultsync

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class VaultSyncBlobUploadTest {
  @Test
  fun iterChunkRangesCoversExactAndPartialTail() {
    val ranges = VaultSyncBlobUpload.iterChunkRanges(totalSizeBytes = 10, chunkSize = 4, chunkCount = 3)
    assertEquals(listOf(0 to 4, 4 to 8, 8 to 10), ranges.map { it.start to it.end })
  }

  @Test
  fun buildChunkPutUrlJoinsOriginAndEncodedIds() {
    val url =
      VaultSyncBlobUpload.buildChunkPutUrl(
        template = VaultSyncConstants.HTTP_CHUNK_PATH_TEMPLATE,
        vaultId = "v/1",
        uploadId = "u 2",
        chunkIndex = 3,
        httpOrigin = "https://gw.example:18789/",
      )
    assertTrue(url.startsWith("https://gw.example:18789/__openbot/vault-sync/v1/"))
    assertTrue(url.contains("/chunks/3"))
    assertTrue(url.contains("v%2F1") || url.contains("v%2f1"))
  }

  @Test
  fun preferredChunkSizePicksHttpWhenAvailable() {
    assertEquals(VaultSyncConstants.HTTP_CHUNK_SIZE, VaultSyncBlobUpload.preferredChunkSize(true))
    assertEquals(VaultSyncConstants.DEFAULT_CHUNK_SIZE, VaultSyncBlobUpload.preferredChunkSize(false))
  }
}
