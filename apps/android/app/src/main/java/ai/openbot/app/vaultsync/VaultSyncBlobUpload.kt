package ai.openbot.app.vaultsync

/** Pure helpers for vault-sync ciphertext upload sessions (Wave I). */
object VaultSyncBlobUpload {
  data class ChunkRange(val chunkIndex: Int, val start: Int, val end: Int)

  fun iterChunkRanges(totalSizeBytes: Int, chunkSize: Int, chunkCount: Int): List<ChunkRange> {
    require(totalSizeBytes >= 0)
    require(chunkSize > 0)
    require(chunkCount >= 0)
    val ranges = ArrayList<ChunkRange>(chunkCount)
    for (chunkIndex in 0 until chunkCount) {
      val start = chunkIndex * chunkSize
      val end = minOf(start + chunkSize, totalSizeBytes)
      ranges.add(ChunkRange(chunkIndex, start, end))
    }
    return ranges
  }

  fun buildChunkPutUrl(
    template: String,
    vaultId: String,
    uploadId: String,
    chunkIndex: Int,
    httpOrigin: String,
  ): String {
    val path =
      template
        .replace("{vaultId}", java.net.URLEncoder.encode(vaultId, Charsets.UTF_8.name()))
        .replace("{uploadId}", java.net.URLEncoder.encode(uploadId, Charsets.UTF_8.name()))
        .replace("{chunkIndex}", chunkIndex.toString())
    if (path.startsWith("http://") || path.startsWith("https://")) {
      return path
    }
    val origin = httpOrigin.trimEnd('/')
    require(origin.isNotEmpty()) { "http origin required for vault binary upload" }
    return if (path.startsWith("/")) "$origin$path" else "$origin/$path"
  }

  fun preferredChunkSize(httpAvailable: Boolean): Int =
    if (httpAvailable) VaultSyncConstants.HTTP_CHUNK_SIZE else VaultSyncConstants.DEFAULT_CHUNK_SIZE
}
