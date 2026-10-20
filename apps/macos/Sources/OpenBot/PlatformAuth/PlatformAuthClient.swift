import Foundation
import OpenBotKit

/// Thin HTTP client for Control UI platform-auth routes.
/// Base path: `/__openbot/platform-auth`
actor PlatformAuthClient {
    static let shared = PlatformAuthClient()

    private let cookieName = GatewayWebSocketCookies.platformSessionCookieName
    private let cookieStorage: HTTPCookieStorage
    private let session: URLSession

    private init() {
        let storage = HTTPCookieStorage.shared
        let config = URLSessionConfiguration.ephemeral
        config.httpCookieStorage = storage
        config.httpCookieAcceptPolicy = .always
        config.httpShouldSetCookies = true
        self.cookieStorage = storage
        self.session = URLSession(configuration: config)
    }

    func login(
        gatewayBaseURL: URL,
        email: String,
        password: String,
        mfaCode: String? = nil
    ) async throws -> PlatformAuthLoginResult {
        var body: [String: Any] = [
            "email": email,
            "password": password,
        ]
        if let mfaCode, !mfaCode.isEmpty {
            body["mfaCode"] = mfaCode
        }
        return try await self.post(gatewayBaseURL: gatewayBaseURL, path: "/login", body: body)
    }

    func register(
        gatewayBaseURL: URL,
        email: String,
        password: String,
        displayName: String,
        inviteCode: String
    ) async throws -> PlatformAuthLoginResult {
        try await self.post(
            gatewayBaseURL: gatewayBaseURL,
            path: "/employee/register",
            body: [
                "email": email,
                "password": password,
                "displayName": displayName,
                "code": inviteCode,
            ])
    }

    func forgotPassword(gatewayBaseURL: URL, email: String) async throws -> PlatformAuthLoginResult {
        try await self.post(
            gatewayBaseURL: gatewayBaseURL,
            path: "/password/forgot",
            body: ["email": email])
    }

    func resetPassword(
        gatewayBaseURL: URL,
        email: String,
        password: String,
        code: String
    ) async throws -> PlatformAuthLoginResult {
        try await self.post(
            gatewayBaseURL: gatewayBaseURL,
            path: "/password/reset",
            body: [
                "email": email,
                "password": password,
                "code": code,
            ])
    }

    func logout(gatewayBaseURL: URL) async {
        _ = try? await self.post(gatewayBaseURL: gatewayBaseURL, path: "/logout", body: nil)
        self.clearCookies(for: gatewayBaseURL)
    }

    func cookieValue(for gatewayBaseURL: URL) -> String? {
        let cookies = self.cookieStorage.cookies(for: gatewayBaseURL) ?? []
        return cookies.first(where: { $0.name == self.cookieName })?.value
    }

    func applyPersistedCookie(gatewayBaseURL: URL, value: String) {
        GatewayWebSocketCookies.applyPlatformSessionCookie(
            value: value,
            gatewayBaseURL: gatewayBaseURL,
            storage: self.cookieStorage,
            cookieName: self.cookieName)
    }

    func clearCookies(for gatewayBaseURL: URL) {
        GatewayWebSocketCookies.clearPlatformSessionCookies(
            for: gatewayBaseURL,
            storage: self.cookieStorage,
            cookieName: self.cookieName)
    }

    func urlSessionForAuthenticatedCalls() -> URLSession {
        self.session
    }

    // MARK: - Private

    private func post(
        gatewayBaseURL: URL,
        path: String,
        body: [String: Any]?
    ) async throws -> PlatformAuthLoginResult {
        let url = try self.makeURL(gatewayBaseURL: gatewayBaseURL, path: path)
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        if let body {
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
            request.httpBody = try JSONSerialization.data(withJSONObject: body)
        }

        let (data, response) = try await self.session.data(for: request)
        guard let http = response as? HTTPURLResponse else {
            throw PlatformAuthAPIError(statusCode: -1, code: nil, message: "无效的服务器响应")
        }

        let json = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any]
        let ok = json?["ok"] as? Bool ?? false
        if !(200 ..< 300).contains(http.statusCode) || !ok {
            let message = (json?["error"] as? String)?.trimmingCharacters(in: .whitespacesAndNewlines)
            throw PlatformAuthAPIError(
                statusCode: http.statusCode,
                code: json?["code"] as? String,
                message: (message?.isEmpty == false ? message! : "请求失败（\(http.statusCode)）"))
        }

        let session = self.parseSession(from: json)
        let platformAuth = json?["platformAuth"] as? [String: Any]
        let pendingResetObj = platformAuth?["pendingPasswordReset"] as? [String: Any]
        let pendingReset = pendingResetObj?["code"] as? String
        // Normalize Domain=.openbot.love so WSS upgrades to www/admin/biz share the cookie.
        if let cookie = self.cookieValue(for: gatewayBaseURL), !cookie.isEmpty {
            self.applyPersistedCookie(gatewayBaseURL: gatewayBaseURL, value: cookie)
        }
        return PlatformAuthLoginResult(
            session: session,
            cookieHeaderValue: self.cookieValue(for: gatewayBaseURL),
            pendingResetCode: pendingReset)
    }

    private func makeURL(gatewayBaseURL: URL, path: String) throws -> URL {
        guard var components = URLComponents(url: gatewayBaseURL, resolvingAgainstBaseURL: false) else {
            throw PlatformAuthAPIError(statusCode: -1, code: nil, message: "网关地址无效")
        }
        let basePath = components.path.hasSuffix("/")
            ? String(components.path.dropLast())
            : components.path
        let suffix = path.hasPrefix("/") ? path : "/\(path)"
        components.path = "\(basePath)/__openbot/platform-auth\(suffix)"
        components.query = nil
        components.fragment = nil
        guard let url = components.url else {
            throw PlatformAuthAPIError(statusCode: -1, code: nil, message: "无法构造认证地址")
        }
        return url
    }

    private func parseSession(from json: [String: Any]?) -> PlatformAuthSession {
        let rootSession = json?["session"] as? [String: Any]
        let platformAuth = json?["platformAuth"] as? [String: Any]
        let nestedSession = platformAuth?["session"] as? [String: Any]
        let sessionObj = rootSession ?? nestedSession ?? [:]

        let email = (sessionObj["email"] as? String)
            ?? (sessionObj["user"] as? String)
            ?? ""
        let displayName = (sessionObj["displayName"] as? String)
            ?? (sessionObj["name"] as? String)
            ?? email
        let userId = (sessionObj["userId"] as? String)
            ?? (sessionObj["id"] as? String)
            ?? email
        let scopes = (sessionObj["scopes"] as? [String]) ?? []
        let kind = sessionObj["sessionKind"] as? String
            ?? sessionObj["kind"] as? String

        return PlatformAuthSession(
            userId: userId,
            email: email,
            displayName: displayName,
            sessionKind: kind,
            scopes: scopes)
    }
}
