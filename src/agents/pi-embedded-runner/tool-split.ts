import type { AgentTool } from "@earendil-works/pi-agent-core";
import type { OpenBotConfig } from "../../config/config.js";
import type { DeliveryToolSideEffectSchedule } from "../../gateway/collaboration-dispatch/delivery-tool-side-effect.js";
import type { CollaborationPrivateRunBag } from "../../gateway/collaboration-dispatch/private-run-bag.js";
import {
  toToolDefinitions,
  type ToolDefinitionAdapterOptions,
} from "../pi-tool-definition-adapter.js";
import { applySkillPolicyToAllowlist, type SkillPolicy } from "../skills/skill-policy.js";

// We always pass tools via `customTools` so our policy filtering, sandbox integration,
// and extended toolset remain consistent across providers.
type AnyAgentTool = AgentTool;

export function splitSdkTools(options: {
  tools: AnyAgentTool[];
  sandboxEnabled: boolean;
  deliveryToolSideEffect?: DeliveryToolSideEffectSchedule | null;
  cfg?: OpenBotConfig;
  privateRunBag?: CollaborationPrivateRunBag;
}): {
  builtInTools: AnyAgentTool[];
  customTools: ReturnType<typeof toToolDefinitions>;
} {
  const { tools } = options;
  const adapterOptions: ToolDefinitionAdapterOptions = {
    deliveryToolSideEffect: options.deliveryToolSideEffect,
    cfg: options.cfg,
    privateRunBag: options.privateRunBag,
  };
  return {
    builtInTools: [],
    customTools: toToolDefinitions(tools, adapterOptions),
  };
}

/**
 * pi-coding-agent treats `noTools: "all"` as an empty allowlist and then
 * filters customTools against it. Pass these names as `tools` so exec /
 * web_search / read stay registered for dispatch.
 */
export function resolveEmbeddedCustomToolAllowlist(
  tools: ReadonlyArray<{ name?: string }>,
  policy?: SkillPolicy,
): string[] {
  const names: string[] = [];
  const seen = new Set<string>();
  for (const tool of tools) {
    const name = tool.name?.trim();
    if (!name || seen.has(name)) {
      continue;
    }
    seen.add(name);
    names.push(name);
  }
  return policy ? applySkillPolicyToAllowlist(names, policy) : names;
}

/** Drop tool schemas whose names the group/agent skill policy forbids. */
export function applyEmbeddedCustomToolPolicy<T extends { name?: string }>(
  tools: readonly T[],
  policy?: SkillPolicy,
): { tools: T[]; allowlist: string[] } {
  const allowlist = resolveEmbeddedCustomToolAllowlist(tools, policy);
  const allowed = new Set(allowlist);
  return {
    tools: tools.filter((tool) => {
      const name = tool.name?.trim();
      return Boolean(name && allowed.has(name));
    }),
    allowlist,
  };
}
