import Foundation

/// On-device vault file root under Application Support (not iCloud by default).
struct VaultSyncLocalFileStore: Sendable {
    let rootURL: URL

    init(applicationSupport: URL = VaultSyncLocalFileStore.defaultApplicationSupport()) {
        self.rootURL = applicationSupport.appendingPathComponent(
            VaultSyncConstants.filesDirectoryName,
            isDirectory: true
        )
    }

    init(rootURL: URL) {
        self.rootURL = rootURL
    }

    static func defaultApplicationSupport() -> URL {
        let base = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask).first
            ?? FileManager.default.temporaryDirectory
        let app = base.appendingPathComponent("OpenBot", isDirectory: true)
        try? FileManager.default.createDirectory(at: app, withIntermediateDirectories: true)
        return app
    }

    func vaultFilesURL(vaultId: String) -> URL {
        self.rootURL
            .appendingPathComponent(vaultId, isDirectory: true)
            .appendingPathComponent("files", isDirectory: true)
    }

    func deviceStateURL(vaultId: String, deviceId: String) -> URL {
        self.rootURL
            .appendingPathComponent(vaultId, isDirectory: true)
            .appendingPathComponent("device", isDirectory: true)
            .appendingPathComponent(deviceId, isDirectory: true)
    }

    @discardableResult
    func ensureVaultLayout(vaultId: String, deviceId: String) throws -> (files: URL, device: URL) {
        let files = self.vaultFilesURL(vaultId: vaultId)
        let device = self.deviceStateURL(vaultId: vaultId, deviceId: deviceId)
        try FileManager.default.createDirectory(at: files, withIntermediateDirectories: true)
        try FileManager.default.createDirectory(at: device, withIntermediateDirectories: true)
        return (files, device)
    }

    func resolveFileURL(vaultId: String, relativePath: String) -> URL? {
        guard VaultSyncPathPolicy.isSafeRelativePath(relativePath) else { return nil }
        let norm = VaultSyncPathPolicy.normalize(relativePath)
        return self.vaultFilesURL(vaultId: vaultId).appendingPathComponent(norm)
    }

    func writeFile(vaultId: String, relativePath: String, data: Data) throws {
        guard let url = self.resolveFileURL(vaultId: vaultId, relativePath: relativePath) else {
            throw VaultSyncLocalFileStoreError.unsafePath
        }
        try FileManager.default.createDirectory(
            at: url.deletingLastPathComponent(),
            withIntermediateDirectories: true
        )
        try data.write(to: url, options: .atomic)
    }

    func readFile(vaultId: String, relativePath: String) throws -> Data {
        guard let url = self.resolveFileURL(vaultId: vaultId, relativePath: relativePath) else {
            throw VaultSyncLocalFileStoreError.unsafePath
        }
        return try Data(contentsOf: url)
    }
}

enum VaultSyncLocalFileStoreError: Error, Equatable {
    case unsafePath
}
