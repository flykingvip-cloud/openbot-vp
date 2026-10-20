import Foundation

// Stable identifiers used for the macOS LaunchAgent label, Gateway daemon label, and the
// Nix-managed defaults suite. Keep legacy labels readable during migration.
let launchdLabel = "ai.openbot.mac"
let legacyLaunchdLabels = ["ai.openbot.mac"]
let allLaunchdLabels = [launchdLabel] + legacyLaunchdLabels
let gatewayLaunchdLabel = "ai.openbot.gateway"
let legacyGatewayLaunchdLabels = ["ai.openbot.gateway"]
let allGatewayLaunchdLabels = [gatewayLaunchdLabel] + legacyGatewayLaunchdLabels
let onboardingVersionKey = "openbot.onboardingVersion"
let onboardingSeenKey = "openbot.onboardingSeen"
let currentOnboardingVersion = 7
let pauseDefaultsKey = "openbot.pauseEnabled"
let iconAnimationsEnabledKey = "openbot.iconAnimationsEnabled"
let swabbleEnabledKey = "openbot.swabbleEnabled"
let swabbleTriggersKey = "openbot.swabbleTriggers"
let voiceWakeTriggerChimeKey = "openbot.voiceWakeTriggerChime"
let voiceWakeSendChimeKey = "openbot.voiceWakeSendChime"
let showDockIconKey = "openbot.showDockIcon"
let defaultVoiceWakeTriggers = ["openbot"]
let voiceWakeMaxWords = 32
let voiceWakeMaxWordLength = 64
let voiceWakeMicKey = "openbot.voiceWakeMicID"
let voiceWakeMicNameKey = "openbot.voiceWakeMicName"
let voiceWakeLocaleKey = "openbot.voiceWakeLocaleID"
let voiceWakeAdditionalLocalesKey = "openbot.voiceWakeAdditionalLocaleIDs"
let voicePushToTalkEnabledKey = "openbot.voicePushToTalkEnabled"
let talkEnabledKey = "openbot.talkEnabled"
let iconOverrideKey = "openbot.iconOverride"
let connectionModeKey = "openbot.connectionMode"
let remoteTargetKey = "openbot.remoteTarget"
let remoteIdentityKey = "openbot.remoteIdentity"
let remoteProjectRootKey = "openbot.remoteProjectRoot"
let remoteCliPathKey = "openbot.remoteCliPath"
let canvasEnabledKey = "openbot.canvasEnabled"
let cameraEnabledKey = "openbot.cameraEnabled"
let systemRunPolicyKey = "openbot.systemRunPolicy"
let systemRunAllowlistKey = "openbot.systemRunAllowlist"
let systemRunEnabledKey = "openbot.systemRunEnabled"
let locationModeKey = "openbot.locationMode"
let locationPreciseKey = "openbot.locationPreciseEnabled"
let peekabooBridgeEnabledKey = "openbot.peekabooBridgeEnabled"
let deepLinkKeyKey = "openbot.deepLinkKey"
let modelCatalogPathKey = "openbot.modelCatalogPath"
let modelCatalogReloadKey = "openbot.modelCatalogReload"
let cliInstallPromptedVersionKey = "openbot.cliInstallPromptedVersion"
let heartbeatsEnabledKey = "openbot.heartbeatsEnabled"
let debugPaneEnabledKey = "openbot.debugPaneEnabled"
let debugFileLogEnabledKey = "openbot.debug.fileLogEnabled"
let appLogLevelKey = "openbot.debug.appLogLevel"
let supervisorNodeBindTenantIdKey = "openbot.supervisorNodeBindTenantId"
let supervisorNodeBindSeatIdKey = "openbot.supervisorNodeBindSeatId"
let voiceWakeSupported: Bool = ProcessInfo.processInfo.operatingSystemVersion.majorVersion >= 26
