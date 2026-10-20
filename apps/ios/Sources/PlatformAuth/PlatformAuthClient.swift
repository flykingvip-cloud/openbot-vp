import Foundation
import OSLog

enum PlatformAuthClient {
    private static let logger = Logger(subsystem: "ai.openbot.ios", category: "platform-auth")

    /// Shared session so login Set-Cookie lands in HTTPCookieStorage.shared
    /// and rides subsequent Gateway WebSocket upgrades to the same host.
    static let urlSession: URLSession = {
        let config = URLSessionConfiguration.default
        config.httpCookieAcceptPolicy = .always
        config.httpShouldSetCookies = true
        config.httpCookieStorage = HTTPCookieStorage.shared
        config.timeoutIntervalForRequest = 30
        config.timeoutIntervalForResource = 45
        return URLSession(configuration: config)
    }()

    static func login(
        email: String,
        password: String,
        mfaCode: String? = nil,
        baseURL: URL = OpenBotCloudDefaults.baseURL) async -> PlatformAuthLoginOutcome
    {
        let trimmedEmail = email.trimmingCharacters(in: .whitespacesAndNewlines)
        if trimmedEmail.isEmpty || password.isEmpty {
            return .failure(message: "请输入邮箱和密码。")
        }
        var body: [String: Any] = [
            "email": trimmedEmail,
            "password": password,
        ]
        if let code = mfaCode?.trimmingCharacters(in: .whitespacesAndNewlines), !code.isEmpty {
            body["mfaCode"] = code
        }
        return await self.post(
            path: OpenBotCloudDefaults.loginPath,
            body: body,
            baseURL: baseURL,
            successEmail: trimmedEmail)
    }

    static func register(
        email: String,
        password: String,
        displayName: String,
        inviteCode: String,
        baseURL: URL = OpenBotCloudDefaults.baseURL) async -> PlatformAuthLoginOutcome
    {
        let trimmedEmail = email.trimmingCharacters(in: .whitespacesAndNewlines)
        let trimmedInvite = inviteCode.trimmingCharacters(in: .whitespacesAndNewlines)
        if trimmedEmail.isEmpty || password.isEmpty || trimmedInvite.isEmpty {
            return .failure(message: "请填写邮箱、密码和邀请码。")
        }
        return await self.post(
            path: OpenBotCloudDefaults.registerPath,
            body: [
                "email": trimmedEmail,
                "password": password,
                "displayName": displayName.trimmingCharacters(in: .whitespacesAndNewlines),
                "code": trimmedInvite,
            ],
            baseURL: baseURL,
            successEmail: trimmedEmail)
    }

    static func forgotPassword(
        email: String,
        baseURL: URL = OpenBotCloudDefaults.baseURL) async -> PlatformAuthLoginOutcome
    {
        let trimmedEmail = email.trimmingCharacters(in: .whitespacesAndNewlines)
        if trimmedEmail.isEmpty {
            return .failure(message: "请输入邮箱。")
        }
        return await self.post(
            path: OpenBotCloudDefaults.forgotPasswordPath,
            body: ["email": trimmedEmail],
            baseURL: baseURL,
            successEmail: trimmedEmail,
            treatSuccessAsNotice: "重置验证码已发送，请查收邮件。")
    }

    static func resetPassword(
        email: String,
        password: String,
        code: String,
        baseURL: URL = OpenBotCloudDefaults.baseURL) async -> PlatformAuthLoginOutcome
    {
        let trimmedEmail = email.trimmingCharacters(in: .whitespacesAndNewlines)
        let trimmedCode = code.trimmingCharacters(in: .whitespacesAndNewlines)
        if trimmedEmail.isEmpty || password.isEmpty || trimmedCode.isEmpty {
            return .failure(message: "请填写邮箱、验证码和新密码。")
        }
        return await self.post(
            path: OpenBotCloudDefaults.resetPasswordPath,
            body: [
                "email": trimmedEmail,
                "password": password,
                "code": trimmedCode,
            ],
            baseURL: baseURL,
            successEmail: trimmedEmail)
    }

    static func logout(baseURL: URL = OpenBotCloudDefaults.baseURL) async {
        if let logoutURL = URL(string: OpenBotCloudDefaults.logoutPath, relativeTo: baseURL)?.absoluteURL {
            var request = URLRequest(url: logoutURL)
            request.httpMethod = "POST"
            request.setValue("application/json", forHTTPHeaderField: "Accept")
            _ = try? await Self.urlSession.data(for: request)
        }
        Self.clearCloudCookies(for: baseURL)
    }

    static func hasCloudSessionCookies(baseURL: URL = OpenBotCloudDefaults.baseURL) -> Bool {
        let cookies = HTTPCookieStorage.shared.cookies(for: baseURL) ?? []
        return cookies.contains { cookie in
            let name = cookie.name.lowercased()
            return name.contains("platform") || name.contains("session") || name.contains("openbot")
        }
    }

    /// Probe `/platform-auth/session` — true only when the cookie still maps to a live session.
    static func hasValidSession(baseURL: URL = OpenBotCloudDefaults.baseURL) async -> Bool {
        guard Self.hasCloudSessionCookies(baseURL: baseURL) else { return false }
        guard let url = URL(string: OpenBotCloudDefaults.sessionPath, relativeTo: baseURL)?.absoluteURL
        else {
            return false
        }
        var request = URLRequest(url: url)
        request.httpMethod = "GET"
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        do {
            let (data, response) = try await Self.urlSession.data(for: request)
            guard let http = response as? HTTPURLResponse, (200..<300).contains(http.statusCode)
            else {
                return false
            }
            let json = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any]
            if let authenticated = json?["authenticated"] as? Bool {
                return authenticated
            }
            // Some gateways return the session object directly on success.
            return json?["userId"] != nil || json?["email"] != nil || json?["session"] != nil
        } catch {
            return false
        }
    }

    static func clearCloudCookies(for baseURL: URL = OpenBotCloudDefaults.baseURL) {
        let storage = HTTPCookieStorage.shared
        let candidates =
            (storage.cookies(for: baseURL) ?? [])
                + (storage.cookies ?? []).filter {
                    $0.domain.contains("openbot.love")
                }
        for cookie in candidates {
            storage.deleteCookie(cookie)
        }
    }

    private static func post(
        path: String,
        body: [String: Any],
        baseURL: URL,
        successEmail: String,
        treatSuccessAsNotice: String? = nil) async -> PlatformAuthLoginOutcome
    {
        guard let url = URL(string: path, relativeTo: baseURL)?.absoluteURL else {
            return .failure(message: "无效的认证地址。")
        }

        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        do {
            request.httpBody = try JSONSerialization.data(withJSONObject: body)
        } catch {
            return .failure(message: "无法编码请求。")
        }

        do {
            let (data, response) = try await Self.urlSession.data(for: request)
            guard let http = response as? HTTPURLResponse else {
                return .failure(message: "认证失败：无效响应。")
            }
            let json = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any]
            let code = (json?["code"] as? String)?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
            let errorMessage = (json?["error"] as? String)?
                .trimmingCharacters(in: .whitespacesAndNewlines)
            let noticeMessage = (json?["message"] as? String)?
                .trimmingCharacters(in: .whitespacesAndNewlines)

            if (200..<300).contains(http.statusCode) {
                Self.logger.info("platform-auth ok path=\(path, privacy: .public)")
                if let treatSuccessAsNotice {
                    return .notice(message: treatSuccessAsNotice)
                }
                if let noticeMessage, !noticeMessage.isEmpty, json?["session"] == nil {
                    return .notice(message: PlatformAuthCopy.localizeError(noticeMessage))
                }
                // Login/register must leave a session cookie for mint → employee shell.
                if path == OpenBotCloudDefaults.loginPath
                    || path == OpenBotCloudDefaults.registerPath
                    || path == OpenBotCloudDefaults.resetPasswordPath
                {
                    if json?["session"] == nil, json?["ok"] as? Bool != true {
                        return .failure(message: "登录响应缺少会话，请重试。")
                    }
                    if !Self.hasCloudSessionCookies(baseURL: baseURL) {
                        Self.logger.error("platform-auth ok but no session cookie stored")
                        return .failure(message: "登录成功但未能保存会话，请重试。")
                    }
                }
                return .success(email: successEmail)
            }

            if code == "PLATFORM_AUTH_MFA_REQUIRED" || code == "PLATFORM_AUTH_MFA_REQUIRED_ENROLL_FIRST" {
                return .mfaRequired
            }

            let fallback = (errorMessage?.isEmpty == false)
                ? PlatformAuthCopy.localizeError(errorMessage!)
                : "认证失败（HTTP \(http.statusCode)）。"
            return .failure(message: fallback)
        } catch {
            return .failure(message: "无法连接云端：\(error.localizedDescription)")
        }
    }
}
