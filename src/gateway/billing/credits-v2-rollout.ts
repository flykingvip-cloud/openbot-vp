/**
 * Credits v2 灰度发布解析（P4+ rollout）。
 *
 * 租户 entitlement `creditsV2Enabled` 仅为“意愿开关”；全局 rollout 阶段决定是否真正启用 v2。
 */

import type { EntitlementSnapshot } from "../package-entitlement/types.js";
import { canonicalizeTenantId } from "../tenant-canonicalization.js";

export type CreditsV2RolloutStage = "off" | "canary" | "full";

function parseEnterpriseAllowlist(raw: string | undefined): Set<string> {
  if (!raw?.trim()) {
    return new Set();
  }
  return new Set(
    raw
      .split(",")
      .map((part) => canonicalizeTenantId(part.trim()) ?? part.trim())
      .filter(Boolean),
  );
}

export function resolveCreditsV2RolloutStage(
  enterpriseId: string,
  env: NodeJS.ProcessEnv = process.env,
): CreditsV2RolloutStage {
  const mode = (env.OPENBOT_CREDITS_V2_ROLLOUT?.trim() || "off").toLowerCase();
  if (mode === "full") {
    return "full";
  }
  if (mode === "canary") {
    const allowlist = parseEnterpriseAllowlist(env.OPENBOT_CREDITS_V2_CANARY_ENTERPRISES);
    const tenant = canonicalizeTenantId(enterpriseId) ?? enterpriseId;
    return allowlist.has(tenant) ? "canary" : "off";
  }
  return "off";
}

/** 有效 v2 开关 = 租户 feature 开启 ∧ rollout 阶段允许。 */
export function resolveEffectiveCreditsV2Enabled(
  enterpriseId: string,
  features?: EntitlementSnapshot["features"] | null,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  if (features?.creditsV2Enabled !== true) {
    return false;
  }
  const stage = resolveCreditsV2RolloutStage(enterpriseId, env);
  return stage === "full" || stage === "canary";
}
