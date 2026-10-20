/**
 * Runtime Intelligence — Phase 3 架构钩子模块（延后实施 / 仅占位）。
 *
 * 本模块为 Tasks 31-34 提供类型化骨架：
 * - Task 31：动态能力编排（基于 RoutingPriority + LoadStrategy）
 * - Task 32：热更新支持（基于 HotReloadable 标记）
 * - Task 33：Canary 发布（基于 BindingType=dynamic-runtime）
 * - Task 34：Agent Mesh 协同（多 Agent 间能力共享和路由）
 *
 * 实施策略：
 * 这四个能力共享一个 Runtime Intelligence 协调器（Coordinator）。当前阶段仅
 * 定义类型契约 + 默认 NO-OP 实现，让后续 Phase 3 落地时可以直接按契约填充
 * 真实算法，无需修改调用方。
 *
 * 目前的 NO-OP 实现：
 * - selectBindingForRequest 直接选择 routingPriority 最高的 active binding；
 *   若无 active 则尝试 fallback。
 * - planHotReload 总是返回 "needs-restart" 直到具体策略落地。
 * - planCanaryRollout 返回单阶段 "ga"。
 * - selectMeshTarget 返回 null（不跨 Agent 路由）。
 */

import type { RuntimeAgent, RuntimeCapabilityBinding, BindingState } from "./types.ts";

// ─────────────────────────────────────────────────────────────────────────
// Task 31：动态能力编排
// ─────────────────────────────────────────────────────────────────────────

/**
 * 一次能力请求的上下文。Phase 3 的智能路由会基于本结构 + 历史 telemetry 选择
 * 最佳 binding。
 */
export type CapabilityRequestContext = {
  runtimeAgentId: string;
  capabilityId: string;
  /** 是否要求 healthy（路由器在 unhealthy / unavailable 上不分发新请求）。 */
  requireHealthy: boolean;
  /** 客户端期望的最大延迟（ms）；为 null 表示不约束。 */
  maxLatencyMs: number | null;
};

/**
 * 选择执行该请求的 binding。当前 NO-OP 仅按 routingPriority 排序选择 active；
 * Phase 3 接入智能算法时替换该函数即可。
 */
export function selectBindingForRequest(
  context: CapabilityRequestContext,
  bindings: readonly RuntimeCapabilityBinding[],
): RuntimeCapabilityBinding | null {
  const candidates = bindings.filter(
    (b) =>
      b.runtimeAgentId === context.runtimeAgentId &&
      b.capabilityId === context.capabilityId &&
      b.bindingState === "active",
  );
  // Phase 3 真实算法应综合 priority + 健康 + telemetry；这里仅按 priority desc。
  candidates.sort((a, b) => b.routingPriority - a.routingPriority);

  for (const c of candidates) {
    if (context.requireHealthy && c.healthStatus !== "healthy") {
      continue;
    }
    if (context.maxLatencyMs !== null && c.invocationMetrics.avgLatencyMs > context.maxLatencyMs) {
      continue;
    }
    return c;
  }
  // 主路径无候选时，尝试沿 fallback 链
  return resolveFallback(candidates[0] ?? null, bindings);
}

function resolveFallback(
  primary: RuntimeCapabilityBinding | null,
  bindings: readonly RuntimeCapabilityBinding[],
): RuntimeCapabilityBinding | null {
  if (!primary?.fallbackBindingId) {
    return null;
  }
  const fb = bindings.find((b) => b.bindingId === primary.fallbackBindingId);
  if (!fb || fb.bindingState !== "active") {
    return null;
  }
  return fb;
}

// ─────────────────────────────────────────────────────────────────────────
// Task 32：热更新支持
// ─────────────────────────────────────────────────────────────────────────

/**
 * 热更新计划。Phase 3 落地时支持：
 * - "hot-reload"     直接热更新（HotReloadable=true 且无活跃会话依赖旧版本）
 * - "graceful"       排空 → 重启（draining 流程）
 * - "needs-restart"  当前实现的默认结果；要求显式 lifecycle 走完整通道
 */
export type HotReloadPlanKind = "hot-reload" | "graceful" | "needs-restart";

export type HotReloadPlan = {
  kind: HotReloadPlanKind;
  /** 当 kind 为 graceful 时给出预计排空时间（毫秒）。 */
  estimatedDrainMs: number | null;
  /** 用户可读的解释（运维语言）。 */
  rationale: string;
};

export function planHotReload(binding: RuntimeCapabilityBinding): HotReloadPlan {
  if (!binding.policy.hotReloadable) {
    return {
      kind: "needs-restart",
      estimatedDrainMs: null,
      rationale: "Binding policy 不允许热更新；需要走完整 lifecycle 重启",
    };
  }
  // Phase 3 NO-OP：保守起见，直到真正能验证版本兼容性前都走 graceful
  return {
    kind: "graceful",
    estimatedDrainMs: 60_000,
    rationale: "Phase 3 智能算法尚未落地；默认 graceful 排空策略",
  };
}

// ─────────────────────────────────────────────────────────────────────────
// Task 33：Canary 发布
// ─────────────────────────────────────────────────────────────────────────

export type CanaryStage = "internal" | "small" | "medium" | "large" | "ga";

export type CanaryRolloutPlan = {
  capabilityId: string;
  fromVersion: string;
  toVersion: string;
  stages: ReadonlyArray<{
    stage: CanaryStage;
    /** 对应阶段的目标 Agent 比例 [0, 1]。 */
    coverageRatio: number;
    /** 等待时长（毫秒），观察期内健康问题触发回滚。 */
    bakeMs: number;
  }>;
};

/**
 * Phase 3 NO-OP：返回单阶段 GA 计划（即不做 canary，直接全量）。
 * 真实落地时依据租户分层 / 风险等级 / 历史成功率生成阶梯。
 */
export function planCanaryRollout(
  capabilityId: string,
  fromVersion: string,
  toVersion: string,
): CanaryRolloutPlan {
  return {
    capabilityId,
    fromVersion,
    toVersion,
    stages: [{ stage: "ga", coverageRatio: 1, bakeMs: 0 }],
  };
}

// ─────────────────────────────────────────────────────────────────────────
// Task 34：Agent Mesh 协同
// ─────────────────────────────────────────────────────────────────────────

export type AgentMeshRoute = {
  fromAgentId: string;
  toAgentId: string;
  capabilityId: string;
  reason: "load-balancing" | "fallback" | "regional-affinity";
};

/**
 * 在多 Agent 集群中为给定能力请求选择最佳 Agent（跨 Agent 路由）。
 *
 * Phase 3 NO-OP：返回 null，表示不跨 Agent 路由 —— 调用方按当前 Agent 处理。
 */
export function selectMeshTarget(
  _context: CapabilityRequestContext,
  _agents: readonly RuntimeAgent[],
): AgentMeshRoute | null {
  return null;
}

// ─────────────────────────────────────────────────────────────────────────
// 共享工具
// ─────────────────────────────────────────────────────────────────────────

/**
 * 判定一组 BindingState 中是否存在"路由可达"状态（active / warming / degraded）。
 * disabled 不视为可达。
 */
export function isRoutable(state: BindingState): boolean {
  return state !== "disabled";
}
