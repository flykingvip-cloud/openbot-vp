//
//  EmployeeShellStrings.swift
//  Native employee-shell localized strings (task 1.9-macos, i18n zh/en).
//
//  The macOS app has no existing NSLocalizedString / .strings catalog, so the
//  employee-shell native surfaces (login / onboarding / placeholder / menu)
//  carry their own minimal, self-contained zh-CN + en table. Language follows
//  the user's preferred languages (a `zh*` prefix → Simplified Chinese, else
//  English). Pure + testable.
//

import Foundation

enum EmployeeShellLanguage {
    case zhHans
    case en

    /// Resolve from the process's preferred languages (defaults to English).
    static var current: EmployeeShellLanguage {
        self.from(preferred: Locale.preferredLanguages.first)
    }

    static func from(preferred: String?) -> EmployeeShellLanguage {
        guard let code = preferred?.lowercased() else { return .en }
        return code.hasPrefix("zh") ? .zhHans : .en
    }
}

/// Localized strings for the employee-shell native surfaces.
enum EmployeeShellStrings {
    enum Key: String, CaseIterable {
        // App / brand
        case brand
        // Login modes
        case signIn
        case resetPassword
        case joinWithInvite
        case ssoSignIn
        // Fields
        case gateway
        case email
        case password
        case newPassword
        case inviteCode
        case resetCode
        case displayName
        case optional
        // Actions / status
        case retry
        case signOut
        case switchAccount
        case switchOrg
        case addAccount
        case openWorkspace
        case windowTitle
        // Messages
        case resetSent
        case invalidCredentials
        case couldNotReachWorkspace
        case sessionExpiredReconnecting
        case couldNotLoadCheckConnection
        case chooseFiles
    }

    static func string(_ key: Key, _ language: EmployeeShellLanguage = EmployeeShellLanguage.current) -> String {
        switch language {
        case .zhHans: return self.zhHans[key] ?? key.rawValue
        case .en: return self.en[key] ?? key.rawValue
        }
    }

    private static let en: [Key: String] = [
        .brand: "OpenBot",
        .signIn: "Sign in",
        .resetPassword: "Reset password",
        .joinWithInvite: "Join with invite",
        .ssoSignIn: "Sign in with SSO",
        .gateway: "Gateway",
        .email: "Email",
        .password: "Password",
        .newPassword: "New password",
        .inviteCode: "Invite code",
        .resetCode: "Reset code",
        .displayName: "Display name",
        .optional: "optional",
        .retry: "Retry",
        .signOut: "Sign out",
        .switchAccount: "Switch account",
        .switchOrg: "Switch organization",
        .addAccount: "Add account",
        .openWorkspace: "Employee Workbench",
        .windowTitle: "Employee Workbench",
        .resetSent: "If that account exists, a reset link is on its way.",
        .invalidCredentials: "Email or password is incorrect.",
        .couldNotReachWorkspace: "Could not reach the workspace.",
        .sessionExpiredReconnecting: "Session expired. Reconnecting…",
        .couldNotLoadCheckConnection: "Could not load the workspace. Check your connection.",
        .chooseFiles: "Choose Files",
    ]

    private static let zhHans: [Key: String] = [
        .brand: "OpenBot",
        .signIn: "登录",
        .resetPassword: "重置密码",
        .joinWithInvite: "受邀加入",
        .ssoSignIn: "使用 SSO 登录",
        .gateway: "网关",
        .email: "邮箱",
        .password: "密码",
        .newPassword: "新密码",
        .inviteCode: "邀请码",
        .resetCode: "重置验证码",
        .displayName: "显示名称",
        .optional: "可选",
        .retry: "重试",
        .signOut: "退出登录",
        .switchAccount: "切换账号",
        .switchOrg: "切换组织",
        .addAccount: "添加账号",
        .openWorkspace: "员工工作台",
        .windowTitle: "员工工作台",
        .resetSent: "若该账号存在，重置链接即将发送。",
        .invalidCredentials: "邮箱或密码不正确。",
        .couldNotReachWorkspace: "无法连接到工作台。",
        .sessionExpiredReconnecting: "会话已过期，正在重新连接…",
        .couldNotLoadCheckConnection: "无法加载工作台，请检查网络连接。",
        .chooseFiles: "选择文件",
    ]
}
