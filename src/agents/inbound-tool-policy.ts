import {
  listRetrieveReadOnlyCoreToolIds,
  resolveCoreToolCapability,
  resolveCoreToolCatalogId,
} from "./tool-catalog.js";
import { normalizeToolName } from "./tool-policy.js";
import { ToolAuthorizationError, type AnyAgentTool } from "./tools/common.js";

export { listRetrieveReadOnlyCoreToolIds } from "./tool-catalog.js";

export const INBOUND_TOOL_POLICY_VERSION = "inbound-tool-policy-v1";

export type InboundToolCeiling = {
  depth: "chat" | "retrieve" | "act";
  maxToolMode: "none" | "read" | "write";
  maxSideEffectLevel: "none" | "reversible" | "irreversible_external";
};

export type InboundToolExecutionDecision = { allowed: true } | { allowed: false; reason: string };

export function isRetrieveReadOnlyAllowlisted(toolName: string): boolean {
  const catalogId = resolveCoreToolCatalogId(toolName);
  const capability = resolveCoreToolCapability(catalogId);
  return capability?.toolMode === "read" && capability.sideEffectLevel === "none";
}

export function retrieveReadOnlyAllowlistPolicy(): { allow: string[] } {
  return { allow: listRetrieveReadOnlyCoreToolIds() };
}

export function filterToolsForInboundCeiling<T extends { name: string }>(
  tools: T[],
  ceiling?: InboundToolCeiling,
): T[] {
  if (!ceiling) {
    return tools;
  }
  if (ceiling.maxToolMode === "none" || ceiling.depth === "chat") {
    return [];
  }
  if (ceiling.depth !== "retrieve") {
    return tools;
  }
  // Match catalog ids, not policy group names. "read" is a tool id, not a group.
  return tools.filter((tool) => isRetrieveReadOnlyAllowlisted(tool.name));
}

export function evaluateInboundToolExecution(params: {
  toolName: string;
  ceiling?: InboundToolCeiling;
  isStillAllowed?: (toolName: string) => boolean;
}): InboundToolExecutionDecision {
  const name = normalizeToolName(params.toolName);
  if (!params.ceiling) {
    return { allowed: true };
  }
  if (params.ceiling.maxToolMode === "none" || params.ceiling.depth === "chat") {
    return { allowed: false, reason: "inbound_depth_chat_tools_disabled" };
  }
  if (params.ceiling.depth === "act") {
    if (params.isStillAllowed && !params.isStillAllowed(name)) {
      return { allowed: false, reason: "acl_disallowed" };
    }
    return { allowed: true };
  }

  const catalogId = resolveCoreToolCatalogId(name);
  const capability = resolveCoreToolCapability(catalogId);
  if (!capability) {
    return { allowed: false, reason: "unknown_side_effect" };
  }
  if (params.ceiling.maxToolMode === "read" && capability.toolMode !== "read") {
    return { allowed: false, reason: "write_tool_denied" };
  }
  if (params.ceiling.maxSideEffectLevel === "none" && capability.sideEffectLevel !== "none") {
    return { allowed: false, reason: "side_effect_denied" };
  }
  if (!listRetrieveReadOnlyCoreToolIds().includes(catalogId)) {
    return { allowed: false, reason: "not_in_readonly_allowlist" };
  }
  if (params.isStillAllowed && !params.isStillAllowed(name)) {
    return { allowed: false, reason: "acl_disallowed" };
  }
  return { allowed: true };
}

export function filterClientToolDefinitionsForInboundCeiling<
  T extends { function: { name: string } },
>(tools: T[] | undefined, ceiling?: InboundToolCeiling): T[] | undefined {
  if (!tools) {
    return tools;
  }
  return filterToolsForInboundCeiling(
    tools.map((tool) => ({ tool, name: tool.function.name })),
    ceiling,
  ).map(({ tool }) => tool);
}

export function wrapInboundToolExecutionGuard(
  tool: AnyAgentTool,
  params: {
    ceiling?: InboundToolCeiling;
    isStillAllowed?: (toolName: string) => boolean;
  },
): AnyAgentTool {
  if (!params.ceiling || !tool.execute) {
    return tool;
  }
  const execute = tool.execute.bind(tool);
  return {
    ...tool,
    execute: async (toolCallId, toolParams, signal, onUpdate) => {
      const decision = evaluateInboundToolExecution({
        toolName: tool.name,
        ceiling: params.ceiling,
        isStillAllowed: params.isStillAllowed,
      });
      if (!decision.allowed) {
        throw new ToolAuthorizationError(`Tool execution denied (${decision.reason}).`);
      }
      return execute(toolCallId, toolParams, signal, onUpdate);
    },
  };
}

export function applyInboundToolCeiling(params: {
  tools: AnyAgentTool[];
  ceiling?: InboundToolCeiling;
  isStillAllowed?: (toolName: string) => boolean;
}): AnyAgentTool[] {
  const wrapped = params.tools.map((tool) =>
    wrapInboundToolExecutionGuard(tool, {
      ceiling: params.ceiling,
      isStillAllowed: params.isStillAllowed,
    }),
  );
  return filterToolsForInboundCeiling(wrapped, params.ceiling);
}
