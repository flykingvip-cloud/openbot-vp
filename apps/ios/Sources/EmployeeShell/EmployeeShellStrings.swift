//
//  EmployeeShellStrings.swift
//  Localized copy for the employee-shell NATIVE surfaces (task 1.9-ios).
//
//  Scope: the native shell strings this owner controls — login / onboarding /
//  gateway selection / errors / offline placeholder. The business surfaces
//  (overview/me/knowledge/…) are Web embeds localized by web-ui (`ui/src/i18n/**`),
//  not here.
//
//  The app currently ships no localization infrastructure, so rather than
//  introducing app-wide `.strings`/String Catalog plumbing (which would reach far
//  beyond apps/ios employee-shell), this is a self-contained zh-Hans / en table
//  keyed off the device's preferred language. zh-Hans is served to any Chinese
//  preferred language; everything else falls back to English.
//

import Foundation

enum EmployeeShellStrings {
    /// True when the user's top preferred language is Chinese (zh, zh-Hans, zh-CN, …).
    static var prefersChinese: Bool {
        guard let lang = Locale.preferredLanguages.first?.lowercased() else { return false }
        return lang.hasPrefix("zh")
    }

    // MARK: Login / onboarding

    static var brand: String { "OpenBot" }
    static var gatewaySection: String { self.pick(zh: "网关", en: "Gateway") }
    static var gatewayCloud: String { self.pick(zh: "OpenBot 云", en: "OpenBot Cloud") }
    static var gatewaySelfHosted: String { self.pick(zh: "自建网关", en: "Self-hosted") }
    static var gatewayURLPlaceholder: String { "https://gateway.example.com" }

    static var modeSignIn: String { self.pick(zh: "登录", en: "Sign in") }
    static var modeJoin: String { self.pick(zh: "加入", en: "Join") }
    static var modeReset: String { self.pick(zh: "重置", en: "Reset") }

    static var email: String { self.pick(zh: "邮箱", en: "Email") }
    static var password: String { self.pick(zh: "密码", en: "Password") }
    static var setPassword: String { self.pick(zh: "设置密码", en: "Set a password") }
    static var invitationCode: String { self.pick(zh: "邀请码", en: "Invitation code") }
    static var displayNameOptional: String { self.pick(zh: "显示名称（可选）", en: "Display name (optional)") }

    static var actionSignIn: String { self.pick(zh: "登录", en: "Sign in") }
    static var actionJoin: String { self.pick(zh: "加入", en: "Join") }
    static var actionSendResetLink: String { self.pick(zh: "发送重置链接", en: "Send reset link") }

    static var accountsSection: String { self.pick(zh: "账号", en: "Accounts") }
    static var ssoNote: String {
        self.pick(
            zh: "单点登录使用你所在组织的可信代理。选择网关后，如需 SSO 请在浏览器提示中继续。",
            en: "Single sign-on uses your organization's trusted proxy. "
                + "Choose your gateway and continue in the browser prompt if SSO is required.")
    }

    // MARK: Errors / status

    static var errorInvalidGatewayURL: String {
        self.pick(zh: "请输入有效的 https 网关地址。", en: "Enter a valid https gateway URL.")
    }

    static var errorInvalidCredentials: String {
        self.pick(zh: "邮箱或密码不正确。", en: "That email or password didn't work.")
    }

    static var resetLinkSent: String {
        self.pick(zh: "如果该邮箱存在，重置链接即将发送。", en: "If that email exists, a reset link is on its way.")
    }

    static func serverError(status: Int) -> String {
        self.pick(zh: "服务器错误（\(status)）。", en: "Server error (\(status)).")
    }

    // MARK: Offline placeholder

    static var offlineTitle: String { self.pick(zh: "无法连接 OpenBot", en: "Can't reach OpenBot") }
    static var retry: String { self.pick(zh: "重试", en: "Retry") }

    // MARK: File chooser

    static var chooseAttachment: String { self.pick(zh: "添加附件", en: "Add attachment") }
    static var photoLibrary: String { self.pick(zh: "照片图库", en: "Photo Library") }
    static var browseFiles: String { self.pick(zh: "浏览文件", en: "Browse Files") }
    static var cancel: String { self.pick(zh: "取消", en: "Cancel") }

    // MARK: - Helper

    private static func pick(zh: String, en: String) -> String {
        self.prefersChinese ? zh : en
    }
}
