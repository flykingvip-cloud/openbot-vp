import Foundation

enum OpenBotCloudDefaults {
    /// Public auth/entry host — same surface as Android / Web / Mac www login.
    static let baseURL = URL(string: "https://www.openbot.love")!
    static let wsHost = "www.openbot.love"
    static let wsPort = 443
    static let wsURLString = "wss://www.openbot.love"
    static let loginPath = "/__openbot/platform-auth/login"
    static let registerPath = "/__openbot/platform-auth/employee/register"
    static let forgotPasswordPath = "/__openbot/platform-auth/password/forgot"
    static let resetPasswordPath = "/__openbot/platform-auth/password/reset"
    static let changePasswordPath = "/__openbot/platform-auth/password/change"
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

enum PlatformAuthLoginOutcome: Equatable {
    case success(email: String)
    case mfaRequired
    case notice(message: String)
    case failure(message: String)
}

enum PlatformAuthCopy {
    /// Matches www auth-home hero title.
    static let brandSlogan = "面向团队的 AI 工作台"

    static func subtitle(for mode: PlatformAuthMode) -> String {
        switch mode {
        case .login:
            "协作、沉淀知识、推进工作，在一个空间内完成。"
        case .register:
            "使用邀请码加入企业工作区。"
        case .forgotPassword:
            "输入邮箱，获取密码重置验证码。"
        case .resetPassword:
            "输入验证码与新密码完成重置。"
        }
    }

    static func localizeError(_ message: String) -> String {
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
}
