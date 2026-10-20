//
//  EmployeeShellController.swift
//  Coordinates account/session, login, the embedded shell, and deep-link routing
//  (tasks 1.4 / 1.5 / 1.6 / 1.7-ios). Mirrors apps/macos EmployeeShellController.
//
//  Deep links are auth-gated: routes resolve within the ACTIVE account
//  (account-session-model.md); when signed out we stash the target as a pending
//  route, present login, and continue after a successful login (deferred deep
//  link). employee session ≠ node pairing (never touched here).
//
//  Uses the Observation framework so SwiftUI (`EmployeeShellRootView`) reacts to
//  login state + navigation intent.
//

import Foundation
import Observation
import OpenBotKit
import os

@MainActor
@Observable
final class EmployeeShellController {
    /// Default cloud gateway (self-hosted overrides via the login form).
    static let defaultGatewayURL = URL(string: "https://www.openbot.love")!

    private let logger = Logger(subsystem: "ai.openbot.ios", category: "employee-shell")
    let accounts: EmployeeAccountManager

    /// True while the login flow should be presented.
    var isPresentingLogin = false
    /// The embed path the shell should currently show.
    private(set) var currentTarget: String = EmployeeShellBootstrap.defaultTarget
    /// Bumped whenever the shell should be (re)mounted for the active account.
    private(set) var shellMountToken = 0

    /// Destination to continue to after a deferred (signed-out) deep-link login.
    private var pendingRoute: PendingRoute?

    /// Optional host hook for native chat (Wave 2 continuity carries sessionKey/agentId).
    var onNativeChat: ((_ sessionKey: String?, _ agentId: String?) -> Void)?

    enum PendingRoute: Equatable {
        case embed(path: String)
        case chat(sessionKey: String?, agentId: String?)
    }

    init(accounts: EmployeeAccountManager? = nil) {
        self.accounts = accounts ?? EmployeeAccountManager()
        // Register OS-level metric/diagnostic collection (M-COLD + crash-free) at launch.
        EmployeeShellMetrics.shared.start()
    }

    var isLoggedIn: Bool { self.accounts.activeAccount != nil }

    // MARK: - Shell config

    /// Build the config for the active account's isolated session + data store.
    func makeConfig(initialTarget: String) -> EmployeeShellConfig? {
        guard let account = self.accounts.activeAccount else { return nil }
        let container = self.accounts.container(for: account)
        let gateway = EmployeeAccountIdentity.canonicalizeCloudGatewayURL(account.gatewayBaseURL)
        return EmployeeShellConfig(
            gatewayBaseURL: gateway,
            initialTarget: initialTarget,
            tokenProvider: { target in
                try await container.mintToken(target: target)
            })
    }

    // MARK: - Entry points

    /// Open the shell (or login if signed out) at the default overview surface.
    func open() {
        self.route(.embed(path: EmployeeShellBootstrap.defaultTarget))
    }

    /// Route a URL deep link through the shared parser, then auth-gate it (task 1.7).
    /// Returns true if the URL was an employee-grammar route this controller handles.
    @discardableResult
    func handleDeepLink(url: URL) -> Bool {
        guard let parsed = DeepLinkParser.parse(url) else { return false }
        switch parsed {
        case .employee, .chat, .space, .knowledge:
            self.handle(route: parsed)
            return true
        case .agent, .gateway, .workspace:
            // Node/companion routes are handled by the existing DeepLink path.
            return false
        }
    }

    /// Route a parsed employee-grammar deep link (from the shared DeepLinkParser).
    func handle(route: DeepLinkRoute) {
        switch route {
        case let .employee(link):
            self.route(.embed(path: EmployeeEmbedRouting.embedPath(forSurface: link.surface.rawValue)))
        case let .chat(link):
            self.route(.chat(sessionKey: link.sessionKey, agentId: link.agentId))
        case let .space(link):
            self.route(.embed(path: EmployeeEmbedRouting.embedPath(forSpace: link.spaceId)))
        case let .knowledge(link):
            self.route(.embed(path: EmployeeEmbedRouting.embedPath(
                forKnowledge: link.objectId, kind: link.kind)))
        case .agent, .gateway, .workspace:
            break
        }
    }

    private func route(_ target: PendingRoute) {
        guard self.isLoggedIn else {
            // Deferred deep link: stash + present login; continue after login.
            self.pendingRoute = target
            self.isPresentingLogin = true
            return
        }
        self.dispatch(target)
    }

    private func dispatch(_ target: PendingRoute) {
        switch target {
        case let .embed(path):
            self.navigate(toEmbedPath: path)
        case let .chat(sessionKey, agentId):
            self.navigate(
                toEmbedPath: EmployeeEmbedRouting.embedPath(forChat: sessionKey, agentId: agentId))
        }
    }

    /// Navigate the shell to an embed path (mounting it first if needed).
    func navigate(toEmbedPath path: String) {
        // Employee Shell WebView is not the post-auth root (EmployeeRootTabs is).
        // Record the target only; do not construct or drive a shell WebView here.
        self.currentTarget = path
    }

    // MARK: - Native bridge intents from the embed

    func handleNativeIntent(_ intent: EmployeeShellIntent) {
        switch EmployeeEmbedRouting.action(for: intent) {
        case let .embedNavigation(path):
            self.navigate(toEmbedPath: path)
        case let .native(nativeIntent):
            self.handleNative(nativeIntent)
        }
    }

    private func handleNative(_ intent: EmployeeShellIntent) {
        switch intent {
        case let .openChat(sessionKey, agentId):
            self.onNativeChat?(sessionKey, agentId)
        case .openAssistant(let agentId):
            self.onNativeChat?(nil, agentId)
        case .openDeviceSettings:
            // Companion device settings live under "Me > Device" (D-COMPANION-IA).
            self.navigate(toEmbedPath: EmployeeEmbedRouting.embedPath(forSurface: "me"))
        case .ready, .openSpace, .openKnowledgeObject:
            break
        }
    }

    // MARK: - Auth (task 1.4)

    /// Password login into the account's isolated client jar; persists the session
    /// cookie and sets the account active. Continues any pending deep link.
    @discardableResult
    func login(gatewayBaseURL: URL, email: String, password: String) async throws -> EmployeeAccount {
        do {
            let gateway = EmployeeAccountIdentity.canonicalizeCloudGatewayURL(gatewayBaseURL)
            let attempt = EmployeeAccount(gatewayBaseURL: gateway, userEmail: email)
            let container = self.accounts.container(for: attempt)
            let client = EmployeeAuthClient(gatewayBaseURL: gateway, session: container.urlSession)
            let result = try await client.login(email: email, password: password)
            guard result.ok else { throw EmployeeAuthError.invalidCredentials }
            self.accounts.addOrLogin(attempt)
            EmployeeShellMetrics.shared.recordLoginAttempt(success: true)
            self.didLogin()
            return attempt
        } catch {
            EmployeeShellMetrics.shared.recordLoginAttempt(success: false)
            throw error
        }
    }

    func forgotPassword(gatewayBaseURL: URL, email: String) async throws {
        let gateway = EmployeeAccountIdentity.canonicalizeCloudGatewayURL(gatewayBaseURL)
        let attempt = EmployeeAccount(gatewayBaseURL: gateway, userEmail: email)
        let container = self.accounts.container(for: attempt)
        _ = try await EmployeeAuthClient(gatewayBaseURL: gateway, session: container.urlSession)
            .forgotPassword(email: email)
    }

    @discardableResult
    func register(
        gatewayBaseURL: URL, email: String, code: String, password: String, displayName: String?
    ) async throws -> EmployeeAccount {
        let gateway = EmployeeAccountIdentity.canonicalizeCloudGatewayURL(gatewayBaseURL)
        let attempt = EmployeeAccount(gatewayBaseURL: gateway, userEmail: email)
        let container = self.accounts.container(for: attempt)
        let client = EmployeeAuthClient(gatewayBaseURL: gateway, session: container.urlSession)
        let result = try await client.register(
            email: email, code: code, password: password, displayName: displayName)
        guard result.ok else { throw EmployeeAuthError.invalidCredentials }
        self.accounts.addOrLogin(attempt)
        self.didLogin()
        return attempt
    }

    /// Log out of the active account: clears its jars + secure creds server-side +
    /// locally; node pairing untouched (contract invariant 5).
    func logoutActiveAccount() async {
        guard let account = self.accounts.activeAccount else { return }
        let container = self.accounts.container(for: account)
        // Wave 2: revoke employee push for the leaving account before clearing session.
        await EmployeePushRegistration.unregister(
            account: account, session: container.urlSession, allDevices: false)
        _ = try? await EmployeeAuthClient(
            gatewayBaseURL: account.gatewayBaseURL, session: container.urlSession).logout()
        await self.accounts.logout()
        self.shellMountToken += 1
        if !self.isLoggedIn {
            self.isPresentingLogin = true
        }
    }

    /// Switch active org (same account): re-bootstrap into the new org view.
    func switchOrg(to orgId: String?) async {
        await self.accounts.switchOrg(orgId)
        self.shellMountToken += 1
    }

    /// Switch to another already-registered account and re-mount the shell.
    func switchAccount(to accountId: String) {
        let leaving = self.accounts.activeAccount
        if let leaving, leaving.accountId != accountId {
            let container = self.accounts.container(for: leaving)
            Task {
                await EmployeePushRegistration.unregister(
                    account: leaving, session: container.urlSession, allDevices: false)
            }
        }
        self.accounts.setActive(accountId)
        self.currentTarget = EmployeeShellBootstrap.defaultTarget
        self.shellMountToken += 1
        Task { await EmployeePushRegistration.registerIfPossible(accounts: self.accounts) }
    }

    /// Called when the shell hits a fatal auth failure (mint 401 / exhausted embed
    /// 401 retries): the login session is gone → present login.
    func handleSessionUnauthorized() {
        self.isPresentingLogin = true
    }

    private func didLogin() {
        self.isPresentingLogin = false
        self.shellMountToken += 1
        let target = self.pendingRoute ?? .embed(path: EmployeeShellBootstrap.defaultTarget)
        self.pendingRoute = nil
        self.dispatch(target)
        // Wave 2: register employee push after login (best-effort).
        Task { await EmployeePushRegistration.registerIfPossible(accounts: self.accounts) }
    }
}
