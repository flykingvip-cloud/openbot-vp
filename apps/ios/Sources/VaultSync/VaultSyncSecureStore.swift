import Foundation

/// Durable vault binding metadata (non-secret salt is OK; password is separate).
struct VaultSyncBinding: Codable, Equatable, Sendable {
    var vaultId: String
    var deviceId: String
    var saltB64: String
    var encryptionVersion: Int
    var rememberPassword: Bool
}

protocol VaultSyncSecureStoreBackend: Sendable {
    func loadString(account: String) -> String?
    @discardableResult
    func saveString(_ value: String, account: String) -> Bool
    @discardableResult
    func delete(account: String) -> Bool
}

/// Keychain-backed store for vault-sync secrets. Never writes to UserDefaults.
enum VaultSyncSecureStore {
    static let service = VaultSyncConstants.keychainService

    private static let bindingAccountPrefix = "binding."
    private static let passwordAccountPrefix = "password."
    private static let bindingIndexAccount = "bindings.index"

    static func bindingAccount(vaultId: String) -> String {
        "\(self.bindingAccountPrefix)\(vaultId)"
    }

    static func passwordAccount(vaultId: String) -> String {
        "\(self.passwordAccountPrefix)\(vaultId)"
    }

    static func saveBinding(
        _ binding: VaultSyncBinding,
        backend: VaultSyncSecureStoreBackend = KeychainVaultSyncSecureStoreBackend()
    ) -> Bool {
        guard let data = try? JSONEncoder().encode(binding),
              let json = String(data: data, encoding: .utf8)
        else { return false }
        let ok = backend.saveString(json, account: self.bindingAccount(vaultId: binding.vaultId))
        if ok {
            var ids = self.loadBindingIds(backend: backend)
            if !ids.contains(binding.vaultId) {
                ids.append(binding.vaultId)
                self.saveBindingIds(ids, backend: backend)
            }
        }
        return ok
    }

    static func loadBinding(
        vaultId: String,
        backend: VaultSyncSecureStoreBackend = KeychainVaultSyncSecureStoreBackend()
    ) -> VaultSyncBinding? {
        guard let json = backend.loadString(account: self.bindingAccount(vaultId: vaultId)),
              let data = json.data(using: .utf8),
              let binding = try? JSONDecoder().decode(VaultSyncBinding.self, from: data)
        else { return nil }
        return binding
    }

    static func listBindings(
        backend: VaultSyncSecureStoreBackend = KeychainVaultSyncSecureStoreBackend()
    ) -> [VaultSyncBinding] {
        self.loadBindingIds(backend: backend).compactMap { self.loadBinding(vaultId: $0, backend: backend) }
    }

    static func deleteBinding(
        vaultId: String,
        backend: VaultSyncSecureStoreBackend = KeychainVaultSyncSecureStoreBackend()
    ) -> Bool {
        _ = backend.delete(account: self.passwordAccount(vaultId: vaultId))
        let deleted = backend.delete(account: self.bindingAccount(vaultId: vaultId))
        self.saveBindingIds(
            self.loadBindingIds(backend: backend).filter { $0 != vaultId },
            backend: backend
        )
        return deleted
    }

    private static func loadBindingIds(backend: VaultSyncSecureStoreBackend) -> [String] {
        guard let json = backend.loadString(account: self.bindingIndexAccount),
              let data = json.data(using: .utf8),
              let ids = try? JSONDecoder().decode([String].self, from: data)
        else { return [] }
        return ids
    }

    private static func saveBindingIds(_ ids: [String], backend: VaultSyncSecureStoreBackend) {
        guard let data = try? JSONEncoder().encode(ids),
              let json = String(data: data, encoding: .utf8)
        else { return }
        _ = backend.saveString(json, account: self.bindingIndexAccount)
    }

    /// Optional remember-password. Callers must keep password in memory when remember is false.
    static func savePassword(
        _ password: String,
        vaultId: String,
        backend: VaultSyncSecureStoreBackend = KeychainVaultSyncSecureStoreBackend()
    ) -> Bool {
        backend.saveString(password, account: self.passwordAccount(vaultId: vaultId))
    }

    static func loadPassword(
        vaultId: String,
        backend: VaultSyncSecureStoreBackend = KeychainVaultSyncSecureStoreBackend()
    ) -> String? {
        backend.loadString(account: self.passwordAccount(vaultId: vaultId))
    }

    static func deletePassword(
        vaultId: String,
        backend: VaultSyncSecureStoreBackend = KeychainVaultSyncSecureStoreBackend()
    ) -> Bool {
        backend.delete(account: self.passwordAccount(vaultId: vaultId))
    }
}

struct KeychainVaultSyncSecureStoreBackend: VaultSyncSecureStoreBackend {
    func loadString(account: String) -> String? {
        KeychainStore.loadString(service: VaultSyncSecureStore.service, account: account)
    }

    func saveString(_ value: String, account: String) -> Bool {
        KeychainStore.saveString(value, service: VaultSyncSecureStore.service, account: account)
    }

    func delete(account: String) -> Bool {
        KeychainStore.delete(service: VaultSyncSecureStore.service, account: account)
    }
}

/// Process-memory unlock cache — never persisted.
final class VaultSyncUnlockMemory: @unchecked Sendable {
    static let shared = VaultSyncUnlockMemory()
    private var passwords: [String: String] = [:]
    private let lock = NSLock()

    func setPassword(_ password: String, vaultId: String) {
        self.lock.lock()
        defer { self.lock.unlock() }
        self.passwords[vaultId] = password
    }

    func password(vaultId: String) -> String? {
        self.lock.lock()
        defer { self.lock.unlock() }
        return self.passwords[vaultId]
    }

    func clear(vaultId: String) {
        self.lock.lock()
        defer { self.lock.unlock() }
        self.passwords.removeValue(forKey: vaultId)
    }

    func clearAll() {
        self.lock.lock()
        defer { self.lock.unlock() }
        self.passwords.removeAll()
    }
}
