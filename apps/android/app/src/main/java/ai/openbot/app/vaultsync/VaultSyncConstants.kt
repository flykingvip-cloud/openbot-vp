package ai.openbot.app.vaultsync

/** Protocol constants mirrored from `src/vault-sync/types.ts` (P3.1 / Wave I). */
object VaultSyncConstants {
  const val PROTOCOL_VERSION = 1
  const val ENCRYPTION_VERSION = 1
  const val SECURE_PREFS_NAME = "openbot.vault-sync.secure"
  const val DIRECT_PUT_MAX_BYTES = 1 * 1024 * 1024
  const val DEFAULT_CHUNK_SIZE = 256 * 1024
  /** Preferred HTTP binary chunk size (matches UI `VAULT_SYNC_HTTP_CHUNK_SIZE`). */
  const val HTTP_CHUNK_SIZE = 4 * 1024 * 1024
  const val FILES_DIRECTORY_NAME = "VaultSync"
  const val BACKGROUND_WORK_NAME = "openbot.vault-sync.opportunistic"
  const val HTTP_CHUNK_PATH_TEMPLATE =
    "/__openbot/vault-sync/v1/{vaultId}/{uploadId}/chunks/{chunkIndex}"
}
