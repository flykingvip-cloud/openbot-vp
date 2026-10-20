/**
 * Tenant capability query for POST /tools/invoke shadow (PR-P5-2).
 *
 * No existing control-plane table answers (tenantId, toolName). Agent
 * tool-policy, the gateway HTTP allow/deny lists, access-control
 * `capability.execute`, and enterprise data grants each judge a different
 * object. This module is the smallest read-only query, backed by the optional
 * `gateway.tools.tenantCapabilities` slice of the existing gateway tools
 * config. It does not authorize and it does not change HTTP or tool.execute.
 *
 * A missing row, a value other than allow/deny, or a lookup throw is `unset`.
 * Unset is never allow.
 */

export type ToolsInvokeCapabilityEffect = "allow" | "deny" | "unset";

export type ToolsInvokeCapabilityAbsence = "not-configured" | "absent" | "lookup-failed";

/** Config slice `gateway.tools.tenantCapabilities`. Values are not trusted. */
export type ToolsInvokeCapabilityPolicyTable = Readonly<
  Record<string, Readonly<Record<string, unknown>> | null | undefined>
>;

export type ToolsInvokeCapabilityLookup = (query: {
  tenantId: string;
  toolName: string;
}) => unknown;

export type ToolsInvokeCapabilityEvaluation = {
  effect: ToolsInvokeCapabilityEffect;
  /** Present only when effect is unset. */
  absence?: ToolsInvokeCapabilityAbsence;
};

function normalizeId(value: string): string {
  return value.trim();
}

function effectFromCell(cell: unknown): "allow" | "deny" | undefined {
  return cell === "allow" || cell === "deny" ? cell : undefined;
}

/**
 * Last trimmed (tenant, tool) cell wins. A non allow/deny cell is not a verdict.
 */
export function readToolsInvokeCapabilityCell(
  policy: ToolsInvokeCapabilityPolicyTable,
  tenantId: string,
  toolName: string,
): "allow" | "deny" | undefined {
  const tenantKey = normalizeId(tenantId);
  const toolKey = normalizeId(toolName);
  if (!tenantKey || !toolKey) {
    return undefined;
  }
  let matchedTool = false;
  let found: "allow" | "deny" | undefined;
  for (const [rawTenant, tools] of Object.entries(policy)) {
    if (normalizeId(rawTenant) !== tenantKey || !tools || typeof tools !== "object") {
      continue;
    }
    for (const [rawTool, cell] of Object.entries(tools)) {
      if (normalizeId(rawTool) !== toolKey) {
        continue;
      }
      matchedTool = true;
      found = effectFromCell(cell);
    }
  }
  return matchedTool ? found : undefined;
}

/**
 * Pure. When `lookup` is set it is the query; otherwise `policy` is read.
 * No table and no lookup is `not-configured`. A ran query with no allow/deny
 * is `absent`. A throwing lookup is `lookup-failed`. None of those are allow.
 */
export function evaluateToolsInvokeCapability(params: {
  tenantId: string;
  toolName: string;
  policy?: ToolsInvokeCapabilityPolicyTable | null;
  lookup?: ToolsInvokeCapabilityLookup;
}): ToolsInvokeCapabilityEvaluation {
  if (params.lookup) {
    try {
      const effect = effectFromCell(
        params.lookup({ tenantId: params.tenantId, toolName: params.toolName }),
      );
      if (!effect) {
        return { effect: "unset", absence: "absent" };
      }
      return { effect };
    } catch {
      return { effect: "unset", absence: "lookup-failed" };
    }
  }
  if (params.policy == null) {
    return { effect: "unset", absence: "not-configured" };
  }
  const effect = readToolsInvokeCapabilityCell(params.policy, params.tenantId, params.toolName);
  if (!effect) {
    return { effect: "unset", absence: "absent" };
  }
  return { effect };
}
