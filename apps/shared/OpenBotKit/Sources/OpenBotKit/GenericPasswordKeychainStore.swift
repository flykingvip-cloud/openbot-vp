import Foundation
import Security

public enum GenericPasswordKeychainStore {
    public static func loadString(service: String, account: String) -> String? {
        guard let data = self.loadData(service: service, account: account) else { return nil }
        return String(data: data, encoding: .utf8)
    }

    @discardableResult
    public static func saveString(
        _ value: String,
        service: String,
        account: String,
        accessible: CFString = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
    ) -> Bool {
        self.saveData(Data(value.utf8), service: service, account: account, accessible: accessible)
    }

    @discardableResult
    public static func delete(service: String, account: String) -> Bool {
        let query = self.baseQuery(service: service, account: account)
        let status = SecItemDelete(query as CFDictionary)
        return status == errSecSuccess || status == errSecItemNotFound
    }

    public static func loadData(service: String, account: String) -> Data? {
        var query = self.baseQuery(service: service, account: account)
        query[kSecReturnData as String] = true
        query[kSecMatchLimit as String] = kSecMatchLimitOne

        var item: CFTypeRef?
        let status = SecItemCopyMatching(query as CFDictionary, &item)
        guard status == errSecSuccess, let data = item as? Data else { return nil }
        return data
    }

    /// Prefer `SecItemUpdate` when the item already exists so Keychain ACL is not
    /// re-prompted by delete-then-add on every save. Fall back to `SecItemAdd`
    /// only when the item is missing.
    @discardableResult
    public static func saveData(
        _ data: Data,
        service: String,
        account: String,
        accessible: CFString = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
    ) -> Bool {
        let query = self.baseQuery(service: service, account: account)
        let attributes: [String: Any] = [
            kSecValueData as String: data,
        ]

        let updateStatus = SecItemUpdate(query as CFDictionary, attributes as CFDictionary)
        if updateStatus == errSecSuccess {
            return true
        }
        guard updateStatus == errSecItemNotFound else {
            return false
        }

        var insert = query
        insert[kSecValueData as String] = data
        insert[kSecAttrAccessible as String] = accessible
        return SecItemAdd(insert as CFDictionary, nil) == errSecSuccess
    }

    private static func baseQuery(service: String, account: String) -> [String: Any] {
        [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
        ]
    }
}
