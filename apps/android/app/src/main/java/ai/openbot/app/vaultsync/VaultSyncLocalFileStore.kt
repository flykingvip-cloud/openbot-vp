package ai.openbot.app.vaultsync

import java.io.File

/** On-device vault files under app-private storage (not shared/media). */
class VaultSyncLocalFileStore(
  private val rootDir: File,
) {
  companion object {
    fun create(filesDir: File): VaultSyncLocalFileStore =
      VaultSyncLocalFileStore(File(filesDir, VaultSyncConstants.FILES_DIRECTORY_NAME))
  }

  fun vaultFilesDir(vaultId: String): File = File(File(rootDir, vaultId), "files")

  fun deviceStateDir(vaultId: String, deviceId: String): File =
    File(File(File(rootDir, vaultId), "device"), deviceId)

  fun ensureVaultLayout(vaultId: String, deviceId: String): Pair<File, File> {
    val files = vaultFilesDir(vaultId)
    val device = deviceStateDir(vaultId, deviceId)
    if (!files.exists()) files.mkdirs()
    if (!device.exists()) device.mkdirs()
    return files to device
  }

  fun resolveFile(vaultId: String, relativePath: String): File? {
    if (!VaultSyncPathPolicy.isSafeRelativePath(relativePath)) return null
    val norm = VaultSyncPathPolicy.normalize(relativePath)
    return File(vaultFilesDir(vaultId), norm)
  }

  fun writeFile(vaultId: String, relativePath: String, bytes: ByteArray) {
    val file =
      resolveFile(vaultId, relativePath)
        ?: throw VaultSyncLocalFileStoreException("unsafe path")
    file.parentFile?.mkdirs()
    file.writeBytes(bytes)
  }

  fun readFile(vaultId: String, relativePath: String): ByteArray {
    val file =
      resolveFile(vaultId, relativePath)
        ?: throw VaultSyncLocalFileStoreException("unsafe path")
    return file.readBytes()
  }
}

class VaultSyncLocalFileStoreException(message: String) : Exception(message)
