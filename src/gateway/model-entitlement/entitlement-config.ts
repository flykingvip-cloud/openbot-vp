/**
 * 模型 Entitlement 强制开关（P1，任务 6）。
 *
 * 设计：`.kiro/specs/model-entitlement-chain/design.md`（§6.1 / §8）。
 *
 * `gateway.platform.models.entitlement.enforce`：
 * - `off`：完全不强制（gate 跳过，回到现状）。
 * - `missing-allow`（默认）：未配置 entitlement（state=missing）放行；已解析（state=resolved）强制，空集 hard deny。
 * - `strict`：未配置也视为无授权（hard deny）。
 *
 * 防御式读取，不修改 zod schema，向后兼容。
 */

import type { OpenBotConfig } from "../../config/types.js";
import type { EffectiveModelSetResult } from "./types.js";

export type ModelEntitlementEnforceMode = "off" | "missing-allow" | "strict";

export type ModelEntitlementRoutingMode = "legacy" | "tier";

export function resolveModelEntitlementEnforce(
  cfg: OpenBotConfig | undefined,
): ModelEntitlementEnforceMode {
  // 类型化读取（gateway.platform.models.entitlement.enforce，见 types.gateway.ts）。
  const mode = cfg?.gateway?.platform?.models?.entitlement?.enforce;
  if (mode === "off" || mode === "strict" || mode === "missing-allow") {
    return mode;
  }
  return "missing-allow";
}

/**
 * 运行时强制覆盖范围（P5，design §6.5）。
 * - `employee-chat`（默认）：仅 employee webchat 1:1 主回合（P1 行为）。
 * - `all-bot-runs`：扩展到 followup / 协作小组 / cron / 外部渠道（按 bot 归属席位）。
 */
export type ModelEntitlementScope = "employee-chat" | "all-bot-runs";

export function resolveModelEntitlementScope(
  cfg: OpenBotConfig | undefined,
): ModelEntitlementScope {
  const scope = cfg?.gateway?.platform?.models?.entitlement?.scope;
  return scope === "all-bot-runs" ? "all-bot-runs" : "employee-chat";
}

/**
 * 套餐权益解析：legacy 用 modelId 列表；tier 用 allowedTiers 投影。
 *
 * Phase 3（后端结构收敛）：默认收敛为 `tier`，即「Tier 是配置真源」。
 * - tier-backed 绑定（有 allowedTiers）→ 运行时按 Tier 投影模型池（allowedModelIds 仅作派生缓存）。
 * - 纯 legacy 绑定（无 allowedTiers）→ resolveBindingAllowlist 回退到 allowedModelIds（行为不变）。
 * - 仅当显式配置 `routingMode: "legacy"` 时，才强制全局走 allowedModelIds（逃生通道）。
 */
export function resolveModelEntitlementRoutingMode(
  cfg: OpenBotConfig | undefined,
): ModelEntitlementRoutingMode {
  const mode = cfg?.gateway?.platform?.models?.entitlement?.routingMode;
  return mode === "legacy" ? "legacy" : "tier";
}

/**
 * 根据 enforce 模式与解析结果，决定传给 runWithModelFallback 的 `entitlementAllowlist`：
 * - 返回 `undefined` → 不强制（放行）。
 * - 返回 `string[]`（可能空）→ 强制；空数组会触发 hard deny（零出网）。
 */
export function resolveEntitlementAllowlistForRun(
  enforce: ModelEntitlementEnforceMode,
  result: EffectiveModelSetResult,
): string[] | undefined {
  if (enforce === "off") {
    return undefined;
  }
  if (result.state === "missing") {
    // 未配置：missing-allow 放行；strict 视为无授权（空 → hard deny）。
    return enforce === "strict" ? [] : undefined;
  }
  // resolved：始终强制（空集 → hard deny）。
  return result.allowedModelIds;
}
