/**
 * Policy Engine — 路由策略类型（Package V2 Phase 2）。
 *
 * Policy 决定「在已授权模型集合内如何选路」，与套餐权益（Tier）解耦。
 */

import type { SelectionStrategy } from "@openbot/aor-core";

export type RoutingPolicyId = string;

/** 平台路由策略（映射到 AOR SelectionStrategy）。 */
export type RoutingPolicy = {
  id: RoutingPolicyId;
  name: string;
  description: string;
  selectorStrategy: SelectionStrategy;
  status: "active" | "archived";
  /** 内置策略不可删除。 */
  builtin: boolean;
  updatedAt: string;
};
