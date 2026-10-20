// Narrow plugin-sdk surface for the bundled WeCom plugin.
// Keep this list additive and scoped to symbols used under extensions/wecom.

export type { ChannelDock } from "../channels/dock.js";
export { logInboundDrop } from "../channels/logging.js";
export { createAccountListHelpers } from "../channels/plugins/account-helpers.js";
export {
  buildCatchallMultiAccountChannelSchema,
  buildChannelConfigSchema,
  buildNestedDmConfigSchema,
} from "../channels/plugins/config-schema.js";
export { listDirectoryUserEntriesFromAllowFrom } from "../channels/plugins/directory-config-helpers.js";
export type { ChannelPlugin } from "../channels/plugins/types.plugin.js";
export type { ChannelOnboardingAdapter } from "../channels/plugins/onboarding-types.js";
export type { OpenBotConfig } from "../config/types.openbot.js";
export { missingTargetError } from "../infra/outbound/target-errors.js";
export { issuePairingChallenge } from "../pairing/pairing-challenge.js";
export { emptyPluginConfigSchema } from "../plugins/config-schema.js";
export type { PluginRuntime } from "../plugins/runtime/types.js";
export type { OpenClawPluginApi } from "../plugins/types.js";
export { DEFAULT_ACCOUNT_ID, normalizeAccountId } from "../routing/session-key.js";
export {
  readStoreAllowFromForDmPolicy,
  resolveDmGroupAccessWithCommandGate,
} from "../security/dm-policy-shared.js";
export { formatNormalizedAllowFromEntries } from "./allow-from.js";
export { createAccountStatusSink, runPassiveAccountLifecycle } from "./channel-lifecycle.js";
export {
  createScopedAccountConfigAccessors,
  createScopedChannelConfigBase,
  createScopedDmSecurityResolver,
} from "./channel-config-helpers.js";
export { resolveInboundRouteEnvelopeBuilderWithRuntime } from "./inbound-envelope.js";
export { createScopedPairingAccess } from "./pairing-access.js";
export { formatTextWithAttachmentLinks, resolveOutboundMediaUrls } from "./reply-payload.js";
export { createPluginRuntimeStore } from "./runtime-store.js";
export { buildComputedAccountStatusSnapshot } from "./status-helpers.js";
export { resolveWebhookPath } from "./webhook-path.js";
export { createWebhookInFlightLimiter, readWebhookBodyOrReject } from "./webhook-request-guards.js";
export type { RegisterWebhookPluginRouteOptions } from "./webhook-targets.js";
export {
  registerWebhookTargetWithPluginRoute,
  resolveWebhookTargetWithAuthOrRejectSync,
  withResolvedWebhookRequestPipeline,
} from "./webhook-targets.js";
