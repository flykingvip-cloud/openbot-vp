//
//  EmployeeAccount.swift
//  Account-scoped session + storage model (task 1.3-macos).
//
//  Implements the tri-platform contract `contracts/account-session-model.md`
//  (v1) for macOS: a stable `accountId`, a Keychain key namespace, and the
//  per-account storage handles (Client Session Jar + Employee Shell WebView
//  data store). Pure value types + key schema live here so they are unit
//  testable WITHOUT touching the Keychain / WebKit (see EmployeeAccountStore
//  for the side-effecting persistence).
//
//  Invariants enforced by this layer (contract §不变式):
//   - `accountId` is recomputable from `{gatewayBaseURL, userEmail}` and never
//     embeds the plaintext email in a key name (7).
//   - Every persistent key is namespaced by `accountId` (命名空间).
//   - Credentials / cookies / push tokens live in Keychain; non-secret profile
//     fields (email, gateway URL, webDataStoreId, activeOrgId) live in
//     UserDefaults to avoid unnecessary Keychain ACL prompts.
//

import CryptoKit
import Foundation

/// A logged-in employee identity = one `{gatewayBaseURL, userEmail}` pair that
/// may span several switchable orgs. Mirrors the contract's Account entity.
struct EmployeeAccount: Equatable, Codable, Sendable {
    /// Stable primary key: `sha256(lower(gatewayBaseURL) + "\n" + lower(userEmail))`
    /// truncated to 16 hex chars. Namespaced key prefix; contains no plaintext email.
    let accountId: String
    /// The gateway this account authenticates against (cloud default or self-hosted).
    var gatewayBaseURL: URL
    /// Display login name; stored in UserDefaults profile (not a secret).
    var userEmail: String
    /// Current org (multi-org). Switching org keeps `accountId` but MUST clear the
    /// embed session and re-bootstrap into the new org view (contract lifecycle).
    var activeOrgId: String?
    /// UUID identifying this account's Employee Shell `WKWebsiteDataStore`.
    /// (`WKWebsiteDataStore(forIdentifier:)` — replaces the skeleton `.default()`.)
    var webDataStoreId: UUID

    init(
        gatewayBaseURL: URL,
        userEmail: String,
        activeOrgId: String? = nil,
        webDataStoreId: UUID = UUID()
    ) {
        self.gatewayBaseURL = EmployeeAccount.canonicalizeCloudGatewayURL(gatewayBaseURL)
        self.accountId = EmployeeAccount.computeAccountId(
            gatewayBaseURL: self.gatewayBaseURL, userEmail: userEmail)
        self.userEmail = userEmail
        self.activeOrgId = activeOrgId
        self.webDataStoreId = webDataStoreId
    }

    /// Compute the stable `accountId` from a gateway URL + email (contract §Account).
    /// Normalizes the URL (lowercased, no trailing slash) and email (lowercased,
    /// trimmed) so the id is deterministic across relaunches / equivalent inputs.
    static func computeAccountId(gatewayBaseURL: URL, userEmail: String) -> String {
        self.computeAccountId(
            gatewayBaseURL: self.normalizedGateway(gatewayBaseURL),
            userEmail: userEmail)
    }

    /// Compatibility host. Conversation history lives on www, never on gw.
    static func canonicalizeCloudGatewayURL(_ url: URL) -> URL {
        guard url.host?.lowercased() == "gw.openbot.love" else {
            return url
        }
        var parts = URLComponents(url: url, resolvingAgainstBaseURL: false)
        parts?.host = "www.openbot.love"
        return parts?.url ?? url
    }

    static func canonicalizeCloudGatewayURLString(_ raw: String) -> String {
        raw.replacingOccurrences(
            of: "gw.openbot.love",
            with: "www.openbot.love",
            options: [.caseInsensitive])
    }

    static func computeAccountId(gatewayBaseURL: String, userEmail: String) -> String {
        let normalizedGateway = self.canonicalizeCloudGatewayURLString(gatewayBaseURL)
            .trimmingCharacters(in: .whitespacesAndNewlines)
            .lowercased()
        let trimmedGateway = normalizedGateway.hasSuffix("/")
            ? String(normalizedGateway.dropLast())
            : normalizedGateway
        let normalizedEmail = userEmail
            .trimmingCharacters(in: .whitespacesAndNewlines)
            .lowercased()
        let seed = "\(trimmedGateway)\n\(normalizedEmail)"
        let digest = SHA256.hash(data: Data(seed.utf8))
        let hex = digest.map { String(format: "%02x", $0) }.joined()
        return String(hex.prefix(16))
    }

    /// Normalized gateway string used for the id seed (lowercased, no trailing slash).
    static func normalizedGateway(_ url: URL) -> String {
        let raw = url.absoluteString.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        return raw.hasSuffix("/") ? String(raw.dropLast()) : raw
    }
}

/// Non-secret account profile persisted in UserDefaults (one JSON blob per account).
struct EmployeeAccountProfile: Equatable, Codable, Sendable {
    var userEmail: String
    var gatewayBaseURL: String
    var activeOrgId: String?
    var webDataStoreId: String
}

/// Secure payload persisted as one Keychain generic-password item per account.
struct EmployeeAccountSecrets: Equatable, Codable, Sendable {
    var credential: String?
    var pushToken: String?
}

/// Storage key schema, namespaced by `accountId` (contract §存储键 schema).
/// Profile fields → UserDefaults; secrets → a single Keychain account
/// `openbot.account.<id>.secrets`. Legacy per-field Keychain accounts are
/// migrated once on load.
enum EmployeeAccountKeys {
    /// Keychain `kSecAttrService` for employee-account secret items.
    static let keychainService = "ai.openbot.employee-account"

    static let accountPrefix = "openbot.account."
    static let activeAccountKey = "openbot.active-account"
    static let appLockKey = "openbot.app-lock"
    /// UserDefaults key for one account's non-secret profile JSON.
    static let profileDefaultsPrefix = "openbot.employee.account.profile."

    /// Fields that historically lived as separate Keychain accounts.
    enum LegacyField: String, CaseIterable {
        case userEmail
        case gatewayBaseURL
        case activeOrgId
        case credential
        case webDataStoreId
        case pushToken
    }

    /// Secure Keychain account attr for the unified secrets blob.
    static let secretsField = "secrets"

    /// `openbot.account.<accountId>.<field>` — Keychain account attr (secrets / legacy).
    static func key(_ accountId: String, _ field: String) -> String {
        "\(self.accountPrefix)\(accountId).\(field)"
    }

    static func secretsKey(_ accountId: String) -> String {
        self.key(accountId, self.secretsField)
    }

    static func legacyKey(_ accountId: String, _ field: LegacyField) -> String {
        self.key(accountId, field.rawValue)
    }

    static func profileDefaultsKey(_ accountId: String) -> String {
        "\(self.profileDefaultsPrefix)\(accountId)"
    }

    /// Prefix used to enumerate / purge one account's keys (`remove account`).
    static func accountKeyPrefix(_ accountId: String) -> String {
        "\(self.accountPrefix)\(accountId)."
    }
}
