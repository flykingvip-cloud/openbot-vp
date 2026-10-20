//
//  EmployeeAccountStore.swift
//  Account-scoped secure storage (task 1.3-ios).
//
//  Implements the secure-storage half of account-session-model.md:
//  - Every persistent key is namespaced `openbot.account.<accountId>.…`; globals are
//    `openbot.active-account` / `openbot.app-lock` (+ a local `openbot.accounts.index`
//    to enumerate known accounts).
//  - Credentials/session tokens live ONLY in the Keychain (invariant 6): nothing goes
//    to UserDefaults.
//  - `accountId` is recomputable from `{gatewayBaseURL,userEmail}` and never embeds the
//    plaintext email in a key name (invariant 7).
//
//  Backed by the app's existing `KeychainStore` (→ `GenericPasswordKeychainStore`).
//

import Foundation
import OpenBotKit

/// App-lock / biometric policy (R10.7). Wave 1 keeps this minimal; the value is a
/// global secure key so it survives account switches.
enum EmployeeAppLockPolicy: String, Codable, Sendable {
    case none
    case biometric
}

/// Namespaced secure store for employee accounts. All reads/writes go through the
/// Keychain; nothing sensitive is mirrored to `UserDefaults`.
enum EmployeeAccountStore {
    /// Dedicated Keychain service, separate from the node/gateway services
    /// (`ai.openbot.gateway` / `ai.openbot.node`) so employee and node identities stay
    /// orthogonal (invariant 5).
    static let service = "ai.openbot.employee"

    // Global (non-account-scoped) keys.
    private static let activeAccountKey = "openbot.active-account"
    private static let appLockKey = "openbot.app-lock"
    private static let accountsIndexKey = "openbot.accounts.index"

    /// Per-account namespaced fields → `openbot.account.<accountId>.<field>`.
    private enum Field: String {
        case userEmail
        case gatewayBaseURL
        case activeOrgId
        case credential
        case webDataStoreId
        case pushToken // Wave 2
    }

    private static func key(_ accountId: String, _ field: Field) -> String {
        "openbot.account.\(accountId).\(field.rawValue)"
    }

    // MARK: Account persistence

    /// Persist (or update) an account's non-secret metadata and register it in the index.
    /// Credentials are written separately via `saveCredential(_:for:)`.
    @discardableResult
    static func upsert(_ account: EmployeeAccount) -> Bool {
        let id = account.accountId
        var ok = KeychainStore.saveString(account.userEmail, service: self.service, account: self.key(id, .userEmail))
        ok = KeychainStore.saveString(
            account.gatewayBaseURL.absoluteString, service: self.service, account: self.key(id, .gatewayBaseURL)) && ok
        ok = KeychainStore.saveString(
            account.webDataStoreId.uuidString, service: self.service, account: self.key(id, .webDataStoreId)) && ok
        if let orgId = account.activeOrgId, !orgId.isEmpty {
            ok = KeychainStore.saveString(orgId, service: self.service, account: self.key(id, .activeOrgId)) && ok
        } else {
            _ = KeychainStore.delete(service: self.service, account: self.key(id, .activeOrgId))
        }
        self.addToIndex(id)
        return ok
    }

    /// Reconstruct an account from its namespaced secure fields.
    static func load(accountId: String) -> EmployeeAccount? {
        guard
            let email = KeychainStore.loadString(service: self.service, account: self.key(accountId, .userEmail)),
            let baseURLString = KeychainStore.loadString(
                service: self.service, account: self.key(accountId, .gatewayBaseURL)),
            let baseURL = URL(string: baseURLString)
        else {
            return nil
        }
        let orgId = KeychainStore.loadString(service: self.service, account: self.key(accountId, .activeOrgId))
        let storeIdString = KeychainStore.loadString(
            service: self.service, account: self.key(accountId, .webDataStoreId))
        // A missing/corrupt data-store id is recovered with a fresh one so the account
        // is still usable (a new isolated WebView store is created on next bootstrap).
        let storeId = storeIdString.flatMap { UUID(uuidString: $0) } ?? UUID()
        let account = EmployeeAccount(
            gatewayBaseURL: baseURL,
            userEmail: email,
            activeOrgId: (orgId?.isEmpty == false) ? orgId : nil,
            webDataStoreId: storeId)
        return account
    }

    static func listAccountIds() -> [String] {
        guard let json = KeychainStore.loadString(service: self.service, account: self.accountsIndexKey),
              let data = json.data(using: .utf8),
              let ids = try? JSONDecoder().decode([String].self, from: data)
        else {
            return []
        }
        return ids
    }

    static func listAccounts() -> [EmployeeAccount] {
        self.listAccountIds().compactMap { self.load(accountId: $0) }
    }

    // MARK: Active account + org

    static func activeAccountId() -> String? {
        let value = KeychainStore.loadString(service: self.service, account: self.activeAccountKey)?
            .trimmingCharacters(in: .whitespacesAndNewlines)
        return (value?.isEmpty == false) ? value : nil
    }

    static func setActiveAccountId(_ accountId: String?) {
        guard let accountId, !accountId.isEmpty else {
            _ = KeychainStore.delete(service: self.service, account: self.activeAccountKey)
            return
        }
        _ = KeychainStore.saveString(accountId, service: self.service, account: self.activeAccountKey)
    }

    /// Switch org for an account (keeps `accountId`; caller must re-bootstrap the shell).
    static func setActiveOrgId(_ orgId: String?, for accountId: String) {
        if let orgId, !orgId.isEmpty {
            _ = KeychainStore.saveString(orgId, service: self.service, account: self.key(accountId, .activeOrgId))
        } else {
            _ = KeychainStore.delete(service: self.service, account: self.key(accountId, .activeOrgId))
        }
    }

    // MARK: Credentials (secure-only)

    /// Opaque credential blob for the account's client session jar (e.g. serialized
    /// platform-auth cookies / refresh token). Secure storage only.
    static func loadCredential(for accountId: String) -> String? {
        KeychainStore.loadString(service: self.service, account: self.key(accountId, .credential))
    }

    @discardableResult
    static func saveCredential(_ value: String, for accountId: String) -> Bool {
        KeychainStore.saveString(value, service: self.service, account: self.key(accountId, .credential))
    }

    static func deleteCredential(for accountId: String) {
        _ = KeychainStore.delete(service: self.service, account: self.key(accountId, .credential))
    }


    // MARK: Push token (Wave 2)

    /// Device APNs token hex for this account (remote employee push). Secure storage only.
    static func loadPushToken(for accountId: String) -> String? {
        KeychainStore.loadString(service: self.service, account: self.key(accountId, .pushToken))
    }

    @discardableResult
    static func savePushToken(_ value: String, for accountId: String) -> Bool {
        KeychainStore.saveString(value, service: self.service, account: self.key(accountId, .pushToken))
    }

    static func deletePushToken(for accountId: String) {
        _ = KeychainStore.delete(service: self.service, account: self.key(accountId, .pushToken))
    }

    // MARK: App-lock policy (global)

    static func appLockPolicy() -> EmployeeAppLockPolicy {
        let raw = KeychainStore.loadString(service: self.service, account: self.appLockKey)
        return raw.flatMap { EmployeeAppLockPolicy(rawValue: $0) } ?? .none
    }

    static func setAppLockPolicy(_ policy: EmployeeAppLockPolicy) {
        _ = KeychainStore.saveString(policy.rawValue, service: self.service, account: self.appLockKey)
    }

    // MARK: Removal

    /// Remove ALL namespaced data for an account (logout + delete). Leaves other
    /// accounts and node pairing untouched.
    static func remove(accountId: String) {
        for field in [Field.userEmail, .gatewayBaseURL, .activeOrgId, .credential, .webDataStoreId, .pushToken] {
            _ = KeychainStore.delete(service: self.service, account: self.key(accountId, field))
        }
        self.removeFromIndex(accountId)
        if self.activeAccountId() == accountId {
            self.setActiveAccountId(self.listAccountIds().first)
        }
    }

    // MARK: Index maintenance

    private static func addToIndex(_ accountId: String) {
        var ids = self.listAccountIds()
        guard !ids.contains(accountId) else { return }
        ids.append(accountId)
        self.writeIndex(ids)
    }

    private static func removeFromIndex(_ accountId: String) {
        let ids = self.listAccountIds().filter { $0 != accountId }
        self.writeIndex(ids)
    }

    private static func writeIndex(_ ids: [String]) {
        guard let data = try? JSONEncoder().encode(ids),
              let json = String(data: data, encoding: .utf8)
        else { return }
        _ = KeychainStore.saveString(json, service: self.service, account: self.accountsIndexKey)
    }
}
