//
//  EmployeeLoginView.swift
//  Native employee login + onboarding UI (task 1.4-macos, i18n 1.9-macos).
//
//  Wave 1 (D-LOGIN): password login + forgot-password + reset-with-code +
//  invited register + gateway selection (cloud default / self-hosted) +
//  multi-account. SSO routes to the existing trusted-proxy entry (no new OIDC).
//  NO employee MFA. Obtains the employee-domain session cookie into the
//  account's isolated Client Session Jar via EmployeeShellController.
//

import Observation
import SwiftUI

enum EmployeeLoginMode: String, CaseIterable, Identifiable {
    case login
    case forgot
    case reset
    case register
    var id: String { self.rawValue }

    var titleKey: EmployeeShellStrings.Key {
        switch self {
        case .login: return .signIn
        case .forgot: return .resetPassword
        case .reset: return .resetPassword
        case .register: return .joinWithInvite
        }
    }

    var title: String { EmployeeShellStrings.string(self.titleKey) }
}

@MainActor
@Observable
final class EmployeeLoginViewModel {
    /// Cloud gateway default (contract). Users may point at a self-hosted gateway.
    static let defaultGateway = "https://www.openbot.love"

    var mode: EmployeeLoginMode = .login
    var gatewayURLString: String = EmployeeLoginViewModel.defaultGateway
    var email: String = ""
    var password: String = ""
    var newPassword: String = ""
    var inviteCode: String = ""
    var resetCode: String = ""
    var displayName: String = ""
    var isSubmitting = false
    var errorMessage: String?
    var infoMessage: String?

    /// Called after a successful login (session established for `account`).
    var onLoggedIn: (EmployeeAccount) -> Void = { _ in }

    private let controller: EmployeeShellController

    init(controller: EmployeeShellController = .shared) {
        self.controller = controller
    }

    var canSubmit: Bool {
        guard !self.isSubmitting, self.gatewayURL != nil else { return false }
        switch self.mode {
        case .login:
            return !self.email.isEmpty && !self.password.isEmpty
        case .forgot:
            return !self.email.isEmpty
        case .reset:
            return !self.resetCode.isEmpty && !self.newPassword.isEmpty
        case .register:
            return !self.email.isEmpty && !self.inviteCode.isEmpty && !self.password.isEmpty
        }
    }

    var canSSO: Bool { !self.isSubmitting && self.gatewayURL != nil }

    var gatewayURL: URL? {
        let trimmed = self.gatewayURLString.trimmingCharacters(in: .whitespacesAndNewlines)
        guard let url = URL(string: trimmed), url.scheme != nil, url.host != nil else { return nil }
        return url
    }

    func submit() async {
        guard let gateway = self.gatewayURL else {
            self.errorMessage = EmployeeShellStrings.string(.couldNotReachWorkspace)
            return
        }
        self.isSubmitting = true
        self.errorMessage = nil
        self.infoMessage = nil
        defer { self.isSubmitting = false }
        do {
            switch self.mode {
            case .login:
                let account = try await self.controller.login(
                    gatewayBaseURL: gateway, email: self.email, password: self.password)
                self.onLoggedIn(account)
            case .forgot:
                try await self.controller.forgotPassword(gatewayBaseURL: gateway, email: self.email)
                self.infoMessage = EmployeeShellStrings.string(.resetSent)
                self.mode = .reset
            case .reset:
                try await self.controller.resetPassword(
                    gatewayBaseURL: gateway, code: self.resetCode, newPassword: self.newPassword)
                self.infoMessage = EmployeeShellStrings.string(.resetSent)
                self.password = ""
                self.mode = .login
            case .register:
                let account = try await self.controller.register(
                    gatewayBaseURL: gateway,
                    email: self.email,
                    code: self.inviteCode,
                    password: self.password,
                    displayName: self.displayName.isEmpty ? nil : self.displayName)
                self.onLoggedIn(account)
            }
        } catch let error as EmployeeAuthError {
            self.errorMessage = Self.describe(error)
        } catch {
            self.errorMessage = error.localizedDescription
        }
    }

    /// SSO = existing trusted-proxy entry (no new OIDC, no MFA). Opens the
    /// gateway's web login where the trusted proxy establishes identity.
    func beginSSO() {
        guard let gateway = self.gatewayURL else { return }
        self.controller.beginSSO(gatewayBaseURL: gateway)
    }

    private static func describe(_ error: EmployeeAuthError) -> String {
        switch error {
        case .invalidCredentials: return EmployeeShellStrings.string(.invalidCredentials)
        case .badURL: return EmployeeShellStrings.string(.couldNotReachWorkspace)
        case .decoding: return EmployeeShellStrings.string(.couldNotReachWorkspace)
        case let .network(message): return message
        case let .server(status, message): return message ?? "Request failed (\(status))."
        }
    }
}

struct EmployeeLoginView: View {
    @State var model: EmployeeLoginViewModel

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            Text(EmployeeShellStrings.string(.brand)).font(.title2).bold()
            Picker("", selection: self.$model.mode) {
                ForEach(EmployeeLoginMode.allCases) { mode in
                    Text(mode.title).tag(mode)
                }
            }
            .pickerStyle(.segmented)
            .labelsHidden()
            .accessibilityLabel(Text(EmployeeShellStrings.string(.signIn)))

            VStack(alignment: .leading, spacing: 10) {
                self.field(.gateway, text: self.$model.gatewayURLString, prompt: "https://www.openbot.love")
                if self.model.mode != .reset {
                    self.field(.email, text: self.$model.email, prompt: "you@company.com")
                }
                if self.model.mode == .login || self.model.mode == .register {
                    self.secureField(.password, text: self.$model.password)
                }
                if self.model.mode == .reset {
                    self.field(.resetCode, text: self.$model.resetCode, prompt: "")
                    self.secureField(.newPassword, text: self.$model.newPassword)
                }
                if self.model.mode == .register {
                    self.field(.inviteCode, text: self.$model.inviteCode, prompt: "")
                    self.field(.displayName, text: self.$model.displayName,
                               prompt: EmployeeShellStrings.string(.optional))
                }
            }

            if let error = self.model.errorMessage {
                Text(error).font(.callout).foregroundStyle(.red)
                    .accessibilityAddTraits(.isStaticText)
            }
            if let info = self.model.infoMessage {
                Text(info).font(.callout).foregroundStyle(.secondary)
            }

            HStack {
                Button(EmployeeShellStrings.string(.ssoSignIn)) {
                    self.model.beginSSO()
                }
                .disabled(!self.model.canSSO)
                .accessibilityHint(Text("trusted-proxy"))
                Spacer()
                Button {
                    Task { await self.model.submit() }
                } label: {
                    if self.model.isSubmitting {
                        ProgressView().controlSize(.small)
                    } else {
                        Text(self.model.mode.title)
                    }
                }
                .keyboardShortcut(.defaultAction)
                .disabled(!self.model.canSubmit)
            }
        }
        .padding(24)
        .frame(width: 380)
    }

    private func field(_ key: EmployeeShellStrings.Key, text: Binding<String>, prompt: String) -> some View {
        let label = EmployeeShellStrings.string(key)
        return VStack(alignment: .leading, spacing: 3) {
            Text(label).font(.caption).foregroundStyle(.secondary)
            TextField(prompt, text: text)
                .textFieldStyle(.roundedBorder)
                .accessibilityLabel(Text(label))
        }
    }

    private func secureField(_ key: EmployeeShellStrings.Key, text: Binding<String>) -> some View {
        let label = EmployeeShellStrings.string(key)
        return VStack(alignment: .leading, spacing: 3) {
            Text(label).font(.caption).foregroundStyle(.secondary)
            SecureField(label, text: text)
                .textFieldStyle(.roundedBorder)
                .accessibilityLabel(Text(label))
        }
    }
}
