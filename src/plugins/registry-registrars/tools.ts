// Tool registrar — handles `api.registerTool(...)` calls from plugins.
// Pulled out of the monolithic registry.ts so each registration path can
// be inspected and tested in isolation.

import type { AnyAgentTool } from "../../agents/tools/common.js";
import type { PluginRecord, RegistrarContext } from "../registry-types.js";
import type { OpenClawPluginToolContext, OpenClawPluginToolFactory } from "../types.js";

export type RegisterToolOptions = {
  name?: string;
  names?: string[];
  optional?: boolean;
};

export function registerTool(
  ctx: RegistrarContext,
  record: PluginRecord,
  tool: AnyAgentTool | OpenClawPluginToolFactory,
  opts?: RegisterToolOptions,
): void {
  const names = opts?.names ?? (opts?.name ? [opts.name] : []);
  const optional = opts?.optional === true;
  const factory: OpenClawPluginToolFactory =
    typeof tool === "function" ? tool : (_ctx: OpenClawPluginToolContext) => tool;

  if (typeof tool !== "function") {
    names.push(tool.name);
  }

  const normalized = names.map((name) => name.trim()).filter(Boolean);
  if (normalized.length > 0) {
    record.toolNames.push(...normalized);
  }
  ctx.registry.tools.push({
    pluginId: record.id,
    factory,
    names: normalized,
    optional,
    source: record.source,
  });
}
