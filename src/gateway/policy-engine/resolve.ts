/**
 * Policy Engine 纯函数解析（framework-free）。
 */

import type { SelectionStrategy } from "@openbot/aor-core";
import type { RoutingPolicy } from "./types.js";

export type ResolvePolicyInput = {
  policyId?: string | null;
  allowedPolicies?: readonly string[] | null;
  /** 套餐 binding 内联策略（legacy 回退）。 */
  legacySelectorStrategy?: SelectionStrategy | null;
  policies: readonly RoutingPolicy[];
};

export type ResolvedRoutingPolicy = {
  policyId: string;
  selectorStrategy: SelectionStrategy;
  source: "policyId" | "allowedPolicies" | "legacy" | "default";
};

/**
 * 解析本次任务应使用的路由策略。
 * 优先级：policyId → allowedPolicies[0] → legacy aorExecution → balanced。
 */
export function resolveRoutingPolicy(input: ResolvePolicyInput): ResolvedRoutingPolicy {
  const byId = new Map(input.policies.map((p) => [p.id, p]));
  const pick = (id: string | undefined | null): ResolvedRoutingPolicy | null => {
    const key = id?.trim();
    if (!key) {
      return null;
    }
    const policy = byId.get(key);
    if (!policy || policy.status !== "active") {
      return null;
    }
    return {
      policyId: policy.id,
      selectorStrategy: policy.selectorStrategy,
      source: "policyId",
    };
  };

  const fromExplicit = pick(input.policyId);
  if (fromExplicit) {
    return fromExplicit;
  }

  const firstAllowed = input.allowedPolicies?.map((p) => p.trim()).find((p) => p.length > 0);
  const fromAllowed = pick(firstAllowed);
  if (fromAllowed) {
    return { ...fromAllowed, source: "allowedPolicies" };
  }

  if (input.legacySelectorStrategy) {
    return {
      policyId: `legacy:${input.legacySelectorStrategy}`,
      selectorStrategy: input.legacySelectorStrategy,
      source: "legacy",
    };
  }

  const balanced = byId.get("balanced");
  return {
    policyId: balanced?.id ?? "balanced",
    selectorStrategy: balanced?.selectorStrategy ?? "balanced",
    source: "default",
  };
}
