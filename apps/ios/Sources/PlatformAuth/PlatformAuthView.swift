import SwiftUI

/// Native platform auth card — layout/copy aligned with macOS `PlatformAuthView`.
struct PlatformAuthView: View {
    enum Completion {
        case authenticated(email: String)
        case openManualSetup
    }

    var onComplete: (Completion) -> Void

    @State private var mode: PlatformAuthMode = .login
    @State private var email = ""
    @State private var password = ""
    @State private var displayName = ""
    @State private var inviteCode = ""
    @State private var resetCode = ""
    @State private var mfaCode = ""
    @State private var needsMfaCode = false
    @State private var showGatewayField = false
    @State private var gatewayBaseURLString = OpenBotCloudDefaults.baseURL.absoluteString
    @State private var isBusy = false
    @State private var errorMessage: String?
    @State private var noticeMessage: String?

    var body: some View {
        ZStack {
            PlatformAuthPalette.background
                .ignoresSafeArea()

            ScrollView {
                VStack(spacing: 22) {
                    self.brandHeader
                    self.modeSwitcher
                    self.formFields
                    self.feedback
                    self.primaryActions
                    self.secondaryLinks
                }
                .padding(.horizontal, 28)
                .padding(.vertical, 36)
                .frame(maxWidth: 420)
                .frame(maxWidth: .infinity)
            }
            .scrollDismissesKeyboard(.interactively)
        }
        // Auth card is intentionally light; force light scheme so dark-mode
        // system colors don't turn field/button labels into white-on-beige.
        .preferredColorScheme(.light)
        .tint(PlatformAuthPalette.accent)
    }

    private var brandHeader: some View {
        VStack(spacing: 10) {
            Image("OpenBotAuthLogo")
                .resizable()
                .interpolation(.high)
                .renderingMode(.original)
                .aspectRatio(contentMode: .fit)
                .frame(width: 168, height: 160)

            Text(PlatformAuthCopy.brandSlogan)
                .font(.system(size: 18, weight: .semibold))
                .foregroundStyle(PlatformAuthPalette.ink)
                .multilineTextAlignment(.center)

            Text(PlatformAuthCopy.subtitle(for: self.mode))
                .font(.system(size: 14, weight: .regular))
                .foregroundStyle(PlatformAuthPalette.muted)
                .multilineTextAlignment(.center)
                .fixedSize(horizontal: false, vertical: true)
        }
        .frame(maxWidth: .infinity)
    }

    private var modeSwitcher: some View {
        Group {
            if self.mode == .login || self.mode == .register {
                HStack(spacing: 4) {
                    self.modeChip(.login)
                    self.modeChip(.register)
                }
                .padding(4)
                .background(
                    RoundedRectangle(cornerRadius: 12, style: .continuous)
                        .fill(Color.black.opacity(0.06)))
                .disabled(self.isBusy)
            } else {
                Button {
                    withAnimation(.easeInOut(duration: 0.18)) {
                        self.mode = .login
                        self.clearFeedback()
                    }
                } label: {
                    HStack(spacing: 8) {
                        Image(systemName: "chevron.left")
                            .font(.system(size: 12, weight: .semibold))
                        Text(self.mode.title)
                            .font(.system(size: 13, weight: .semibold))
                    }
                    .foregroundStyle(PlatformAuthPalette.ink)
                }
                .buttonStyle(.plain)
                .disabled(self.isBusy)
            }
        }
    }

    private func modeChip(_ value: PlatformAuthMode) -> some View {
        let selected = self.mode == value
        return Button {
            withAnimation(.easeInOut(duration: 0.18)) {
                self.mode = value
                self.clearFeedback()
                self.needsMfaCode = false
            }
        } label: {
            Text(value.title)
                .font(.system(size: 14, weight: .semibold))
                .foregroundStyle(selected ? Color.white : PlatformAuthPalette.ink)
                .frame(maxWidth: .infinity)
                .padding(.vertical, 10)
                .background(
                    RoundedRectangle(cornerRadius: 9, style: .continuous)
                        .fill(selected ? PlatformAuthPalette.accent : Color.clear))
        }
        .buttonStyle(.plain)
    }

    private var formFields: some View {
        VStack(alignment: .leading, spacing: 14) {
            if self.showGatewayField {
                self.field(label: "网关", prompt: "https://www.openbot.love", text: self.$gatewayBaseURLString, secure: false)
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

            if self.needsMfaCode, self.mode == .login {
                self.field(label: "两步验证码", prompt: "6 位动态码", text: self.$mfaCode, secure: false)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private func field(
        label: String,
        prompt: String,
        text: Binding<String>,
        secure: Bool) -> some View
    {
        VStack(alignment: .leading, spacing: 6) {
            Text(label)
                .font(.system(size: 12, weight: .medium))
                .foregroundStyle(PlatformAuthPalette.muted)

            Group {
                if secure {
                    SecureField(prompt, text: text)
                } else {
                    TextField(prompt, text: text)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                        .keyboardType(label == "邮箱" ? .emailAddress : .default)
                        .textContentType(label == "邮箱" ? .username : .none)
                }
            }
            .font(.system(size: 14))
            .foregroundStyle(PlatformAuthPalette.ink)
            .tint(PlatformAuthPalette.accent)
            .padding(.horizontal, 12)
            .padding(.vertical, 12)
            .background(Color.white, in: RoundedRectangle(cornerRadius: 10, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: 10, style: .continuous)
                    .stroke(PlatformAuthPalette.fieldStroke, lineWidth: 1))
        }
    }

    @ViewBuilder
    private var feedback: some View {
        if let error = self.errorMessage, !error.isEmpty {
            Text(error)
                .font(.system(size: 12))
                .foregroundStyle(Color(red: 0.72, green: 0.22, blue: 0.18))
                .frame(maxWidth: .infinity, alignment: .leading)
        } else if let notice = self.noticeMessage, !notice.isEmpty {
            Text(notice)
                .font(.system(size: 12))
                .foregroundStyle(PlatformAuthPalette.muted)
                .frame(maxWidth: .infinity, alignment: .leading)
        }
    }

    private var primaryActions: some View {
        let enabled = self.canSubmit && !self.isBusy
        return Button {
            Task { await self.submit() }
        } label: {
            HStack {
                if self.isBusy {
                    ProgressView()
                        .controlSize(.small)
                        .tint(enabled ? Color.white : PlatformAuthPalette.ink)
                }
                Text(self.primaryButtonTitle)
                    .font(.system(size: 14, weight: .semibold))
            }
            .frame(maxWidth: .infinity)
            .padding(.vertical, 14)
            .foregroundStyle(enabled ? Color.white : PlatformAuthPalette.ink.opacity(0.55))
            .background(
                RoundedRectangle(cornerRadius: 12, style: .continuous)
                    .fill(enabled ? PlatformAuthPalette.accent : PlatformAuthPalette.disabledFill))
        }
        .buttonStyle(.plain)
        .disabled(self.isBusy || !self.canSubmit)
    }

    private var primaryButtonTitle: String {
        switch self.mode {
        case .login: self.isBusy ? "登录中…" : "登录"
        case .register: self.isBusy ? "加入中…" : "加入工作区"
        case .forgotPassword: self.isBusy ? "发送中…" : "发送重置码"
        case .resetPassword: self.isBusy ? "更新中…" : "更新密码"
        }
    }

    private var secondaryLinks: some View {
        HStack(spacing: 16) {
            if self.mode == .login {
                Button("忘记密码？") {
                    withAnimation(.easeInOut(duration: 0.18)) {
                        self.mode = .forgotPassword
                        self.clearFeedback()
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
                        self.clearFeedback()
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

            if self.mode == .login {
                Button("手动设置") {
                    self.onComplete(.openManualSetup)
                }
                .buttonStyle(.plain)
                .font(.system(size: 12, weight: .medium))
                .foregroundStyle(PlatformAuthPalette.muted)
            }
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

    private func clearFeedback() {
        self.errorMessage = nil
        self.noticeMessage = nil
    }

    private func resolvedBaseURL() -> URL {
        let raw = self.gatewayBaseURLString.trimmingCharacters(in: .whitespacesAndNewlines)
        if let url = URL(string: raw), url.scheme != nil, url.host != nil {
            return url
        }
        return OpenBotCloudDefaults.baseURL
    }

    private func submit() async {
        if self.isBusy { return }
        self.isBusy = true
        self.clearFeedback()
        defer { self.isBusy = false }

        let baseURL = self.resolvedBaseURL()
        let trimmedEmail = self.email.trimmingCharacters(in: .whitespacesAndNewlines)
        let outcome: PlatformAuthLoginOutcome
        switch self.mode {
        case .login:
            outcome = await PlatformAuthClient.login(
                email: trimmedEmail,
                password: self.password,
                mfaCode: self.needsMfaCode ? self.mfaCode : nil,
                baseURL: baseURL)
        case .register:
            outcome = await PlatformAuthClient.register(
                email: trimmedEmail,
                password: self.password,
                displayName: self.displayName,
                inviteCode: self.inviteCode,
                baseURL: baseURL)
        case .forgotPassword:
            outcome = await PlatformAuthClient.forgotPassword(email: trimmedEmail, baseURL: baseURL)
        case .resetPassword:
            outcome = await PlatformAuthClient.resetPassword(
                email: trimmedEmail,
                password: self.password,
                code: self.resetCode,
                baseURL: baseURL)
        }

        switch outcome {
        case let .success(email):
            self.needsMfaCode = false
            self.password = ""
            self.onComplete(.authenticated(email: email))
        case .mfaRequired:
            self.needsMfaCode = true
            self.noticeMessage = "请输入两步验证码后继续。"
        case let .notice(message):
            self.noticeMessage = message
            if self.mode == .forgotPassword {
                withAnimation(.easeInOut(duration: 0.18)) {
                    self.mode = .resetPassword
                }
            }
        case let .failure(message):
            self.errorMessage = message
        }
    }
}

private enum PlatformAuthPalette {
    static let background = Color(red: 0.965, green: 0.960, blue: 0.949)
    static let ink = Color(red: 0.14, green: 0.13, blue: 0.12)
    static let muted = Color(red: 0.45, green: 0.43, blue: 0.40)
    static let accent = Color(red: 0.55, green: 0.40, blue: 0.16)
    static let fieldStroke = Color(red: 0.86, green: 0.84, blue: 0.80)
    static let disabledFill = Color(red: 0.90, green: 0.88, blue: 0.84)
}
