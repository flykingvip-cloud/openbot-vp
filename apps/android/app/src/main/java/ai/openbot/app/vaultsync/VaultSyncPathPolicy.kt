package ai.openbot.app.vaultsync

/** Local path policy — mirrors `src/vault-sync/journal/excludes.ts`. */
object VaultSyncPathPolicy {
  private val alwaysExcludeSubstrings =
    listOf(
      "/.openbot/",
      "/.openclaw/",
      "/node_modules/",
      "/.git/",
      "/embeddings/",
      "/.vault-sync/",
    )

  private val alwaysExcludeSuffixes = listOf(".DS_Store", "~", ".swp", ".swo", ".lock")

  fun normalize(relativePath: String): String =
    relativePath.replace('\\', '/').trim().trimStart('/')

  fun isAlwaysExcluded(relativePath: String): Boolean {
    val norm = "/" + normalize(relativePath) + "/"
    if (alwaysExcludeSubstrings.any { norm.contains(it) }) return true
    val base = normalize(relativePath)
    if (base.startsWith(".openbot/") || base.startsWith("embeddings/") || base.startsWith(".vault-sync/")) {
      return true
    }
    return alwaysExcludeSuffixes.any { base.endsWith(it) }
  }

  fun isSafeRelativePath(relativePath: String): Boolean {
    val norm = normalize(relativePath)
    if (norm.isEmpty() || norm.contains("..")) return false
    return !isAlwaysExcluded(norm)
  }
}
