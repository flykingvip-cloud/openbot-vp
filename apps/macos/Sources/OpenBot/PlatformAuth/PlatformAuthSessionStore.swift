import Foundation
import Observation
import OpenBotKit

/// Single Keychain payload for platform-auth restore/login (one ACL prompt path).
struct PlatformAuthSessionBundle: Equatable, Sendable, Codable {
    var cookieHeaderValue: String?
    var session: PlatformAuthSession
}

@MainActor
@Observable
final class PlatformAuthSessionStore {
    static let shared = PlatformAuthSessionStore()

    private static let keychainService = "ai.openbot.mac.platform-auth"
    /// Unified generic-password account (cookie + session JSON together).
    private static let bundleAccount = "session-bundle"
    /// Legacy accounts — read once for migration, then deleted.
    private static let legacyCookieAccount = "session-cookie"
    private static let legacySessionAccount = "session-json"
    private static let gatewayDefaultsKey = "openbot.platformAuth.gatewayBaseURL"

    var gatewayBaseURLString: String {
        didSet {
            UserDefaults.standard.set(self.gatewayBaseURLString, forKey: Self.gatewayDefaultsKey)
        }
    }

    var session: PlatformAuthSession?
    var isBusy = false
    var errorMessage: String?
    var noticeMessage: String?

    var isAuthenticated: Bool { self.session != nil }

    var gatewayBaseURL: URL? {
        Self.normalizeGatewayURL(self.gatewayBaseURLString)
    }

    private init() {
        let saved = UserDefaults.standard.string(forKey: Self.gatewayDefaultsKey)?
            .trimmingCharacters(in: .whitespacesAndNewlines)
        if let saved, !saved.isEmpty {
            self.gatewayBaseURLString = saved
        } else {
            self.gatewayBaseURLString = Self.defaultGatewayBaseURLString()
        }
        self.restorePersistedSession()
    }

    func login(email: String, password: String, mfaCode: String? = nil) async {
        await self.run(clearNotice: true) {
            let base = try self.requireGatewayURL()
            let result = try await PlatformAuthClient.shared.login(
                gatewayBaseURL: base,
                email: email,
                password: password,
                mfaCode: mfaCode)
            self.applySuccess(result, gatewayBaseURL: base)
        }
    }

    func register(email: String, password: String, displayName: String, inviteCode: String) async {
        await self.run(clearNotice: true) {
            let base = try self.requireGatewayURL()
            let result = try await PlatformAuthClient.shared.register(
                gatewayBaseURL: base,
                email: email,
                password: password,
                displayName: displayName,
                inviteCode: inviteCode)
            self.applySuccess(result, gatewayBaseURL: base)
        }
    }

    func forgotPassword(email: String) async {
        await self.run(clearNotice: true) {
            let base = try self.requireGatewayURL()
            let result = try await PlatformAuthClient.shared.forgotPassword(
                gatewayBaseURL: base,
                email: email)
            self.noticeMessage = "重置邮件已发送，请查收验证码后完成重置。"
            if let code = result.pendingResetCode, !code.isEmpty {
                self.noticeMessage = "已生成重置码（开发环境）：\(code)"
            }
        }
    }

    func resetPassword(email: String, password: String, code: String) async {
        await self.run(clearNotice: true) {
            let base = try self.requireGatewayURL()
            let result = try await PlatformAuthClient.shared.resetPassword(
                gatewayBaseURL: base,
                email: email,
                password: password,
                code: code)
            self.applySuccess(result, gatewayBaseURL: base)
            self.noticeMessage = "密码已更新并完成登录。"
        }
    }

    func logout() async {
        if let base = self.gatewayBaseURL {
            await PlatformAuthClient.shared.logout(gatewayBaseURL: base)
        }
        self.session = nil
        self.errorMessage = nil
        self.noticeMessage = nil
        Self.deleteAllKeychainAccounts()
        await CloudConnectionApplier.clearCloudConnection()
    }

    func authenticatedURLSession() async -> URLSession {
        await PlatformAuthClient.shared.urlSessionForAuthenticatedCalls()
    }

    // MARK: - Private

    private func run(clearNotice: Bool, _ work: () async throws -> Void) async {
        self.isBusy = true
        self.errorMessage = nil
        if clearNotice {
            self.noticeMessage = nil
        }
        defer { self.isBusy = false }
        do {
            try await work()
        } catch let error as PlatformAuthAPIError {
            self.errorMessage = Self.friendlyMessage(for: error)
        } catch {
            self.errorMessage = error.localizedDescription
        }
    }

    private func applySuccess(_ result: PlatformAuthLoginResult, gatewayBaseURL: URL) {
        self.session = result.session
        let cookie = result.cookieHeaderValue.flatMap { $0.isEmpty ? nil : $0 }
        if let cookie {
            // Ensure cookie is present for subsequent EmployeeShell mint calls.
            Task {
                await PlatformAuthClient.shared.applyPersistedCookie(
                    gatewayBaseURL: gatewayBaseURL,
                    value: cookie)
            }
        }
        _ = Self.persistBundle(
            PlatformAuthSessionBundle(
                cookieHeaderValue: cookie,
                session: result.session))
        Task { await CloudConnectionApplier.applyAfterLogin() }
    }

    private func restorePersistedSession() {
        guard let bundle = Self.loadBundleMigratingIfNeeded() else { return }
        self.session = bundle.session
        if let base = self.gatewayBaseURL,
           let cookie = bundle.cookieHeaderValue,
           !cookie.isEmpty
        {
            Task {
                await PlatformAuthClient.shared.applyPersistedCookie(
                    gatewayBaseURL: base,
                    value: cookie)
            }
        }
    }

    @discardableResult
    private static func persistBundle(_ bundle: PlatformAuthSessionBundle) -> Bool {
        guard let data = try? JSONEncoder().encode(bundle) else { return false }
        let ok = GenericPasswordKeychainStore.saveData(
            data,
            service: Self.keychainService,
            account: Self.bundleAccount)
        if ok {
            // Drop legacy split accounts so future restores hit one item only.
            _ = GenericPasswordKeychainStore.delete(
                service: Self.keychainService, account: Self.legacyCookieAccount)
            _ = GenericPasswordKeychainStore.delete(
                service: Self.keychainService, account: Self.legacySessionAccount)
        }
        return ok
    }

    private static func loadBundleMigratingIfNeeded() -> PlatformAuthSessionBundle? {
        if let data = GenericPasswordKeychainStore.loadData(
            service: Self.keychainService,
            account: Self.bundleAccount),
           let bundle = try? JSONDecoder().decode(PlatformAuthSessionBundle.self, from: data)
        {
            return bundle
        }

        // One-shot migration from legacy cookie + session accounts.
        guard let json = GenericPasswordKeychainStore.loadString(
            service: Self.keychainService,
            account: Self.legacySessionAccount),
            let sessionData = json.data(using: .utf8),
            let session = try? JSONDecoder().decode(PlatformAuthSession.self, from: sessionData)
        else {
            return nil
        }

        let cookie = GenericPasswordKeychainStore.loadString(
            service: Self.keychainService,
            account: Self.legacyCookieAccount)
        let bundle = PlatformAuthSessionBundle(
            cookieHeaderValue: cookie.flatMap { $0.isEmpty ? nil : $0 },
            session: session)
        _ = Self.persistBundle(bundle)
        return bundle
    }

    private static func deleteAllKeychainAccounts() {
        _ = GenericPasswordKeychainStore.delete(
            service: Self.keychainService, account: Self.bundleAccount)
        _ = GenericPasswordKeychainStore.delete(
            service: Self.keychainService, account: Self.legacyCookieAccount)
        _ = GenericPasswordKeychainStore.delete(
            service: Self.keychainService, account: Self.legacySessionAccount)
    }

    private func requireGatewayURL() throws -> URL {
        guard let url = self.gatewayBaseURL else {
            throw PlatformAuthAPIError(statusCode: -1, code: nil, message: "请填写有效的网关地址")
        }
        return url
    }

    private static func defaultGatewayBaseURLString() -> String {
        // Public edge hosts platform-auth (same as Web / Android).
        OpenBotCloudDefaults.baseURL.absoluteString
    }

    private static func friendlyMessage(for error: PlatformAuthAPIError) -> String {
        if error.code == "PLATFORM_AUTH_DISABLED" {
            return "当前网关未开启平台登录。请在「高级」中改为 \(OpenBotCloudDefaults.baseURL.absoluteString) 后重试。"
        }
        return Self.localizeAuthError(error.message)
    }

    private static func localizeAuthError(_ message: String) -> String {
        let trimmed = message.trimmingCharacters(in: .whitespacesAndNewlines)
        let lower = trimmed.lowercased()
        if lower.contains("email or password is incorrect")
            || lower.contains("invalid email or password")
            || lower.contains("invalid credentials")
        {
            return "邮箱或密码不正确。"
        }
        if lower.contains("user not found") {
            return "账号不存在。"
        }
        if lower.contains("too many") {
            return "尝试次数过多，请稍后再试。"
        }
        return trimmed
    }

    private static func normalizeGatewayURL(_ raw: String) -> URL? {
        var trimmed = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return nil }
        if trimmed.hasPrefix("ws://") {
            trimmed = "http://" + trimmed.dropFirst(5)
        } else if trimmed.hasPrefix("wss://") {
            trimmed = "https://" + trimmed.dropFirst(6)
        } else if !trimmed.contains("://") {
            trimmed = "https://" + trimmed
        }
        guard var components = URLComponents(string: trimmed),
              let scheme = components.scheme?.lowercased(),
              scheme == "http" || scheme == "https",
              components.host != nil
        else {
            return nil
        }
        // Auth routes sit on gateway origin root, not /control/.
        if components.path.hasSuffix("/control") || components.path.hasSuffix("/control/") {
            components.path = ""
        }
        components.query = nil
        components.fragment = nil
        return components.url
    }
}
