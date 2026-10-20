import Foundation

/// Protocol constants mirrored from `src/vault-sync/types.ts` (P3.1 / Wave I).
enum VaultSyncConstants {
    static let protocolVersion = 1
    static let encryptionVersion = 1
    static let keychainService = "ai.openbot.vault-sync"
    static let directPutMaxBytes = 1 * 1024 * 1024
    static let defaultChunkSize = 256 * 1024
    /// Preferred HTTP binary chunk size (matches UI `VAULT_SYNC_HTTP_CHUNK_SIZE`).
    static let httpChunkSize = 4 * 1024 * 1024
    static let filesDirectoryName = "VaultSync"
    static let backgroundRefreshTaskId = VaultSyncBackgroundRefresh.taskIdentifier
    static let httpChunkPathTemplate =
        "/__openbot/vault-sync/v1/{vaultId}/{uploadId}/chunks/{chunkIndex}"
}
