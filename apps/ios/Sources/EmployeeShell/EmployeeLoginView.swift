//
//  EmployeeLoginView.swift
//  Native employee login / onboarding (task 1.4-ios) + i18n/a11y (task 1.9-ios).
//
//  Wave 1 D-LOGIN: password login + forgot password + invited register + gateway
//  selection (cloud default / self-hosted) + multi-account switch. NO employee MFA.
//  SSO stays the existing trusted-proxy entry (opened in the shell, not re-implemented).
//  Talks to platform-auth via `EmployeeShellController` → `EmployeeAuthClient`.
//
//  Copy is localized (zh-Hans/en) via `EmployeeShellStrings`; controls carry VoiceOver
//  labels, scale with Dynamic Type (Form/Text default), and keep >=44pt hit targets.
//

import SwiftUI

struct EmployeeLoginView: View {
    let controller: EmployeeShellController

    private enum Mode: String, CaseIterable, Identifiable {
        case signIn
        case register
        case forgot
        var id: String { self.rawValue }

        var title: String {
            switch self {
            case .signIn: EmployeeShellStrings.modeSignIn
            case .register: EmployeeShellStrings.modeJoin
            case .forgot: EmployeeShellStrings.modeReset
            }
        }
    }

    private enum GatewayChoice: Hashable {
        case cloud
        case custom
    }

    @State private var mode: Mode = .signIn
    @State private var gatewayChoice: GatewayChoice = .cloud
    @State private var customGateway = ""
    @State private var email = ""
    @State private var password = ""
    @State private var inviteCode = ""
    @State private var displayName = ""
    @State private var statusMessage: String?
    @State private var isError = false
    @State private var isBusy = false

    var body: some View {
        NavigationStack {
            Form {
                self.gatewaySection
                self.modeSection
                self.credentialsSection
                if let statusMessage {
                    Section {
                        Text(statusMessage)
                            .font(.footnote)
                            .foregroundStyle(self.isError ? Color.red : Color.secondary)
                    }
                }
                self.actionSection
                self.accountsSection
                self.ssoSection
            }
            .navigationTitle(EmployeeShellStrings.brand)
            .disabled(self.isBusy)
        }
    }

    // MARK: - Sections

    private var gatewaySection: some View {
        Section(EmployeeShellStrings.gatewaySection) {
            Picker(EmployeeShellStrings.gatewaySection, selection: self.$gatewayChoice) {
                Text(EmployeeShellStrings.gatewayCloud).tag(GatewayChoice.cloud)
                Text(EmployeeShellStrings.gatewaySelfHosted).tag(GatewayChoice.custom)
            }
            .pickerStyle(.segmented)
            .accessibilityLabel(EmployeeShellStrings.gatewaySection)
            if self.gatewayChoice == .custom {
                TextField(EmployeeShellStrings.gatewayURLPlaceholder, text: self.$customGateway)
                    .textContentType(.URL)
                    .keyboardType(.URL)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                    .accessibilityLabel(EmployeeShellStrings.gatewaySelfHosted)
            }
        }
    }

    private var modeSection: some View {
        Section {
            Picker(EmployeeShellStrings.modeSignIn, selection: self.$mode) {
                ForEach(Mode.allCases) { mode in
                    Text(mode.title).tag(mode)
                }
            }
            .pickerStyle(.segmented)
            .accessibilityLabel(EmployeeShellStrings.modeSignIn)
        }
    }

    @ViewBuilder private var credentialsSection: some View {
        Section {
            TextField(EmployeeShellStrings.email, text: self.$email)
                .textContentType(.emailAddress)
                .keyboardType(.emailAddress)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
                .accessibilityLabel(EmployeeShellStrings.email)
            if self.mode != .forgot {
                SecureField(
                    self.mode == .register ? EmployeeShellStrings.setPassword : EmployeeShellStrings.password,
                    text: self.$password)
                    .textContentType(self.mode == .register ? .newPassword : .password)
                    .accessibilityLabel(EmployeeShellStrings.password)
            }
            if self.mode == .register {
                TextField(EmployeeShellStrings.invitationCode, text: self.$inviteCode)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                    .accessibilityLabel(EmployeeShellStrings.invitationCode)
                TextField(EmployeeShellStrings.displayNameOptional, text: self.$displayName)
                    .accessibilityLabel(EmployeeShellStrings.displayNameOptional)
            }
        }
    }

    private var actionSection: some View {
        Section {
            Button(action: self.submit) {
                HStack {
                    if self.isBusy { ProgressView() }
                    Text(self.primaryActionTitle)
                }
                .frame(maxWidth: .infinity, minHeight: 44)
            }
            .disabled(!self.canSubmit)
            .accessibilityLabel(self.primaryActionTitle)
        }
    }

    @ViewBuilder private var accountsSection: some View {
        let others = self.controller.accounts.accounts
        if !others.isEmpty {
            Section(EmployeeShellStrings.accountsSection) {
                ForEach(others) { account in
                    let isActive = account.accountId == self.controller.accounts.activeAccountId
                    let host = account.gatewayBaseURL.host() ?? account.gatewayBaseURL.absoluteString
                    Button {
                        self.controller.switchAccount(to: account.accountId)
                    } label: {
                        HStack {
                            VStack(alignment: .leading) {
                                Text(account.userEmail).font(.body)
                                Text(host)
                                    .font(.caption)
                                    .foregroundStyle(.secondary)
                            }
                            Spacer()
                            if isActive {
                                Image(systemName: "checkmark.circle.fill").foregroundStyle(.tint)
                            }
                        }
                        .frame(minHeight: 44)
                    }
                    .accessibilityElement(children: .ignore)
                    .accessibilityLabel("\(account.userEmail), \(host)")
                    .accessibilityAddTraits(isActive ? [.isButton, .isSelected] : .isButton)
                }
            }
        }
    }

    private var ssoSection: some View {
        Section {
            Text(EmployeeShellStrings.ssoNote)
                .font(.caption)
                .foregroundStyle(.secondary)
        }
    }

    // MARK: - Derived

    private var primaryActionTitle: String {
        switch self.mode {
        case .signIn: EmployeeShellStrings.actionSignIn
        case .register: EmployeeShellStrings.actionJoin
        case .forgot: EmployeeShellStrings.actionSendResetLink
        }
    }

    private var canSubmit: Bool {
        guard !self.isBusy, !self.email.isEmpty else { return false }
        switch self.mode {
        case .signIn: return !self.password.isEmpty
        case .register: return !self.password.isEmpty && !self.inviteCode.isEmpty
        case .forgot: return true
        }
    }

    private func resolveGatewayURL() -> URL? {
        switch self.gatewayChoice {
        case .cloud:
            return EmployeeShellController.defaultGatewayURL
        case .custom:
            let trimmed = self.customGateway.trimmingCharacters(in: .whitespacesAndNewlines)
            guard let url = URL(string: trimmed), url.scheme == "https" || url.scheme == "http" else {
                return nil
            }
            return url
        }
    }

    // MARK: - Actions

    private func submit() {
        guard let gatewayURL = self.resolveGatewayURL() else {
            self.show(EmployeeShellStrings.errorInvalidGatewayURL, error: true)
            return
        }
        self.isBusy = true
        self.statusMessage = nil
        Task {
            defer { self.isBusy = false }
            do {
                switch self.mode {
                case .signIn:
                    _ = try await self.controller.login(
                        gatewayBaseURL: gatewayURL, email: self.email, password: self.password)
                case .register:
                    _ = try await self.controller.register(
                        gatewayBaseURL: gatewayURL,
                        email: self.email,
                        code: self.inviteCode,
                        password: self.password,
                        displayName: self.displayName.isEmpty ? nil : self.displayName)
                case .forgot:
                    try await self.controller.forgotPassword(gatewayBaseURL: gatewayURL, email: self.email)
                    self.show(EmployeeShellStrings.resetLinkSent, error: false)
                }
            } catch {
                self.show(Self.describe(error), error: true)
            }
        }
    }

    private func show(_ message: String, error: Bool) {
        self.statusMessage = message
        self.isError = error
    }

    private static func describe(_ error: Error) -> String {
        switch error {
        case EmployeeAuthError.invalidCredentials:
            return EmployeeShellStrings.errorInvalidCredentials
        case let EmployeeAuthError.server(status, message):
            return message ?? EmployeeShellStrings.serverError(status: status)
        case let EmployeeAuthError.network(message):
            return message
        default:
            return (error as NSError).localizedDescription
        }
    }
}
