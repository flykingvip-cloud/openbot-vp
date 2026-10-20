package ai.openbot.app.vaultsync

import java.io.File

data class VaultSyncLocalFile(
  val relativePath: String,
  val fileName: String,
  val sizeBytes: Long,
  val mtimeMs: Long,
  val file: File,
)

object VaultSyncFileWalker {
  fun walk(vaultFilesDir: File): List<VaultSyncLocalFile> {
    if (!vaultFilesDir.exists()) return emptyList()
    val out = ArrayList<VaultSyncLocalFile>()
    walkRec(vaultFilesDir, vaultFilesDir, out)
    return out.sortedBy { it.relativePath }
  }

  private fun walkRec(root: File, current: File, out: MutableList<VaultSyncLocalFile>) {
    val children = current.listFiles() ?: return
    for (child in children) {
      if (child.isDirectory) {
        walkRec(root, child, out)
        continue
      }
      if (!child.isFile) continue
      val rel =
        child.relativeTo(root).invariantSeparatorsPath.trimStart('/')
      if (!VaultSyncPathPolicy.isSafeRelativePath(rel)) continue
      out.add(
        VaultSyncLocalFile(
          relativePath = VaultSyncPathPolicy.normalize(rel),
          fileName = child.name,
          sizeBytes = child.length(),
          mtimeMs = child.lastModified(),
          file = child,
        ),
      )
    }
  }

  fun guessMime(fileName: String): String {
    val lower = fileName.lowercase()
    return when {
      lower.endsWith(".md") || lower.endsWith(".markdown") -> "text/markdown"
      lower.endsWith(".txt") -> "text/plain"
      lower.endsWith(".json") -> "application/json"
      lower.endsWith(".png") -> "image/png"
      lower.endsWith(".jpg") || lower.endsWith(".jpeg") -> "image/jpeg"
      lower.endsWith(".pdf") -> "application/pdf"
      else -> "application/octet-stream"
    }
  }
}
