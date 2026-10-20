import Foundation
import OSLog

/// After platform-auth login, point the iOS app at cloud WSS with empty gateway
/// token/password so session cookies authenticate the upgrade (system TLS).
///
/// Note: this does **not** control post-login UI. RootView switches to
/// `EmployeeWorkspaceView` based on auth state (same as Mac).
@MainActor
enum CloudConnectionApplier {
    private static let logger = Logger(subsystem: "ai.openbot.ios", category: "cloud-connection")

    static func applyAfterLogin(gatewayController: GatewayConnectionController) async {
        await gatewayController.connectCloud()
        OnboardingStateStore.markCompleted(mode: .cloud)
        WorkspaceEntryPolicy.setPreferEmployeeShell(true)
        WorkspaceEntryPolicy.setCloudSignedIn(true)
        Self.logger.info("applied cloud direct remote url=\(OpenBotCloudDefaults.wsURLString, privacy: .public)")
    }
}
