package ai.openbot.app.vaultsync

import java.io.File
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json

@Serializable
data class VaultSyncBaselineEntry(
  val relativePath: String,
  val sizeBytes: Long,
  val mtimeMs: Long,
  val lastRevisionId: String? = null,
)

@Serializable
data class VaultSyncBaselineFile(
  val vaultId: String,
  val deviceId: String,
  val entries: MutableMap<String, VaultSyncBaselineEntry> = linkedMapOf(),
)

/** Local inventory baseline under device state dir (mtime/size skip). */
class VaultSyncInventoryBaseline(
  private val fileStore: VaultSyncLocalFileStore,
  private val json: Json = Json { ignoreUnknownKeys = true; prettyPrint = false },
) {
  private fun file(vaultId: String, deviceId: String): File =
    File(fileStore.deviceStateDir(vaultId, deviceId), "inventory-baseline.json")

  fun load(vaultId: String, deviceId: String): VaultSyncBaselineFile {
    val f = file(vaultId, deviceId)
    if (!f.exists()) {
      return VaultSyncBaselineFile(vaultId = vaultId, deviceId = deviceId)
    }
    return runCatching {
        json.decodeFromString(VaultSyncBaselineFile.serializer(), f.readText())
      }
      .getOrElse { VaultSyncBaselineFile(vaultId = vaultId, deviceId = deviceId) }
  }

  fun save(baseline: VaultSyncBaselineFile) {
    val f = file(baseline.vaultId, baseline.deviceId)
    f.parentFile?.mkdirs()
    f.writeText(json.encodeToString(VaultSyncBaselineFile.serializer(), baseline))
  }

  fun changed(baseline: VaultSyncBaselineFile, relativePath: String, sizeBytes: Long, mtimeMs: Long):
    Boolean {
    val prev = baseline.entries[relativePath] ?: return true
    return prev.sizeBytes != sizeBytes || prev.mtimeMs != mtimeMs
  }

  fun upsert(
    baseline: VaultSyncBaselineFile,
    relativePath: String,
    sizeBytes: Long,
    mtimeMs: Long,
    lastRevisionId: String?,
  ) {
    baseline.entries[relativePath] =
      VaultSyncBaselineEntry(relativePath, sizeBytes, mtimeMs, lastRevisionId)
  }

  fun remove(baseline: VaultSyncBaselineFile, relativePath: String) {
    baseline.entries.remove(relativePath)
  }
}
