import SwiftUI

/// App root — authenticated → native four-tab companion (`EmployeeRootTabs`);
/// otherwise PlatformAuth. Manual gateway / node canvas via「手动设置」(legacy).
/// Optional Employee Shell WebView remains under 我的→更多 (not primary).
struct RootView: View {
    @Environment(GatewayConnectionController.self) private var gatewayController

    @AppStorage(WorkspaceEntryPolicy.cloudSignedInKey) private var cloudSignedIn = false
    /// Aligns with Android SecurePrefs `employee.welcome.seen` (first-install only).
    @AppStorage("employee.welcome.seen") private var employeeWelcomeSeen = false
    @State private var showLegacyCanvas = false
    @State private var restoreTask: Task<Void, Never>?

    var body: some View {
        Group {
            if !self.employeeWelcomeSeen {
                EmployeeWelcomeView {
                    self.employeeWelcomeSeen = true
                }
            } else if self.cloudSignedIn {
                // Stage 39+: native four-tab companion (HTML/Android SoT).
                // Employee Shell WebView is optional under 我的→更多 — not the primary shell.
                EmployeeRootTabs {
                    Task { await self.logoutToAuth() }
                }
            } else if self.showLegacyCanvas, LegacyShellPolicy.isLegacyShellEnabled {
                RootCanvas()
            } else {
                PlatformAuthView { completion in
                    switch completion {
                    case let .authenticated(email):
                        Task { await self.enterWorkbenchAfterLogin(email: email) }
                    case .openManualSetup:
                        if LegacyShellPolicy.isLegacyShellEnabled {
                            self.showLegacyCanvas = true
                        }
                    }
                }
            }
        }
        .onAppear {
            self.restoreTask?.cancel()
            self.restoreTask = Task { await self.restoreSessionIfPossible() }
        }
        .onReceive(NotificationCenter.default.publisher(for: .openBotCloudAuthSucceeded)) { _ in
            Task { await self.enterWorkbenchAfterLogin(email: "") }
        }
    }

    private func enterWorkbenchAfterLogin(email: String) async {
        // Background gateway connect for node features — must NOT gate the workbench UI.
        await CloudConnectionApplier.applyAfterLogin(gatewayController: self.gatewayController)
        WorkspaceEntryPolicy.setCloudSignedIn(true)
        await MainActor.run {
            self.cloudSignedIn = true
            self.showLegacyCanvas = false
        }
        _ = email
    }

    private func logoutToAuth() async {
        await PlatformAuthClient.logout()
        WorkspaceEntryPolicy.setCloudSignedIn(false)
        WorkspaceEntryPolicy.setPreferEmployeeShell(false)
        await MainActor.run {
            self.cloudSignedIn = false
            self.showLegacyCanvas = false
        }
    }

    /// Cold start: reopen workbench only when platform session is still valid.
    /// Do not race this against an in-progress fresh login (cookies already set).
    private func restoreSessionIfPossible() async {
        guard self.cloudSignedIn || WorkspaceEntryPolicy.preferEmployeeShell else { return }
        // Fresh login already flipped cloudSignedIn with live cookies — skip probe.
        if PlatformAuthClient.hasCloudSessionCookies() {
            await MainActor.run {
                self.cloudSignedIn = true
                self.showLegacyCanvas = false
                // Existing session → skip first-install welcome (Android upgrade path).
                self.employeeWelcomeSeen = true
            }
            WorkspaceEntryPolicy.setCloudSignedIn(true)
            return
        }
        let valid = await PlatformAuthClient.hasValidSession()
        if valid {
            await MainActor.run {
                self.cloudSignedIn = true
                self.showLegacyCanvas = false
                self.employeeWelcomeSeen = true
            }
            WorkspaceEntryPolicy.setCloudSignedIn(true)
        } else {
            await self.logoutToAuth()
        }
    }
}

extension Notification.Name {
    static let openBotCloudAuthSucceeded = Notification.Name("ai.openbot.ios.cloudAuthSucceeded")
    static let openBotEmployeeShellFailed = Notification.Name("ai.openbot.ios.employeeShellFailed")
}
