import Foundation

struct VaultSyncBaselineEntry: Codable, Equatable, Sendable {
    var relativePath: String
    var sizeBytes: Int64
    var mtimeMs: Int64
    var lastRevisionId: String?
}

struct VaultSyncBaselineFile: Codable, Equatable, Sendable {
    var vaultId: String
    var deviceId: String
    var entries: [String: VaultSyncBaselineEntry]
}

enum VaultSyncInventoryBaseline {
    static func fileURL(fileStore: VaultSyncLocalFileStore, vaultId: String, deviceId: String) -> URL {
        fileStore.deviceStateURL(vaultId: vaultId, deviceId: deviceId)
            .appendingPathComponent("inventory-baseline.json")
    }

    static func load(fileStore: VaultSyncLocalFileStore, vaultId: String, deviceId: String) -> VaultSyncBaselineFile {
        let url = self.fileURL(fileStore: fileStore, vaultId: vaultId, deviceId: deviceId)
        guard
            let data = try? Data(contentsOf: url),
            let decoded = try? JSONDecoder().decode(VaultSyncBaselineFile.self, from: data)
        else {
            return VaultSyncBaselineFile(vaultId: vaultId, deviceId: deviceId, entries: [:])
        }
        return decoded
    }

    static func save(_ baseline: VaultSyncBaselineFile, fileStore: VaultSyncLocalFileStore) throws {
        let url = self.fileURL(
            fileStore: fileStore,
            vaultId: baseline.vaultId,
            deviceId: baseline.deviceId
        )
        try FileManager.default.createDirectory(
            at: url.deletingLastPathComponent(),
            withIntermediateDirectories: true
        )
        let data = try JSONEncoder().encode(baseline)
        try data.write(to: url, options: .atomic)
    }

    static func changed(
        _ baseline: VaultSyncBaselineFile,
        relativePath: String,
        sizeBytes: Int64,
        mtimeMs: Int64
    ) -> Bool {
        guard let prev = baseline.entries[relativePath] else { return true }
        return prev.sizeBytes != sizeBytes || prev.mtimeMs != mtimeMs
    }
}
