/**
 * Agent Growth OS — P3 机巢只读成长聚合（企业统计口径）。
 *
 * 跨机器人汇总 activationScore / operationalScore / lifecycle，不含 Identity/Prompt 编辑能力。
 * Spec: docs/design/agent-onboarding-growth-p0-tech-plan-2026-08-04.md (P3)
 */

import type { OpenBotConfig } from "../../config/config.js";
import type { GatewayClient } from "../server-methods/types.js";
import {
  readRobotGrowthStatusForMeshAggregate,
  readRobotWorkingStyleForMeshAggregate,
  readWorkingStyleChangeForMeshAggregate,
} from "./mesh-growth-tenant-scope.js";
import { detectFalseReady } from "./operational-score.js";
import type { GrowthStatus, LifecycleState } from "./types.js";
import {
  aggregateWorkingStyleEffectiveness,
  type WorkingStyleEffectivenessAggregate,
  type WorkingStyleEffectivenessInput,
} from "./working-style-effectiveness.js";
import type { WorkingStyleChangeRecord } from "./working-style-store.js";

const MS_PER_DAY = 86_400_000;

export type MeshGrowthRankingEntry = {
  agentId: string;
  name: string;
  lifecycleState: LifecycleState;
  activationScore: number;
  operationalScore: number | null;
  growthVelocity: number;
  falseReady: boolean;
  rank: number;
};

export type MeshGrowthAggregateSummary = {
  botCount: number;
  trackedCount: number;
  withOperationalScore: number;
  falseReadyCount: number;
  activatedCount: number;
  missionReadyCount: number;
  avgActivationScore: number | null;
  avgOperationalScore: number | null;
  avgGrowthVelocity: number | null;
};

export type MeshGrowthWorkingStyleStats = {
  botsWithProfile: number;
  botsWithRecentChange: number;
  effectiveness: WorkingStyleEffectivenessAggregate;
};

export type MeshGrowthAggregateResult = {
  generatedAt: string;
  summary: MeshGrowthAggregateSummary;
  lifecycleDistribution: Record<LifecycleState, number>;
  workingStyle: MeshGrowthWorkingStyleStats;
  ranking: MeshGrowthRankingEntry[];
  filters?: {
    positionId: string | null;
  };
};

/** Fail-closed empty aggregate when tenant context is missing. */
export function buildEmptyMeshGrowthAggregate(nowMs = Date.now()): MeshGrowthAggregateResult {
  return buildMeshGrowthAggregateFromStatuses(
    [],
    new Map(),
    nowMs,
    buildMeshGrowthWorkingStyleStats(new Map(), new Map()),
  );
}

export type MeshGrowthAgentInput = {
  agentId: string;
  name: string;
};

/** 成长速度：综合分 / 自创建以来的天数（企业排行口径，只读）。 */
export function computeGrowthVelocity(status: GrowthStatus, nowMs = Date.now()): number {
  const created = status.milestones?.createdAtMs ?? status.birthAtMs;
  const days = Math.max(1, (nowMs - created) / MS_PER_DAY);
  const combined = status.activationScore + (status.operationalScore ?? 0);
  return Math.round((combined / days) * 10) / 10;
}

function emptyLifecycleDistribution(): Record<LifecycleState, number> {
  return {
    birth: 0,
    growing: 0,
    mission_ready: 0,
    activated: 0,
    evolution: 0,
  };
}

function average(values: number[]): number | null {
  if (values.length === 0) {
    return null;
  }
  return Math.round((values.reduce((sum, value) => sum + value, 0) / values.length) * 10) / 10;
}

/** 纯函数：汇总 Working DNA 企业观测指标（只读，不含编辑能力）。 */
export function buildMeshGrowthWorkingStyleStats(
  changes: Map<string, WorkingStyleChangeRecord | null>,
  profiles: Map<string, boolean>,
): MeshGrowthWorkingStyleStats {
  let botsWithProfile = 0;
  let botsWithRecentChange = 0;
  const effectivenessInputs: WorkingStyleEffectivenessInput[] = [];

  for (const [agentId, hasProfile] of profiles) {
    if (hasProfile) {
      botsWithProfile += 1;
    }
    const change = changes.get(agentId) ?? null;
    if (!change) {
      continue;
    }
    botsWithRecentChange += 1;
    effectivenessInputs.push({
      agentId,
      appliedDelta: change.appliedDelta,
      status: change.effectStatus ?? null,
      deltaScore: change.deltaScore ?? null,
      rolledBack: change.rolledBack ?? false,
    });
  }

  return {
    botsWithProfile,
    botsWithRecentChange,
    effectiveness: aggregateWorkingStyleEffectiveness(effectivenessInputs),
  };
}

/** 纯函数：由已读取的成长状态构建企业聚合视图。 */
export function buildMeshGrowthAggregateFromStatuses(
  agents: MeshGrowthAgentInput[],
  statuses: Map<string, GrowthStatus | null>,
  nowMs = Date.now(),
  workingStyle?: MeshGrowthWorkingStyleStats,
): MeshGrowthAggregateResult {
  const lifecycleDistribution = emptyLifecycleDistribution();
  const rankingDraft: Omit<MeshGrowthRankingEntry, "rank">[] = [];
  const activationScores: number[] = [];
  const operationalScores: number[] = [];
  const velocities: number[] = [];
  let trackedCount = 0;
  let withOperationalScore = 0;
  let falseReadyCount = 0;
  let activatedCount = 0;
  let missionReadyCount = 0;

  for (const agent of agents) {
    const status = statuses.get(agent.agentId) ?? null;
    if (!status) {
      continue;
    }
    trackedCount += 1;
    lifecycleDistribution[status.lifecycleState] += 1;
    activationScores.push(status.activationScore);
    if (status.operationalScore !== null) {
      withOperationalScore += 1;
      operationalScores.push(status.operationalScore);
    }
    if (status.lifecycleState === "activated" || status.lifecycleState === "evolution") {
      activatedCount += 1;
    }
    if (status.lifecycleState === "mission_ready") {
      missionReadyCount += 1;
    }
    const falseReady = detectFalseReady(status.activationScore, status.operationalScore);
    if (falseReady) {
      falseReadyCount += 1;
    }
    const growthVelocity = computeGrowthVelocity(status, nowMs);
    velocities.push(growthVelocity);
    rankingDraft.push({
      agentId: agent.agentId,
      name: agent.name,
      lifecycleState: status.lifecycleState,
      activationScore: status.activationScore,
      operationalScore: status.operationalScore,
      growthVelocity,
      falseReady,
    });
  }

  rankingDraft.sort(
    (left, right) =>
      right.growthVelocity - left.growthVelocity ||
      right.activationScore - left.activationScore ||
      left.name.localeCompare(right.name),
  );

  const ranking = rankingDraft.map((entry, index) => ({
    ...entry,
    rank: index + 1,
  }));

  return {
    generatedAt: new Date(nowMs).toISOString(),
    summary: {
      botCount: agents.length,
      trackedCount,
      withOperationalScore,
      falseReadyCount,
      activatedCount,
      missionReadyCount,
      avgActivationScore: average(activationScores),
      avgOperationalScore: average(operationalScores),
      avgGrowthVelocity: average(velocities),
    },
    lifecycleDistribution,
    workingStyle: workingStyle ?? {
      botsWithProfile: 0,
      botsWithRecentChange: 0,
      effectiveness: aggregateWorkingStyleEffectiveness([]),
    },
    ranking,
  };
}

async function loadWorkingStyleMaps(
  cfg: OpenBotConfig,
  agentIds: string[],
  client?: GatewayClient | null,
): Promise<{
  profiles: Map<string, boolean>;
  changes: Map<string, WorkingStyleChangeRecord | null>;
}> {
  const profiles = new Map<string, boolean>();
  const changes = new Map<string, WorkingStyleChangeRecord | null>();
  await Promise.all(
    agentIds.map(async (agentId) => {
      const [style, change] = await Promise.all([
        readRobotWorkingStyleForMeshAggregate({ cfg, client, agentId }).catch(() => null),
        readWorkingStyleChangeForMeshAggregate({ cfg, client, agentId }).catch(() => null),
      ]);
      profiles.set(agentId, style !== null);
      changes.set(agentId, change);
    }),
  );
  return { profiles, changes };
}

/** 读取配置内机器人成长状态并聚合（机巢只读 RPC 后端；须传入已筛选的 tenant agents）。 */
export async function buildMeshGrowthAggregate(
  cfg: OpenBotConfig,
  agents: MeshGrowthAgentInput[],
  options?: { client?: GatewayClient | null },
): Promise<MeshGrowthAggregateResult> {
  const statuses = new Map<string, GrowthStatus | null>();
  const agentIds = agents.map((agent) => agent.agentId);
  const client = options?.client;
  const [{ profiles, changes }] = await Promise.all([
    loadWorkingStyleMaps(cfg, agentIds, client),
    Promise.all(
      agents.map(async (agent) => {
        statuses.set(
          agent.agentId,
          await readRobotGrowthStatusForMeshAggregate({ cfg, client, agentId: agent.agentId }),
        );
      }),
    ),
  ]);
  const workingStyle = buildMeshGrowthWorkingStyleStats(changes, profiles);
  return buildMeshGrowthAggregateFromStatuses(agents, statuses, Date.now(), workingStyle);
}
