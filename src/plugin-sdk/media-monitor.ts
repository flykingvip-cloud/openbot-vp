// Narrow plugin-sdk surface for the bundled media-monitor plugin.
// Keep this list additive and scoped to symbols used under extensions/media-monitor.

export type {
  GatewayClient,
  GatewayRequestHandler,
  GatewayRequestHandlerOptions,
} from "../gateway/server-methods/types.js";
export type {
  AnyAgentTool,
  OpenClawPluginApi,
  OpenClawPluginConfigSchema,
  OpenClawPluginService,
  OpenClawPluginServiceContext,
  PluginLogger,
} from "../plugins/types.js";
export { buildSecretInputSchema } from "./secret-input-schema.js";
export { readJsonFileWithFallback, writeJsonFileAtomically } from "./json-store.js";
export { withFileLock } from "./file-lock.js";
export { createPluginRuntimeStore } from "./runtime-store.js";
/** Generic channel delivery (covers extension channels like wecom). */
export { deliverOutboundPayloads } from "../infra/outbound/deliver.js";
