//
//  EmployeeAccount.swift
//  Account-scoped session/storage model (task 1.3-ios).
//
//  Implements the frozen contract in
//  .kiro/specs/client-apps-pc-mobile/contracts/account-session-model.md:
//  - `accountId` = sha256(lower(gatewayBaseURL) + "\n" + lower(userEmail))[..16 hex],
//    a stable primary key that never embeds the plaintext email and is safe to use
//    as a namespace prefix.
//  - An Account bundles the identifiers for its three isolated stores (client session
//    jar, employee-shell WebView data store, secure credential store).
//
//  SDK-only (Foundation + CryptoKit) so it can be unit-tested in isolation.
//

import CryptoKit
import Foundation

/// A logged-in employee identity: one `{gatewayBaseURL, userEmail}` pairing that may
/// contain several switchable orgs. See account-session-model.md → "Account 实体".
struct EmployeeAccount: Equatable, Codable, Identifiable, Sendable {
    /// Stable primary key. `id` mirrors `accountId` for `Identifiable`.
    let accountId: String
    /// The account's gateway (cloud default `https://www.openbot.love`, or self-hosted).
    let gatewayBaseURL: URL
    /// Login name — display only; persisted to the secure store, never a key name.
    let userEmail: String
    /// Current org (multi-org). Switching org keeps `accountId` but forces re-bootstrap.
    var activeOrgId: String?
    /// UUID identifying this account's Employee Shell WebView data store
    /// (`WKWebsiteDataStore(forIdentifier:)`).
    let webDataStoreId: UUID

    var id: String { self.accountId }

    init(
        gatewayBaseURL: URL,
        userEmail: String,
        activeOrgId: String? = nil,
        webDataStoreId: UUID = UUID())
    {
        self.gatewayBaseURL = EmployeeAccountIdentity.canonicalizeCloudGatewayURL(gatewayBaseURL)
        self.userEmail = userEmail
        self.activeOrgId = activeOrgId
        self.webDataStoreId = webDataStoreId
        self.accountId = EmployeeAccountIdentity.accountId(
            gatewayBaseURL: self.gatewayBaseURL, userEmail: userEmail)
    }
}

/// Pure helpers for deriving the account primary key. Kept separate so the exact
/// contract algorithm can be unit-tested without any storage side effects.
enum EmployeeAccountIdentity {
    /// Compatibility host. Conversation history lives on www; never treat gw as a second store.
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

    /// `sha256(lower(gatewayBaseURL) + "\n" + lower(userEmail))` truncated to the
    /// first 16 hex characters. Recomputable from `{gatewayBaseURL, userEmail}`.
    static func accountId(gatewayBaseURL: URL, userEmail: String) -> String {
        self.accountId(
            gatewayBaseURLString: gatewayBaseURL.absoluteString, userEmail: userEmail)
    }

    /// String overload (also used by tests / callers that only have the raw base URL).
    static func accountId(gatewayBaseURLString: String, userEmail: String) -> String {
        let normalizedURL = self.canonicalizeCloudGatewayURLString(gatewayBaseURLString)
            .trimmingCharacters(in: .whitespacesAndNewlines)
            .lowercased()
        let normalizedEmail = userEmail
            .trimmingCharacters(in: .whitespacesAndNewlines)
            .lowercased()
        let seed = "\(normalizedURL)\n\(normalizedEmail)"
        let digest = SHA256.hash(data: Data(seed.utf8))
        let hex = digest.map { String(format: "%02x", $0) }.joined()
        return String(hex.prefix(16))
    }
}
