/**
 * Agent Growth OS — 运营指标累加器（spec: agent-growth-lifecycle, P2 任务 12.x 信号 SOURCE）。
 *
 * 每个机器人维护滚动计数（任务/工具成功数、人工接管数），持久化于 agent 目录。
 * runner 在任务/工具收尾时只做轻量 record；`recompute-growth` 读取本累加器算出
 * `OperationalScoreSignals` → operationalScore → 虚假就绪检测（事件在 RPC 层广播）。
 *
 * 无数据时 computeOperationalSignals 返回 undefined → operationalScore 保持 null（不伪造）。
 */

import path from "node:path";
import { resolveAgentDir } from "../../agents/agent-scope.js";
import type { OpenBotConfig } from "../../config/config.js";
import { createAsyncLock, readJsonFile, writeJsonAtomic } from "../../infra/json-files.js";
import { appendEvolutionTaskOutcome } from "./evolution-task-outcomes.js";
import type { OperationalScoreSignals } from "./operational-score.js";

export type TaskOutcomeObservation = {
  success: boolean;
  humanTakeover?: boolean;
  tenantId?: string;
  experimentId?: string;
  applicationId?: string;
  cohortRef?: string;
  runId?: string;
  toolsObserved?: number;
  latencyMs?: number;
  securityViolation?: boolean;
  crossTenantContamination?: boolean;
  occurredAt?: number;
  /** Test-only evolution-control persist root. Production omits this. */
  evolutionPersistDir?: string;
};

export const OPERATIONAL_METRICS_FILENAME = "operational-metrics.json";

export type OperationalMetrics = {
  tasksTotal: number;
  tasksSucceeded: number;
  toolsTotal: number;
  toolsSucceeded: number;
  humanTakeovers: number;
  /**
   * 人工接管的**分母**：真正观察过"是否发生接管"的次数。
   *
   * 必须与 `humanTakeovers` 成对存在。旧实现用 `tasksTotal` 当分母，而任务收尾时
   * 没有任何接管观测源，导致接管率恒 0 并被打分器按 `1 - rate` 当成满分计入
   * （operationalScore 系统性虚高）。没有观测源时该计数为 0 → 不产出该信号。
   */
  takeoverObservations: number;
  /** 满意度观测：明确正向反馈次数。 */
  satisfactionPositive: number;
  /** 满意度观测：明确负向反馈次数。 */
  satisfactionNegative: number;
  /** 显式满意度评分次数（正向 + 负向）。 */
  satisfactionRated?: number;
  updatedAtMs: number;
};

function emptyMetrics(): OperationalMetrics {
  return {
    tasksTotal: 0,
    tasksSucceeded: 0,
    toolsTotal: 0,
    toolsSucceeded: 0,
    humanTakeovers: 0,
    takeoverObservations: 0,
    satisfactionPositive: 0,
    satisfactionNegative: 0,
    satisfactionRated: 0,
    updatedAtMs: 0,
  };
}

/** 兼容旧盘上文件（缺少新字段时补 0），避免 NaN 传播到评分。 */
function normalizeMetrics(value: OperationalMetrics | null): OperationalMetrics {
  const base = emptyMetrics();
  if (!value) {
    return base;
  }
  const pick = (candidate: unknown): number =>
    typeof candidate === "number" && Number.isFinite(candidate) && candidate >= 0
      ? Math.floor(candidate)
      : 0;
  return {
    tasksTotal: pick(value.tasksTotal),
    tasksSucceeded: pick(value.tasksSucceeded),
    toolsTotal: pick(value.toolsTotal),
    toolsSucceeded: pick(value.toolsSucceeded),
    humanTakeovers: pick(value.humanTakeovers),
    takeoverObservations: pick(value.takeoverObservations),
    satisfactionPositive: pick(value.satisfactionPositive),
    satisfactionNegative: pick(value.satisfactionNegative),
    satisfactionRated:
      pick(value.satisfactionRated) ||
      pick(value.satisfactionPositive) + pick(value.satisfactionNegative),
    updatedAtMs: pick(value.updatedAtMs),
  };
}

function resolvePath(cfg: OpenBotConfig, agentId: string): string {
  return path.join(resolveAgentDir(cfg, agentId), OPERATIONAL_METRICS_FILENAME);
}

const lock = createAsyncLock();

async function update(
  cfg: OpenBotConfig,
  agentId: string,
  mutate: (m: OperationalMetrics) => void,
): Promise<void> {
  await lock(async () => {
    const current = normalizeMetrics(
      await readJsonFile<OperationalMetrics>(resolvePath(cfg, agentId)),
    );
    mutate(current);
    current.updatedAtMs = Date.now();
    await writeJsonAtomic(resolvePath(cfg, agentId), current);
  });
}

function evolutionRecordFromObservation(
  agentId: string,
  outcome: TaskOutcomeObservation,
): Parameters<typeof appendEvolutionTaskOutcome>[1] {
  return {
    agentId,
    occurredAt: outcome.occurredAt ?? Date.now(),
    succeeded: outcome.success,
    ...(outcome.runId ? { runId: outcome.runId } : {}),
    ...(typeof outcome.toolsObserved === "number" && Number.isFinite(outcome.toolsObserved)
      ? { toolsObserved: Math.max(0, outcome.toolsObserved) }
      : {}),
    ...(outcome.tenantId ? { tenantId: outcome.tenantId } : {}),
    ...(outcome.experimentId ? { experimentId: outcome.experimentId } : {}),
    ...(outcome.applicationId ? { applicationId: outcome.applicationId } : {}),
    ...(outcome.cohortRef ? { cohortRef: outcome.cohortRef } : {}),
    ...(typeof outcome.latencyMs === "number" ? { latencyMs: outcome.latencyMs } : {}),
    ...(typeof outcome.securityViolation === "boolean"
      ? { securityViolation: outcome.securityViolation }
      : {}),
    ...(typeof outcome.crossTenantContamination === "boolean"
      ? { crossTenantContamination: outcome.crossTenantContamination }
      : {}),
    ...(typeof outcome.humanTakeover === "boolean" ? { humanTakeover: outcome.humanTakeover } : {}),
  };
}

/**
 * 记录一次任务结果（success/failure）。
 *
 * `humanTakeover` 只在**调用方真的观察过**接管与否时才传（传 `undefined` = 无观测）。
 * 传了才会同时累加 `takeoverObservations`，保证接管率有真实分母。
 */
export async function recordTaskOutcome(
  cfg: OpenBotConfig,
  agentId: string,
  outcome: TaskOutcomeObservation,
): Promise<void> {
  await update(cfg, agentId, (m) => {
    m.tasksTotal += 1;
    if (outcome.success) {
      m.tasksSucceeded += 1;
    }
    if (outcome.humanTakeover !== undefined) {
      m.takeoverObservations += 1;
      if (outcome.humanTakeover) {
        m.humanTakeovers += 1;
      }
    }
  });
  appendEvolutionTaskOutcome(
    cfg,
    evolutionRecordFromObservation(agentId, outcome),
    outcome.evolutionPersistDir ? { persistDir: outcome.evolutionPersistDir } : undefined,
  );
}

/** 记录一次工具调用结果。 */
export async function recordToolOutcome(
  cfg: OpenBotConfig,
  agentId: string,
  outcome: { success: boolean },
): Promise<void> {
  await recordToolOutcomes(cfg, agentId, {
    total: 1,
    succeeded: outcome.success ? 1 : 0,
  });
}

/**
 * 批量记录工具调用结果（一次 run 汇总落盘）。
 *
 * runner 每个 turn 可能有几十次工具调用，逐次写盘会放大 I/O；调用方在内存里累加，
 * turn 收尾时调用本函数一次。
 */
export async function recordToolOutcomes(
  cfg: OpenBotConfig,
  agentId: string,
  outcome: { total: number; succeeded: number },
): Promise<void> {
  const total = Math.max(0, Math.floor(outcome.total));
  if (total === 0) {
    return;
  }
  const succeeded = Math.min(total, Math.max(0, Math.floor(outcome.succeeded)));
  await update(cfg, agentId, (m) => {
    m.toolsTotal += total;
    m.toolsSucceeded += succeeded;
  });
}

/** Persist one completed turn and its tool summary in a single locked update. */
export async function recordRunOutcome(
  cfg: OpenBotConfig,
  agentId: string,
  outcome: TaskOutcomeObservation & { toolsTotal?: number; toolsSucceeded?: number },
): Promise<void> {
  const toolsTotal = Math.max(0, Math.floor(outcome.toolsTotal ?? 0));
  const toolsSucceeded = Math.min(toolsTotal, Math.max(0, Math.floor(outcome.toolsSucceeded ?? 0)));
  await update(cfg, agentId, (m) => {
    m.tasksTotal += 1;
    if (outcome.success) {
      m.tasksSucceeded += 1;
    }
    m.toolsTotal += toolsTotal;
    m.toolsSucceeded += toolsSucceeded;
  });
  appendEvolutionTaskOutcome(
    cfg,
    evolutionRecordFromObservation(agentId, {
      ...outcome,
      toolsObserved: toolsTotal,
    }),
    outcome.evolutionPersistDir ? { persistDir: outcome.evolutionPersistDir } : undefined,
  );
}

/**
 * 记录一次入站反馈观测（人工接管 / 满意度）。
 *
 * 这是 `humanTakeoverRate` 与 `satisfaction` 的唯一真实信号源。
 */
export async function recordFeedbackObservation(
  cfg: OpenBotConfig,
  agentId: string,
  observation: { humanTakeover?: boolean; sentiment?: "positive" | "negative" },
): Promise<void> {
  if (observation.humanTakeover === undefined && observation.sentiment === undefined) {
    return;
  }
  await update(cfg, agentId, (m) => {
    if (observation.humanTakeover !== undefined) {
      m.takeoverObservations += 1;
      if (observation.humanTakeover) {
        m.humanTakeovers += 1;
      }
    }
    if (observation.sentiment === "positive") {
      m.satisfactionPositive += 1;
      m.satisfactionRated = (m.satisfactionRated ?? 0) + 1;
    }
    if (observation.sentiment === "negative") {
      m.satisfactionNegative += 1;
      m.satisfactionRated = (m.satisfactionRated ?? 0) + 1;
    }
  });
}

/**
 * 记录一次显式满意度结果。
 *
 * 与 `recordFeedbackObservation` 共用同一组满意度计数器，供协作生命周期（任务/交付物
 * 状态迁移、评审结论、memory flush 完成）这类**非入站消息**来源使用，避免两套口径。
 */
export async function recordSatisfactionOutcome(
  cfg: OpenBotConfig,
  agentId: string,
  outcome: { positive: boolean },
): Promise<void> {
  await recordFeedbackObservation(cfg, agentId, {
    sentiment: outcome.positive ? "positive" : "negative",
  });
}

/**
 * 把协作对象的终态映射为满意度极性；无法判定的中间态返回 `null`（不产生观测）。
 *
 * 只认真正表达「结果好/不好」的终态：完成/批准/发布=正向，取消/退回=负向。
 */
export function satisfactionPolarityFromStatus(status: string | null | undefined): boolean | null {
  switch (status?.trim()) {
    case "completed":
    case "approved":
    case "published":
    case "resolved":
      return true;
    case "cancelled":
    case "rejected":
      return false;
    default:
      return null;
  }
}

/** 读取原始累加器（不存在返回空）。 */
export async function readOperationalMetrics(
  cfg: OpenBotConfig,
  agentId: string,
): Promise<OperationalMetrics> {
  return normalizeMetrics(await readJsonFile<OperationalMetrics>(resolvePath(cfg, agentId)));
}

/**
 * 由累加器派生 OperationalScoreSignals（纯比率）。
 * 仅在有相应分母时给出该项；全无数据 → undefined（保持 operationalScore=null 契约）。
 */
export function deriveOperationalSignals(
  metrics: OperationalMetrics,
): OperationalScoreSignals | undefined {
  const signals: OperationalScoreSignals = {};
  let hasAny = false;
  if (metrics.tasksTotal > 0) {
    signals.taskSuccessRate = metrics.tasksSucceeded / metrics.tasksTotal;
    hasAny = true;
  }
  if (metrics.toolsTotal > 0) {
    signals.toolSuccessRate = metrics.toolsSucceeded / metrics.toolsTotal;
    hasAny = true;
  }
  // 接管率必须用自己的观测分母。无观测 → 不产出该项（而不是给 0，否则等于送满分）。
  if (metrics.takeoverObservations > 0) {
    signals.humanTakeoverRate = metrics.humanTakeovers / metrics.takeoverObservations;
    hasAny = true;
  }
  const satisfactionTotal = metrics.satisfactionPositive + metrics.satisfactionNegative;
  if (satisfactionTotal > 0) {
    signals.satisfaction = metrics.satisfactionPositive / satisfactionTotal;
    hasAny = true;
  }
  return hasAny ? signals : undefined;
}

/** 便捷：读取并派生信号。 */
export async function computeOperationalSignals(
  cfg: OpenBotConfig,
  agentId: string,
): Promise<OperationalScoreSignals | undefined> {
  return deriveOperationalSignals(await readOperationalMetrics(cfg, agentId));
}
