/**
 * Plugin loader facade.
 *
 * Re-exports the public surface documented in
 * `.kiro/specs/gateway-plugins-monolith-decomposition/baseline/loader.md`.
 * Implementation lives under `src/plugins/loader/*`.
 */

export { loadOpenBotPlugins, loadOpenClawPlugins } from "./loader/load-orchestration.js";
export type { PluginLoadOptions, PluginLoadResult } from "./loader/plugin-load-options.js";
export { __testing } from "./loader/runtime-resolve.js";
