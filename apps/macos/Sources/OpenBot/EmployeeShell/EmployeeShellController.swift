//
//  EmployeeShellController.swift
//  Coordinates account/session, login, the embedded shell window, and deep-link
//  routing (tasks 1.4 / 1.5 / 1.6 / 1.7-macos).
//
//  Deep links are auth-gated: routes resolve within the ACTIVE account
//  (`account-session-model.md`); when signed out we stash the target as a
//  pending route, present login, and continue after a successful login
//  (deferred deep link). employee session ≠ node pairing (never touched here).
//

import AppKit
import Foundation
import OSLog
import OpenBotKit
import SwiftUI

@MainActor
final class EmployeeShellController {
    static let shared = EmployeeShellController()

    private let logger = Logger(subsystem: "ai.openbot", category: "employee-shell-controller")
    private let accounts: EmployeeAccountStore
    private var windowController: EmployeeShellWindowController?
    private var loginWindow: NSWindow?
    /// Target to continue to after a deferred (signed-out) deep link login.
    private var pendingRoute: PendingRoute?

    /// A resolved, auth-gated destination.
    enum PendingRoute: Equatable {
        case embed(path: String)
        case chat(sessionKey: String?, agentId: String?)
    }

    init(accounts: EmployeeAccountStore = .shared) {
        self.accounts = accounts
    }

    var isLoggedIn: Bool { self.accounts.activeAccount != nil }

    // MARK: - Public entry (menu / deep link)

    /// Open the shell (or login if signed out) at the default overview surface.
    func open() {
        // Stage 54: ensure notification tap-through is installed (idempotent).
        EmployeeNotificationRouter.shared.start()
        self.route(.embed(path: EmployeeShellBootstrap.defaultTarget))
    }

    // MARK: - Deep-link routing (task 1.7) — auth-gated

    /// Route a parsed employee-grammar deep link (from the shared DeepLinkParser).
    func handle(route: DeepLinkRoute) {
        EmployeeNotificationRouter.shared.start()
        guard let path = EmployeeShellDeepLinkRouting.embedPath(for: route) else {
            // Not employee routes; handled elsewhere (DeepLinkHandler).
            return
        }
        self.route(.embed(path: path))
    }

    private func route(_ target: PendingRoute) {
        let path: String
        switch target {
        case let .embed(p):
            path = p
        case let .chat(sessionKey, agentId):
            path = EmployeeEmbedRouting.embedPath(forChat: sessionKey, agentId: agentId)
        }
        switch EmployeeShellDeepLinkRouting.authGate(isLoggedIn: self.isLoggedIn, targetPath: path) {
        case let .presentLogin(pendingPath):
            // Deferred deep link: stash + present login; continue after login.
            self.pendingRoute = .embed(path: pendingPath)
            self.presentLogin()
        case let .openShell(openPath):
            self.dispatch(.embed(path: openPath))
        }
    }

    private func dispatch(_ target: PendingRoute) {
        switch target {
        case let .embed(path):
            self.openShell(navigatingTo: path)
        case let .chat(sessionKey, agentId):
            self.openShell(
                navigatingTo: EmployeeEmbedRouting.embedPath(forChat: sessionKey, agentId: agentId))
        }
    }

    // MARK: - Shell window

    private func openShell(navigatingTo path: String) {
        guard let account = self.accounts.activeAccount else {
            self.presentLogin()
            return
        }
        let controller = self.ensureWindowController()
        if controller.hasShell {
            controller.showAndFocus()
            controller.navigate(toEmbedPath: path)
        } else {
            controller.present(config: self.makeConfig(for: account, initialTarget: path))
        }
    }

    private func ensureWindowController() -> EmployeeShellWindowController {
        if let existing = self.windowController { return existing }
        let controller = EmployeeShellWindowController()
        controller.onSessionUnauthorized = { [weak self] in
            // Mint 401 / repeated embed 401 → the login session is gone.
            self?.presentLogin()
        }
        controller.onNativeIntent = { [weak self] intent in
            self?.handleNativeIntent(intent)
        }
        controller.onEmbedReady = {
            // M-TTI end + first cold-start ready (task 1.11 telemetry).
            EmployeeShellTelemetry.shared.recordEmbedReady(token: "shell")
            EmployeeShellTelemetry.shared.recordColdStartReady()
        }
        self.windowController = controller
        return controller
    }

    private func makeConfig(for account: EmployeeAccount, initialTarget: String) -> EmployeeShellConfig {
        let accounts = self.accounts
        let gateway = EmployeeAccount.canonicalizeCloudGatewayURL(account.gatewayBaseURL)
        return EmployeeShellConfig(
            gatewayBaseURL: gateway,
            initialTarget: initialTarget,
            websiteDataStore: accounts.webDataStore(for: account),
            tokenProvider: { target in
                // M-TTI begin: measured from bootstrap start to embed first paint.
                await EmployeeShellTelemetry.shared.recordBootstrapBegin(token: "shell")
                let session = accounts.clientSession(for: account)
                return try await EmployeeShellBootstrap.mintToken(
                    baseURL: gateway, session: session, target: target)
            })
    }

    /// Native bridge intents from the embed (device-settings / signOut / legacy chat).
    /// Stage 53 / ADR option 1: employee UI stays the Web embed window; companion
    /// owns Gateway / TCC / node. Device settings therefore open the menu-bar
    /// companion Settings window — never the employee "me" embed, and never a
    /// native four-tab shell.
    private func handleNativeIntent(_ intent: EmployeeShellIntent) {
        switch intent {
        case let .openChat(sessionKey, _):
            // Rare native path; primary chat stays in the Web embed via routing.
            WebChatManager.shared.show(sessionKey: sessionKey ?? "")
        case .openAssistant:
            WebChatManager.shared.show(sessionKey: "")
        case .openDeviceSettings:
            SettingsWindowOpener.shared.open()
        case .signOut:
            Task { await self.logoutActiveAccount() }
        case .ready, .openSpace, .openKnowledgeObject:
            break
        }
    }

    // MARK: - Auth (task 1.4)

    /// Perform password login into the account's isolated Client Session Jar and
    /// persist the resulting session cookie. Sets the account active on success.
    @discardableResult
    func login(gatewayBaseURL: URL, email: String, password: String) async throws -> EmployeeAccount {
        EmployeeShellTelemetry.shared.recordLoginAttempt()
        let gateway = EmployeeAccount.canonicalizeCloudGatewayURL(gatewayBaseURL)
        // Transient account value to obtain the isolated (per-accountId) session.
        let attempt = EmployeeAccount(gatewayBaseURL: gateway, userEmail: email)
        let session = self.accounts.clientSession(for: attempt)
        let client = EmployeeAuthClient(gatewayBaseURL: gateway, session: session)
        let result = try await client.login(email: email, password: password)
        guard result.ok else {
            throw EmployeeAuthError.invalidCredentials
        }
        let account = self.accounts.upsert(gatewayBaseURL: gateway, userEmail: email)
        self.accounts.persistClientCookies(for: account)
        EmployeeShellTelemetry.shared.recordLoginSuccess()
        return account
    }

    func forgotPassword(gatewayBaseURL: URL, email: String) async throws {
        let gateway = EmployeeAccount.canonicalizeCloudGatewayURL(gatewayBaseURL)
        let attempt = EmployeeAccount(gatewayBaseURL: gateway, userEmail: email)
        let session = self.accounts.clientSession(for: attempt)
        _ = try await EmployeeAuthClient(gatewayBaseURL: gateway, session: session)
            .forgotPassword(email: email)
    }

    /// Reset a password with an emailed code (completes the forgot flow).
    func resetPassword(gatewayBaseURL: URL, code: String, newPassword: String) async throws {
        // A transient session is enough; reset does not need an existing account.
        let gateway = EmployeeAccount.canonicalizeCloudGatewayURL(gatewayBaseURL)
        let attempt = EmployeeAccount(gatewayBaseURL: gateway, userEmail: "reset@\(gateway.host ?? "gateway")")
        let session = self.accounts.clientSession(for: attempt)
        let result = try await EmployeeAuthClient(gatewayBaseURL: gateway, session: session)
            .resetPassword(code: code, newPassword: newPassword)
        guard result.ok else { throw EmployeeAuthError.invalidCredentials }
    }

    /// SSO = existing trusted-proxy entry (D-LOGIN). Opens the gateway web login
    /// in the default browser where the trusted proxy establishes identity; we do
    /// NOT reimplement OIDC and do NOT introduce MFA. After completing SSO the
    /// user returns and the shell bootstraps.
    func beginSSO(gatewayBaseURL: URL) {
        NSWorkspace.shared.open(gatewayBaseURL)
    }

    @discardableResult
    func register(
        gatewayBaseURL: URL, email: String, code: String, password: String, displayName: String?
    ) async throws -> EmployeeAccount {
        let gateway = EmployeeAccount.canonicalizeCloudGatewayURL(gatewayBaseURL)
        let attempt = EmployeeAccount(gatewayBaseURL: gateway, userEmail: email)
        let session = self.accounts.clientSession(for: attempt)
        let client = EmployeeAuthClient(gatewayBaseURL: gateway, session: session)
        let result = try await client.register(
            email: email, code: code, password: password, displayName: displayName)
        guard result.ok else {
            throw EmployeeAuthError.invalidCredentials
        }
        let account = self.accounts.upsert(gatewayBaseURL: gateway, userEmail: email)
        self.accounts.persistClientCookies(for: account)
        return account
    }

    /// Log out of the active account: clears its jars + secure creds, leaves the
    /// node pairing session untouched (contract invariant 5).
    func logoutActiveAccount() async {
        guard let account = self.accounts.activeAccount else { return }
        let session = self.accounts.clientSession(for: account)
        _ = try? await EmployeeAuthClient(gatewayBaseURL: account.gatewayBaseURL, session: session).logout()
        await self.accounts.logout(accountId: account.accountId)
        self.windowController?.close()
        self.windowController = nil
    }

    /// Switch the active organization (same account): re-bootstrap into the new org.
    func switchOrg(to orgId: String?) {
        guard let account = self.accounts.activeAccount else { return }
        self.accounts.switchOrg(accountId: account.accountId, to: orgId)
        self.windowController?.reBootstrap()
    }

    // MARK: - Multi-account (task 1.4)

    /// All known accounts (for a switcher UI).
    func knownAccounts() -> [EmployeeAccount] { self.accounts.allAccounts() }

    var activeAccountId: String? { self.accounts.activeAccountId }

    /// Switch the active account (no data wiped) and rebuild the shell for it.
    func switchAccount(to accountId: String) {
        guard accountId != self.accounts.activeAccountId else { return }
        self.accounts.switchTo(accountId: accountId)
        guard let account = self.accounts.activeAccount else { return }
        // Rebuild the shell bound to the newly active account's stores.
        let controller = self.ensureWindowController()
        controller.present(config: self.makeConfig(
            for: account, initialTarget: EmployeeShellBootstrap.defaultTarget))
    }

    /// Start adding another account (opens the login window; keeps current one).
    func addAccount() {
        self.presentLogin()
    }

    // MARK: - Login window

    private func presentLogin() {
        if let window = self.loginWindow {
            NSApp.activate(ignoringOtherApps: true)
            window.makeKeyAndOrderFront(nil)
            return
        }
        let model = EmployeeLoginViewModel()
        model.onLoggedIn = { [weak self] account in
            self?.didLogin(account)
        }
        let hosting = NSHostingController(rootView: EmployeeLoginView(model: model))
        let window = NSWindow(contentViewController: hosting)
        window.title = "Sign in to OpenBot"
        window.styleMask = [.titled, .closable]
        window.isReleasedWhenClosed = false
        window.center()
        self.loginWindow = window
        NSApp.activate(ignoringOtherApps: true)
        window.makeKeyAndOrderFront(nil)
    }

    private func didLogin(_ account: EmployeeAccount) {
        self.loginWindow?.close()
        self.loginWindow = nil
        let target = self.pendingRoute ?? .embed(path: EmployeeShellBootstrap.defaultTarget)
        self.pendingRoute = nil
        self.dispatch(target)
    }
}
