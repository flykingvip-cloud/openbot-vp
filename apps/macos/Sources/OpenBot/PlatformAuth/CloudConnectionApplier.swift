import Foundation
import OSLog

/// After a single platform-auth login, point the Mac app at cloud WSS with
/// empty gateway token/password so session cookies authenticate the upgrade.
@MainActor
enum CloudConnectionApplier {
    private static let logger = Logger(subsystem: "ai.openbot", category: "cloud-connection")

    static func applyAfterLogin() async {
        let state = AppStateStore.shared

        // Mark onboarding done so the old multi-step wizard does not stack prompts.
        if !state.onboardingSeen {
            state.onboardingSeen = true
            UserDefaults.standard.set(currentOnboardingVersion, forKey: onboardingVersionKey)
        }

        state.remoteTransport = .direct
        state.remoteUrl = OpenBotCloudDefaults.wsURLString
        // Clear any leftover gateway shared secret so connect uses cookie/session only.
        if !state.remoteToken.isEmpty || state.remoteTokenDirty || state.remoteTokenUnsupported {
            state.remoteToken = ""
        }
        OpenBotConfigFile.clearRemoteGatewaySharedSecrets()
        OpenBotConfigFile.applyCloudDirectRemoteURL(OpenBotCloudDefaults.wsURLString)

        if state.connectionMode != .remote {
            state.connectionMode = .remote
        } else {
            await ConnectionModeCoordinator.shared.apply(mode: .remote, paused: state.isPaused)
        }

        self.logger.info("applied cloud direct remote url=\(OpenBotCloudDefaults.wsURLString, privacy: .public)")
    }

    static func clearCloudConnection() async {
        let state = AppStateStore.shared
        // Leave mode unconfigured so we do not keep probing cloud without a session.
        if state.connectionMode == .remote,
           state.remoteUrl.trimmingCharacters(in: .whitespacesAndNewlines)
           == OpenBotCloudDefaults.wsURLString
        {
            state.connectionMode = .unconfigured
        }
        await ConnectionModeCoordinator.shared.apply(mode: state.connectionMode, paused: state.isPaused)
    }
}
