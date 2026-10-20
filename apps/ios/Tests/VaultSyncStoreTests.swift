import Foundation
import Testing
@testable import OpenBot

@Suite struct VaultSyncPathPolicyTests {
    @Test func excludesRuntimeDerivatives() {
        #expect(VaultSyncPathPolicy.isAlwaysExcluded(".openbot/index.sqlite"))
        #expect(VaultSyncPathPolicy.isAlwaysExcluded("embeddings/foo.bin"))
        #expect(VaultSyncPathPolicy.isAlwaysExcluded("notes.md~"))
        #expect(!VaultSyncPathPolicy.isAlwaysExcluded("notes.md"))
    }

    @Test func rejectsPathTraversal() {
        #expect(!VaultSyncPathPolicy.isSafeRelativePath("../secret.md"))
        #expect(VaultSyncPathPolicy.isSafeRelativePath("folder/note.md"))
    }
}

@Suite struct VaultSyncSecureStoreTests {
    @Test func bindingRoundTripUsesBackendOnly() {
        let backend = MemoryVaultSyncSecureStoreBackend()
        let binding = VaultSyncBinding(
            vaultId: "vault-1",
            deviceId: "device-a",
            saltB64: "c2FsdA==",
            encryptionVersion: 1,
            rememberPassword: false
        )
        #expect(VaultSyncSecureStore.saveBinding(binding, backend: backend))
        #expect(VaultSyncSecureStore.loadBinding(vaultId: "vault-1", backend: backend) == binding)
        #expect(VaultSyncSecureStore.listBindings(backend: backend) == [binding])
        #expect(VaultSyncSecureStore.savePassword("secret-pw", vaultId: "vault-1", backend: backend))
        #expect(VaultSyncSecureStore.loadPassword(vaultId: "vault-1", backend: backend) == "secret-pw")
        #expect(VaultSyncSecureStore.deleteBinding(vaultId: "vault-1", backend: backend))
        #expect(VaultSyncSecureStore.loadBinding(vaultId: "vault-1", backend: backend) == nil)
        #expect(VaultSyncSecureStore.loadPassword(vaultId: "vault-1", backend: backend) == nil)
        #expect(VaultSyncSecureStore.listBindings(backend: backend).isEmpty)
    }
}

@Suite struct VaultSyncLocalFileStoreTests {
    @Test func writesUnderVaultFilesAndBlocksUnsafePaths() throws {
        let root = FileManager.default.temporaryDirectory
            .appendingPathComponent("vault-sync-ios-\(UUID().uuidString)", isDirectory: true)
        defer { try? FileManager.default.removeItem(at: root) }
        let store = VaultSyncLocalFileStore(rootURL: root)
        _ = try store.ensureVaultLayout(vaultId: "v1", deviceId: "d1")
        try store.writeFile(vaultId: "v1", relativePath: "notes/a.md", data: Data("# hi\n".utf8))
        let read = try store.readFile(vaultId: "v1", relativePath: "notes/a.md")
        #expect(String(data: read, encoding: .utf8) == "# hi\n")
        #expect(throws: VaultSyncLocalFileStoreError.unsafePath) {
            try store.writeFile(vaultId: "v1", relativePath: "../x.md", data: Data())
        }
    }
}

final class MemoryVaultSyncSecureStoreBackend: VaultSyncSecureStoreBackend, @unchecked Sendable {
    private var values: [String: String] = [:]
    private let lock = NSLock()

    func loadString(account: String) -> String? {
        self.lock.lock()
        defer { self.lock.unlock() }
        return self.values[account]
    }

    func saveString(_ value: String, account: String) -> Bool {
        self.lock.lock()
        defer { self.lock.unlock() }
        self.values[account] = value
        return true
    }

    func delete(account: String) -> Bool {
        self.lock.lock()
        defer { self.lock.unlock() }
        self.values.removeValue(forKey: account)
        return true
    }
}
