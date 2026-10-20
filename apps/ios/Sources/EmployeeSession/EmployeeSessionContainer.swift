//
//  EmployeeSessionContainer.swift
//  Per-account session jars (task 1.3-ios).
//
//  Realizes the three-jar isolation from account-session-model.md for one account:
//   1. Client Session Jar — a dedicated `URLSession` with its OWN cookie storage
//      (NEVER `URLSession.shared`, invariant 1). Holds the platform-auth login cookie
//      and is what `mint` is called with.
//   2. Employee Shell WebView store — `WKWebsiteDataStore(forIdentifier:)` keyed by the
//      account's UUID (replaces the skeleton's `.default()` singleton, invariant 2).
//   3. Secure credential store — handled by `EmployeeAccountStore` (Keychain).
//
//  The client jar is isolated per-instance (ephemeral configuration → its own in-memory
//  `HTTPCookieStorage`) and persisted across launches by archiving its cookies into the
//  account's Keychain credential. This keeps accounts from ever sharing a cookie jar
//  while still surviving relaunch (invariants 1–4).
//

import Foundation
import OpenBotKit
import WebKit

@MainActor
final class EmployeeSessionContainer {
    let account: EmployeeAccount

    /// Dedicated client HTTP session. Built from an ephemeral configuration so its
    /// `HTTPCookieStorage` is isolated from every other account and from `.shared`.
    private(set) lazy var urlSession: URLSession = self.makeURLSession()

    /// Employee Shell WebView data store, isolated per account by UUID.
    private(set) lazy var webDataStore: WKWebsiteDataStore =
        WKWebsiteDataStore(forIdentifier: self.account.webDataStoreId)

    init(account: EmployeeAccount) {
        self.account = account
    }

    // MARK: Client session jar

    private func makeURLSession() -> URLSession {
        let config = URLSessionConfiguration.ephemeral
        // Ephemeral gives an isolated in-memory cookie storage; make cookie handling
        // explicit rather than relying on the process-wide shared jar.
        config.httpCookieAcceptPolicy = .always
        config.httpShouldSetCookies = true
        let session = URLSession(configuration: config)
        self.rehydrateCookies(into: session)
        return session
    }

    private func rehydrateCookies(into session: URLSession) {
        guard let storage = session.configuration.httpCookieStorage,
              let encoded = EmployeeAccountStore.loadCredential(for: self.account.accountId),
              let data = Data(base64Encoded: encoded),
              let raw = try? PropertyListSerialization.propertyList(from: data, options: [], format: nil),
              let list = raw as? [[String: Any]]
        else {
            return
        }
        for entry in list {
            var props: [HTTPCookiePropertyKey: Any] = [:]
            for (rawKey, value) in entry {
                props[HTTPCookiePropertyKey(rawValue: rawKey)] = value
            }
            if let cookie = HTTPCookie(properties: props) {
                storage.setCookie(cookie)
            }
        }
    }

    /// Snapshot the client jar's cookies into the account's secure credential. Call after
    /// login and after any `mint` so a refreshed session cookie survives relaunch.
    ///
    /// `HTTPCookie` is not `NSSecureCoding`, so cookies are persisted via their
    /// plist-serializable `properties` dictionaries (sanitized to plist-safe value types).
    func persistCookies() {
        guard let storage = self.urlSession.configuration.httpCookieStorage else { return }
        let entries: [[String: Any]] = (storage.cookies ?? []).compactMap { cookie in
            guard let props = cookie.properties else { return nil }
            var sanitized: [String: Any] = [:]
            for (key, value) in props {
                sanitized[key.rawValue] = Self.plistSafe(value)
            }
            return sanitized.isEmpty ? nil : sanitized
        }
        guard !entries.isEmpty,
              let data = try? PropertyListSerialization.data(
                  fromPropertyList: entries, format: .binary, options: 0)
        else {
            return
        }
        EmployeeAccountStore.saveCredential(data.base64EncodedString(), for: self.account.accountId)
    }

    /// Coerce a cookie property value into a plist-serializable type (String/Date/Number/
    /// Bool pass through; URL → absoluteString; everything else → String(describing:)).
    private static func plistSafe(_ value: Any) -> Any {
        switch value {
        case let url as URL:
            return url.absoluteString
        case is String, is Date, is NSNumber, is Bool:
            return value
        default:
            return String(describing: value)
        }
    }

    /// Mint a one-time bootstrap token using THIS account's client jar (invariant 3),
    /// then persist any refreshed cookies.
    func mintToken(target: String) async throws -> String {
        let token = try await EmployeeShellBootstrap.mintToken(
            baseURL: self.account.gatewayBaseURL,
            session: self.urlSession,
            target: target)
        self.persistCookies()
        return token
    }

    // MARK: Invalidation

    /// Org switch (same account): drop only the embed WebView session so the shell
    /// re-bootstraps into the new org. The client login jar is preserved.
    func invalidateEmbedSession() async {
        await self.clearWebViewData()
    }

    /// Full logout for this account: clear BOTH jars + cache and delete the credential.
    /// Does NOT touch the node/gateway Keychain (double-identity orthogonality, invariant 5).
    func clearSessionForLogout() async {
        // Client jar
        if let storage = self.urlSession.configuration.httpCookieStorage {
            for cookie in storage.cookies ?? [] {
                storage.deleteCookie(cookie)
            }
        }
        self.urlSession.invalidateAndCancel()
        EmployeeAccountStore.deleteCredential(for: self.account.accountId)
        // WebView jar + cache
        await self.clearWebViewData()
    }

    private func clearWebViewData() async {
        let types = WKWebsiteDataStore.allWebsiteDataTypes()
        await withCheckedContinuation { (continuation: CheckedContinuation<Void, Never>) in
            self.webDataStore.removeData(ofTypes: types, modifiedSince: .distantPast) {
                continuation.resume()
            }
        }
    }

    /// Fully delete this account's isolated WebView data store (used on account removal).
    static func destroyWebDataStore(id: UUID) async {
        await withCheckedContinuation { (continuation: CheckedContinuation<Void, Never>) in
            WKWebsiteDataStore.remove(forIdentifier: id) { _ in
                continuation.resume()
            }
        }
    }
}
