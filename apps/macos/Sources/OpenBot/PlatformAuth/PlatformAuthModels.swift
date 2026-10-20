import Foundation

enum OpenBotCloudDefaults {
    /// Public auth/entry host — same surface as Android / Web / Mac www login.
    static let baseURL = URL(string: "https://www.openbot.love")!
    static let wsHost = "www.openbot.love"
    static let wsPort = 443
    static let wsURLString = "wss://www.openbot.love"
    static let loginPath = "/__openbot/platform-auth/login"
    static let logoutPath = "/__openbot/platform-auth/logout"
    static let sessionPath = "/__openbot/platform-auth/session"
}

enum PlatformAuthMode: String, CaseIterable, Identifiable, Sendable {
    case login
    case register
    case forgotPassword
    case resetPassword

    var id: String { self.rawValue }

    var title: String {
        switch self {
        case .login: "登录"
        case .register: "注册"
        case .forgotPassword: "找回密码"
        case .resetPassword: "重置密码"
        }
    }
}

struct PlatformAuthSession: Equatable, Sendable, Codable {
    var userId: String
    var email: String
    var displayName: String
    var sessionKind: String?
    var scopes: [String]
}

struct PlatformAuthAPIError: Error, LocalizedError, Sendable {
    var statusCode: Int
    var code: String?
    var message: String

    var errorDescription: String? { self.message }
}

struct PlatformAuthLoginResult: Sendable {
    var session: PlatformAuthSession
    var cookieHeaderValue: String?
    var pendingResetCode: String?
}
