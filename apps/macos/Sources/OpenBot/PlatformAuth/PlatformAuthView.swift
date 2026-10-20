import AppKit
import SwiftUI

/// Native platform auth surface embedded in the main OpenBot window.
/// Modes: 登录 / 注册 as segmented control; forgot/reset via inline links (no duplicate tabs).
struct PlatformAuthView: View {
    @Bindable var store: PlatformAuthSessionStore
    @State private var mode: PlatformAuthMode = .login
    @State private var email = ""
    @State private var password = ""
    @State private var displayName = ""
    @State private var inviteCode = ""
    @State private var resetCode = ""
    @State private var showGatewayField = false

    var body: some View {
        ZStack {
            PlatformAuthPalette.background
                .ignoresSafeArea()

            GeometryReader { geo in
                ScrollView {
                    VStack(spacing: 0) {
                        self.authCard
                            .frame(maxWidth: 400)
                            .padding(.horizontal, 40)
                            .padding(.vertical, 32)
                    }
                    .frame(maxWidth: .infinity)
                    // Center the card in the visible window; still scroll when content is taller.
                    .frame(minWidth: geo.size.width, minHeight: geo.size.height)
                }
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    private var authCard: some View {
        VStack(alignment: .center, spacing: 22) {
            self.brandHeader
            self.modeSwitcher
            self.formFields
            self.feedback
            self.primaryActions
            self.secondaryLinks
        }
        .frame(maxWidth: .infinity)
    }

    private var brandHeader: some View {
        VStack(spacing: 10) {
            if let logo = PlatformAuthBrandLogo.image {
                Image(nsImage: logo)
                    .resizable()
                    .interpolation(.high)
                    .renderingMode(.original)
                    .aspectRatio(contentMode: .fit)
                    .frame(width: 168, height: 160)
                    .background(Color.clear)
            }

            Text("面向团队的 AI 工作台")
                .font(.system(size: 18, weight: .semibold))
                .foregroundStyle(PlatformAuthPalette.ink)
                .multilineTextAlignment(.center)

            Text(self.subtitle)
                .font(.system(size: 14, weight: .regular))
                .foregroundStyle(PlatformAuthPalette.muted)
                .multilineTextAlignment(.center)
                .fixedSize(horizontal: false, vertical: true)
        }
        .frame(maxWidth: .infinity)
    }

    private var subtitle: String {
        switch self.mode {
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

    private var modeSwitcher: some View {
        Group {
            if self.mode == .login || self.mode == .register {
                // Native segmented control — reliable hit-testing on macOS
                // (custom capsule chips were not receiving taps for 注册).
                Picker("认证方式", selection: self.loginRegisterBinding) {
                    Text("登录").tag(PlatformAuthMode.login)
                    Text("注册").tag(PlatformAuthMode.register)
                }
                .pickerStyle(.segmented)
                .labelsHidden()
                .disabled(self.store.isBusy)
                .frame(maxWidth: 280)
            } else {
                Button {
                    withAnimation(.easeInOut(duration: 0.18)) {
                        self.mode = .login
                        self.store.errorMessage = nil
                        self.store.noticeMessage = nil
                    }
                } label: {
                    HStack(spacing: 8) {
                        Image(systemName: "arrow.left")
                            .font(.system(size: 12, weight: .semibold))
                        Text(self.mode.title)
                            .font(.system(size: 13, weight: .semibold))
                    }
                    .foregroundStyle(PlatformAuthPalette.ink)
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .disabled(self.store.isBusy)
            }
        }
    }

    /// Keeps Picker selection in the login/register pair without fighting forgot/reset modes.
    private var loginRegisterBinding: Binding<PlatformAuthMode> {
        Binding(
            get: {
                self.mode == .register ? .register : .login
            },
            set: { newValue in
                withAnimation(.easeInOut(duration: 0.18)) {
                    self.mode = newValue
                    self.store.errorMessage = nil
                    self.store.noticeMessage = nil
                }
            })
    }

    private var formFields: some View {
        VStack(alignment: .leading, spacing: 14) {
            if self.showGatewayField {
                self.field(
                    label: "网关",
                    prompt: "https://www.openbot.love",
                    text: self.$store.gatewayBaseURLString,
                    secure: false)
            }

            if self.mode == .register {
                self.field(label: "显示名称", prompt: "你的名字", text: self.$displayName, secure: false)
            }

            self.field(label: "邮箱", prompt: "you@company.com", text: self.$email, secure: false)

            if self.mode == .register || self.mode == .resetPassword || self.mode == .login {
                self.field(
                    label: self.mode == .resetPassword ? "新密码" : "密码",
                    prompt: "密码",
                    text: self.$password,
                    secure: true)
            }

            if self.mode == .register {
                self.field(label: "邀请码", prompt: "企业邀请码", text: self.$inviteCode, secure: false)
            }

            if self.mode == .resetPassword {
                self.field(label: "验证码", prompt: "邮件中的重置码", text: self.$resetCode, secure: false)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private func field(
        label: String,
        prompt: String,
        text: Binding<String>,
        secure: Bool
    ) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(label)
                .font(.system(size: 12, weight: .medium))
                .foregroundStyle(PlatformAuthPalette.muted)

            Group {
                if secure {
                    SecureField(prompt, text: text)
                } else {
                    TextField(prompt, text: text)
                        .textContentType(label == "邮箱" ? .username : .none)
                }
            }
            .font(.system(size: 14))
            .padding(.horizontal, 12)
            .padding(.vertical, 10)
            .background(PlatformAuthPalette.fieldFill, in: RoundedRectangle(cornerRadius: 10, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: 10, style: .continuous)
                    .stroke(PlatformAuthPalette.fieldStroke, lineWidth: 1))
            .textFieldStyle(.plain)
        }
    }

    @ViewBuilder
    private var feedback: some View {
        if let error = self.store.errorMessage, !error.isEmpty {
            Text(error)
                .font(.system(size: 12))
                .foregroundStyle(Color(red: 0.72, green: 0.22, blue: 0.18))
                .frame(maxWidth: .infinity, alignment: .leading)
                .fixedSize(horizontal: false, vertical: true)
        } else if let notice = self.store.noticeMessage, !notice.isEmpty {
            Text(notice)
                .font(.system(size: 12))
                .foregroundStyle(PlatformAuthPalette.muted)
                .frame(maxWidth: .infinity, alignment: .leading)
                .fixedSize(horizontal: false, vertical: true)
        }
    }

    private var primaryActions: some View {
        Button {
            Task { await self.submit() }
        } label: {
            HStack {
                if self.store.isBusy {
                    ProgressView()
                        .controlSize(.small)
                }
                Text(self.primaryButtonTitle)
                    .font(.system(size: 14, weight: .semibold))
            }
            .frame(maxWidth: .infinity)
            .padding(.vertical, 12)
            .foregroundStyle(self.canSubmit && !self.store.isBusy ? Color.white : Color.white.opacity(0.85))
            .background(
                RoundedRectangle(cornerRadius: 12, style: .continuous)
                    .fill(PlatformAuthPalette.accent.opacity(self.canSubmit && !self.store.isBusy ? 1 : 0.45)))
        }
        .buttonStyle(.plain)
        .disabled(self.store.isBusy || !self.canSubmit)
        .keyboardShortcut(.defaultAction)
    }

    private var primaryButtonTitle: String {
        switch self.mode {
        case .login: "登录"
        case .register: "加入工作区"
        case .forgotPassword: "发送重置码"
        case .resetPassword: "更新密码"
        }
    }

    private var secondaryLinks: some View {
        HStack(spacing: 16) {
            if self.mode == .login {
                Button("忘记密码？") {
                    withAnimation(.easeInOut(duration: 0.18)) {
                        self.mode = .forgotPassword
                    }
                }
                .buttonStyle(.plain)
                .font(.system(size: 12, weight: .medium))
                .foregroundStyle(PlatformAuthPalette.accent)
            }

            if self.mode == .forgotPassword {
                Button("我有验证码") {
                    withAnimation(.easeInOut(duration: 0.18)) {
                        self.mode = .resetPassword
                    }
                }
                .buttonStyle(.plain)
                .font(.system(size: 12, weight: .medium))
                .foregroundStyle(PlatformAuthPalette.accent)
            }

            Spacer()

            Button(self.showGatewayField ? "收起网关" : "高级") {
                withAnimation(.easeInOut(duration: 0.18)) {
                    self.showGatewayField.toggle()
                }
            }
            .buttonStyle(.plain)
            .font(.system(size: 12, weight: .medium))
            .foregroundStyle(PlatformAuthPalette.muted)
        }
        .padding(.top, 2)
    }

    private var canSubmit: Bool {
        let emailOK = !self.email.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
        switch self.mode {
        case .login:
            return emailOK && !self.password.isEmpty
        case .register:
            return emailOK
                && !self.password.isEmpty
                && !self.inviteCode.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
        case .forgotPassword:
            return emailOK
        case .resetPassword:
            return emailOK
                && !self.password.isEmpty
                && !self.resetCode.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
        }
    }

    private func submit() async {
        let trimmedEmail = self.email.trimmingCharacters(in: .whitespacesAndNewlines)
        switch self.mode {
        case .login:
            await self.store.login(email: trimmedEmail, password: self.password)
            if self.store.isAuthenticated {
                self.password = ""
            }
        case .register:
            await self.store.register(
                email: trimmedEmail,
                password: self.password,
                displayName: self.displayName.trimmingCharacters(in: .whitespacesAndNewlines),
                inviteCode: self.inviteCode.trimmingCharacters(in: .whitespacesAndNewlines))
            if self.store.isAuthenticated {
                self.password = ""
                self.inviteCode = ""
            }
        case .forgotPassword:
            await self.store.forgotPassword(email: trimmedEmail)
            withAnimation(.easeInOut(duration: 0.18)) {
                self.mode = .resetPassword
            }
        case .resetPassword:
            await self.store.resetPassword(
                email: trimmedEmail,
                password: self.password,
                code: self.resetCode.trimmingCharacters(in: .whitespacesAndNewlines))
            if self.store.isAuthenticated {
                self.password = ""
                self.resetCode = ""
            }
        }
    }
}

private enum PlatformAuthBrandLogo {
    /// Canonical transparent mark lives at `ui/public/openbot-logo.png` and is copied to
    /// `Resources/OpenBotAuthLogo.png` by `scripts/generate_openbot_logo_assets.py`.
    static var image: NSImage? {
        if let url = Bundle.main.url(forResource: "OpenBotAuthLogo", withExtension: "png"),
           let image = NSImage(contentsOf: url)
        {
            return image
        }
        #if SWIFT_PACKAGE
        if let url = Bundle.module.url(forResource: "OpenBotAuthLogo", withExtension: "png"),
           let image = NSImage(contentsOf: url)
        {
            return image
        }
        #endif
        // Dev fallback: look next to the executable / known Resources path.
        let candidates = [
            Bundle.main.bundleURL
                .appendingPathComponent("Contents/Resources/OpenBotAuthLogo.png"),
            URL(fileURLWithPath: #filePath)
                .deletingLastPathComponent()
                .deletingLastPathComponent()
                .appendingPathComponent("Resources/OpenBotAuthLogo.png"),
        ]
        for url in candidates {
            if let image = NSImage(contentsOf: url) {
                return image
            }
        }
        return nil
    }
}

private enum PlatformAuthPalette {
    // Warm stone + charcoal gold — avoids purple / cream / terracotta AI defaults.
    static let background = Color(red: 0.965, green: 0.960, blue: 0.949)
    static let ink = Color(red: 0.14, green: 0.13, blue: 0.12)
    static let muted = Color(red: 0.45, green: 0.43, blue: 0.40)
    static let accent = Color(red: 0.55, green: 0.40, blue: 0.16)
    static let fieldFill = Color.white.opacity(0.72)
    static let fieldStroke = Color(red: 0.86, green: 0.84, blue: 0.80)
}
