/**
 * Plugin loader public option types.
 *
 * Owns the `PluginLoadOptions` / `PluginLoadResult` type aliases previously
 * inlined in `src/plugins/loader.ts`. Extracted per the
 * `gateway-plugins-monolith-decomposition` spec (Task 3.4). The facade at
 * `src/plugins/loader.ts` re-exports both names verbatim so the
 * Public_Export_Surface is unchanged (Req 2.1, 2.4).
 */

import type { OpenBotConfig } from "../../config/config.js";
import type { GatewayRequestHandler } from "../../gateway/server-methods/types.js";
import type { PluginRegistry } from "../registry.js";
import type { CreatePluginRuntimeOptions } from "../runtime/index.js";
import type { PluginLogger } from "../types.js";

export type PluginLoadResult = PluginRegistry;

export type PluginLoadOptions = {
  config?: OpenBotConfig;
  workspaceDir?: string;
  logger?: PluginLogger;
  coreGatewayHandlers?: Record<string, GatewayRequestHandler>;
  runtimeOptions?: CreatePluginRuntimeOptions;
  cache?: boolean;
  mode?: "full" | "validate";
};
