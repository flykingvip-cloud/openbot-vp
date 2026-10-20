//
//  EmployeeAccountStore.swift
//  Account-scoped session + storage (task 1.3-macos).
//
//  The single owner of the three isolated per-account stores from the contract
//  (`contracts/account-session-model.md`):
//    1. Client Session Jar   — a per-account, NON-`.shared` `URLSession` whose
//       cookie jar carries the employee platform-auth login session (mint auth).
//    2. Employee Shell store  — `WKWebsiteDataStore(forIdentifier:)` (persistent,
//       isolated), replacing the skeleton `.default()` singleton.
//    3. Secure Credential store — Keychain, ONE secrets blob per accountId
//       (credential + pushToken). Non-secret profile lives in UserDefaults.
//
//  Switch account = flip `activeAccountId` + swap store handles (no data wiped).
//  Switch org = keep account, invalidate embed session, re-bootstrap.
//  Logout = clear this account's client jar + webview store + secure creds.
//

import Foundation
import OSLog
import OpenBotKit
import WebKit

@MainActor
final class EmployeeAccountStore {
    static let shared = EmployeeAccountStore()

    private let logger = Logger(subsystem: "ai.openbot", category: "employee-account")
    /// UserDefaults key holding the (non-secret) list of known accountIds so we
    /// can enumerate accounts. `accountId` is a hash, not a secret.
    private static let accountIndexKey = "openbot.employee.account-index"

    /// Live per-account client sessions, keyed by accountId. Cookies are isolated
    /// (ephemeral configuration → dedicated in-memory HTTPCookieStorage) and
    /// rehydrated from the Keychain credential so the login session survives
    /// relaunches without ever using `URLSession.shared`.
    private var clientSessions: [String: URLSession] = [:]

    private let defaults: UserDefaults

    init(defaults: UserDefaults = .standard) {
        self.defaults = defaults
    }

    // MARK: - Active account

    var activeAccountId: String? {
        get {
            if let id = self.defaults.string(forKey: EmployeeAccountKeys.activeAccountKey)?
                .trimmingCharacters(in: .whitespacesAndNewlines),
               !id.isEmpty
            {
                return id
            }
            // Migrate legacy Keychain active-account pointer once.
            if let legacy = self.readSecure(EmployeeAccountKeys.activeAccountKey)?
                .trimmingCharacters(in: .whitespacesAndNewlines),
               !legacy.isEmpty
            {
                self.defaults.set(legacy, forKey: EmployeeAccountKeys.activeAccountKey)
                _ = GenericPasswordKeychainStore.delete(
                    service: EmployeeAccountKeys.keychainService,
                    account: EmployeeAccountKeys.activeAccountKey)
                return legacy
            }
            return nil
        }
        set {
            if let newValue, !newValue.isEmpty {
                self.defaults.set(newValue, forKey: EmployeeAccountKeys.activeAccountKey)
            } else {
                self.defaults.removeObject(forKey: EmployeeAccountKeys.activeAccountKey)
            }
            // Drop legacy Keychain pointer if present.
            _ = GenericPasswordKeychainStore.delete(
                service: EmployeeAccountKeys.keychainService,
                account: EmployeeAccountKeys.activeAccountKey)
        }
    }

    var activeAccount: EmployeeAccount? {
        guard let id = self.activeAccountId else { return nil }
        return self.account(id)
    }

    // MARK: - Account index / lookup

    /// Known accountIds (order-preserving).
    func knownAccountIds() -> [String] {
        self.defaults.stringArray(forKey: Self.accountIndexKey) ?? []
    }

    func allAccounts() -> [EmployeeAccount] {
        self.knownAccountIds().compactMap { self.account($0) }
    }

    func account(_ accountId: String) -> EmployeeAccount? {
        guard let profile = self.loadProfileMigratingIfNeeded(accountId: accountId),
              let gatewayURL = URL(string: profile.gatewayBaseURL),
              let storeId = UUID(uuidString: profile.webDataStoreId)
        else {
            return nil
        }
        var account = EmployeeAccount(
            gatewayBaseURL: gatewayURL,
            userEmail: profile.userEmail,
            activeOrgId: profile.activeOrgId,
            webDataStoreId: storeId)
        // computeAccountId in init should match the stored id; guard against drift.
        if account.accountId != accountId {
            self.logger.error("accountId drift for \(accountId, privacy: .public); ignoring record")
            return nil
        }
        account.webDataStoreId = storeId
        return account
    }

    // MARK: - Lifecycle: add / login

    /// Persist (or refresh) an account after a successful login and make it active.
    @discardableResult
    func upsert(gatewayBaseURL: URL, userEmail: String, activeOrgId: String? = nil) -> EmployeeAccount {
        let existingId = EmployeeAccount.computeAccountId(
            gatewayBaseURL: gatewayBaseURL, userEmail: userEmail)
        let existing = self.account(existingId)
        let account = EmployeeAccount(
            gatewayBaseURL: gatewayBaseURL,
            userEmail: userEmail,
            activeOrgId: activeOrgId ?? existing?.activeOrgId,
            // Preserve the existing WebView data-store id so its cookies persist.
            webDataStoreId: existing?.webDataStoreId ?? UUID())
        self.persist(account)
        self.addToIndex(account.accountId)
        self.activeAccountId = account.accountId
        return account
    }

    private func persist(_ account: EmployeeAccount) {
        let profile = EmployeeAccountProfile(
            userEmail: account.userEmail,
            gatewayBaseURL: account.gatewayBaseURL.absoluteString,
            activeOrgId: account.activeOrgId,
            webDataStoreId: account.webDataStoreId.uuidString)
        self.writeProfile(profile, accountId: account.accountId)
        // Ensure any legacy per-field Keychain profile entries are gone.
        self.deleteLegacyProfileKeychainFields(accountId: account.accountId)
    }

    // MARK: - Lifecycle: switch account (no data wiped)

    func switchTo(accountId: String) {
        guard self.knownAccountIds().contains(accountId) else {
            self.logger.error("switchTo unknown account \(accountId, privacy: .public)")
            return
        }
        self.activeAccountId = accountId
    }

    // MARK: - Lifecycle: switch org (keep account, invalidate embed session)

    /// Switch org within the SAME account: keep `accountId`, but invalidate the
    /// Employee Shell WebView session so the caller re-bootstraps into the new
    /// org view. Does NOT touch the client login jar.
    func switchOrg(accountId: String, to orgId: String?) {
        guard var account = self.account(accountId) else { return }
        account.activeOrgId = orgId
        self.persist(account)
        Task { await self.clearWebViewStore(for: account) }
    }

    // MARK: - Lifecycle: logout (clear this account only)

    /// Clear the account's client jar + WebView data store + secure creds. Node
    /// pairing is a SEPARATE identity and is intentionally left untouched
    /// (contract invariant 5).
    func logout(accountId: String) async {
        if let account = self.account(accountId) {
            await self.clearWebViewStore(for: account)
        }
        self.clientSessions[accountId]?.invalidateAndCancel()
        self.clientSessions[accountId] = nil
        // Clear the login cookie but keep the account row (so the user can log back in).
        self.clearCredential(accountId: accountId)
        if self.activeAccountId == accountId {
            let remaining = self.knownAccountIds().filter { $0 != accountId }
            self.activeAccountId = remaining.first
        }
    }

    /// Full removal: logout + delete every namespaced key + drop from the index.
    func remove(accountId: String) async {
        await self.logout(accountId: accountId)
        self.defaults.removeObject(forKey: EmployeeAccountKeys.profileDefaultsKey(accountId))
        _ = GenericPasswordKeychainStore.delete(
            service: EmployeeAccountKeys.keychainService,
            account: EmployeeAccountKeys.secretsKey(accountId))
        self.deleteLegacyProfileKeychainFields(accountId: accountId)
        self.deleteLegacySecretKeychainFields(accountId: accountId)
        self.removeFromIndex(accountId)
    }

    // MARK: - Client Session Jar (mint auth) — NEVER `.shared`

    /// A per-account `URLSession` with an ISOLATED cookie jar (ephemeral config →
    /// dedicated in-memory `HTTPCookieStorage`, never the process-shared one).
    /// The persisted login cookie is rehydrated on first access.
    func clientSession(for account: EmployeeAccount) -> URLSession {
        if let existing = self.clientSessions[account.accountId] {
            return existing
        }
        let config = URLSessionConfiguration.ephemeral
        config.httpCookieAcceptPolicy = .always
        config.httpShouldSetCookies = true
        let session = URLSession(configuration: config)
        self.rehydrateCookies(into: session, account: account)
        self.clientSessions[account.accountId] = session
        return session
    }

    /// Persist the client jar's current cookies into the Keychain credential.
    func persistClientCookies(for account: EmployeeAccount) {
        guard
            let session = self.clientSessions[account.accountId],
            let storage = session.configuration.httpCookieStorage
        else {
            return
        }
        let cookies = storage.cookies(for: account.gatewayBaseURL) ?? storage.cookies ?? []
        if let data = EmployeeAccountCookieCodec.encode(cookies) {
            let encoded = data.base64EncodedString()
            self.writeCredential(encoded, accountId: account.accountId)
        }
    }

    private func rehydrateCookies(into session: URLSession, account: EmployeeAccount) {
        guard
            let encoded = self.readCredential(accountId: account.accountId),
            let data = Data(base64Encoded: encoded),
            let storage = session.configuration.httpCookieStorage
        else {
            return
        }
        for cookie in EmployeeAccountCookieCodec.decode(data) {
            storage.setCookie(cookie)
        }
    }

    // MARK: - Employee Shell WebView store — `forIdentifier:`, not `.default()`

    /// The persistent, per-account `WKWebsiteDataStore`. Replaces the skeleton's
    /// `.default()` singleton (which cannot isolate multiple accounts). Isolated
    /// from the Canvas `.nonPersistent()` store (contract invariant 2).
    func webDataStore(for account: EmployeeAccount) -> WKWebsiteDataStore {
        WKWebsiteDataStore(forIdentifier: account.webDataStoreId)
    }

    /// Remove all persisted website data for this account's WebView store
    /// (logout / switch-org). Best-effort; failures are logged.
    func clearWebViewStore(for account: EmployeeAccount) async {
        let store = self.webDataStore(for: account)
        let types = WKWebsiteDataStore.allWebsiteDataTypes()
        await store.removeData(ofTypes: types, modifiedSince: .distantPast)
    }

    // MARK: - Profile (UserDefaults) + migration

    private func loadProfileMigratingIfNeeded(accountId: String) -> EmployeeAccountProfile? {
        if let profile = self.readProfile(accountId: accountId) {
            return profile
        }

        // One-shot migration from legacy per-field Keychain accounts.
        guard
            let email = self.readSecure(EmployeeAccountKeys.legacyKey(accountId, .userEmail)),
            let gatewayRaw = self.readSecure(EmployeeAccountKeys.legacyKey(accountId, .gatewayBaseURL)),
            let storeIdRaw = self.readSecure(EmployeeAccountKeys.legacyKey(accountId, .webDataStoreId)),
            UUID(uuidString: storeIdRaw) != nil
        else {
            return nil
        }
        let orgId = self.readSecure(EmployeeAccountKeys.legacyKey(accountId, .activeOrgId))
        let profile = EmployeeAccountProfile(
            userEmail: email,
            gatewayBaseURL: gatewayRaw,
            activeOrgId: orgId.flatMap { $0.isEmpty ? nil : $0 },
            webDataStoreId: storeIdRaw)
        self.writeProfile(profile, accountId: accountId)
        self.deleteLegacyProfileKeychainFields(accountId: accountId)

        // Also fold legacy secrets into the unified blob while we are here.
        _ = self.loadSecretsMigratingIfNeeded(accountId: accountId)
        return profile
    }

    private func readProfile(accountId: String) -> EmployeeAccountProfile? {
        let key = EmployeeAccountKeys.profileDefaultsKey(accountId)
        if let data = self.defaults.data(forKey: key),
           let profile = try? JSONDecoder().decode(EmployeeAccountProfile.self, from: data)
        {
            return profile
        }
        // Older string JSON form (if any).
        if let json = self.defaults.string(forKey: key),
           let data = json.data(using: .utf8),
           let profile = try? JSONDecoder().decode(EmployeeAccountProfile.self, from: data)
        {
            return profile
        }
        return nil
    }

    private func writeProfile(_ profile: EmployeeAccountProfile, accountId: String) {
        guard let data = try? JSONEncoder().encode(profile) else { return }
        self.defaults.set(data, forKey: EmployeeAccountKeys.profileDefaultsKey(accountId))
    }

    private func deleteLegacyProfileKeychainFields(accountId: String) {
        for field: EmployeeAccountKeys.LegacyField in [.userEmail, .gatewayBaseURL, .activeOrgId, .webDataStoreId] {
            _ = GenericPasswordKeychainStore.delete(
                service: EmployeeAccountKeys.keychainService,
                account: EmployeeAccountKeys.legacyKey(accountId, field))
        }
    }

    // MARK: - Secrets blob (Keychain) + migration

    private func loadSecretsMigratingIfNeeded(accountId: String) -> EmployeeAccountSecrets {
        if let data = GenericPasswordKeychainStore.loadData(
            service: EmployeeAccountKeys.keychainService,
            account: EmployeeAccountKeys.secretsKey(accountId)),
           let secrets = try? JSONDecoder().decode(EmployeeAccountSecrets.self, from: data)
        {
            return secrets
        }

        let credential = self.readSecure(EmployeeAccountKeys.legacyKey(accountId, .credential))
        let pushToken = self.readSecure(EmployeeAccountKeys.legacyKey(accountId, .pushToken))
        let secrets = EmployeeAccountSecrets(
            credential: credential.flatMap { $0.isEmpty ? nil : $0 },
            pushToken: pushToken.flatMap { $0.isEmpty ? nil : $0 })
        if secrets.credential != nil || secrets.pushToken != nil {
            self.writeSecrets(secrets, accountId: accountId)
            self.deleteLegacySecretKeychainFields(accountId: accountId)
        }
        return secrets
    }

    private func writeSecrets(_ secrets: EmployeeAccountSecrets, accountId: String) {
        if secrets.credential == nil, secrets.pushToken == nil {
            _ = GenericPasswordKeychainStore.delete(
                service: EmployeeAccountKeys.keychainService,
                account: EmployeeAccountKeys.secretsKey(accountId))
            self.deleteLegacySecretKeychainFields(accountId: accountId)
            return
        }
        guard let data = try? JSONEncoder().encode(secrets) else { return }
        _ = GenericPasswordKeychainStore.saveData(
            data,
            service: EmployeeAccountKeys.keychainService,
            account: EmployeeAccountKeys.secretsKey(accountId))
        self.deleteLegacySecretKeychainFields(accountId: accountId)
    }

    private func deleteLegacySecretKeychainFields(accountId: String) {
        for field: EmployeeAccountKeys.LegacyField in [.credential, .pushToken] {
            _ = GenericPasswordKeychainStore.delete(
                service: EmployeeAccountKeys.keychainService,
                account: EmployeeAccountKeys.legacyKey(accountId, field))
        }
    }

    private func readCredential(accountId: String) -> String? {
        self.loadSecretsMigratingIfNeeded(accountId: accountId).credential
    }

    private func writeCredential(_ value: String, accountId: String) {
        var secrets = self.loadSecretsMigratingIfNeeded(accountId: accountId)
        secrets.credential = value
        self.writeSecrets(secrets, accountId: accountId)
    }

    private func clearCredential(accountId: String) {
        var secrets = self.loadSecretsMigratingIfNeeded(accountId: accountId)
        secrets.credential = nil
        self.writeSecrets(secrets, accountId: accountId)
    }

    // MARK: - Index bookkeeping

    private func addToIndex(_ accountId: String) {
        var ids = self.knownAccountIds()
        if !ids.contains(accountId) {
            ids.append(accountId)
            self.defaults.set(ids, forKey: Self.accountIndexKey)
        }
    }

    private func removeFromIndex(_ accountId: String) {
        let ids = self.knownAccountIds().filter { $0 != accountId }
        self.defaults.set(ids, forKey: Self.accountIndexKey)
    }

    // MARK: - Keychain helpers (legacy reads during migration)

    private func readSecure(_ key: String) -> String? {
        GenericPasswordKeychainStore.loadString(
            service: EmployeeAccountKeys.keychainService, account: key)
    }
}
