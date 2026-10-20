/**
 * Agent Growth OS — P3.1 机巢只读协作组成长聚合（企业统计口径）。
 *
 * 跨协作组汇总 activation / operational / alignment / lifecycle；tenant-scoped，只读。
 */

import { readGroupGrowthStatusById } from "../collaboration-learning/shared.js";
import { listOwnershipRecords, type OwnershipRecord } from "../ownership-store.js";
import {
  buildMeshGrowthAggregateFromStatuses,
  computeGrowthVelocity,
  type MeshGrowthAgentInput,
  type MeshGrowthAggregateResult,
} from "./mesh-growth-aggregate.js";
import { detectFalseReady } from "./operational-score.js";
import type { GrowthStatus, LifecycleState } from "./types.js";

export type MeshGroupGrowthInput = {
  groupId: string;
  name: string;
};

export type MeshGroupGrowthRankingEntry = {
  groupId: string;
  name: string;
  lifecycleState: LifecycleState;
  activationScore: number;
  operationalScore: number | null;
  alignmentScore: number | null;
  growthVelocity: number;
  falseReady: boolean;
  rank: number;
};

export type MeshGroupGrowthAggregateSummary = {
  groupCount: number;
  trackedCount: number;
  withOperationalScore: number;
  withAlignmentScore: number;
  falseReadyCount: number;
  activatedCount: number;
  missionReadyCount: number;
  avgActivationScore: number | null;
  avgOperationalScore: number | null;
  avgAlignmentScore: number | null;
  avgGrowthVelocity: number | null;
};

export type MeshGroupGrowthAggregateResult = {
  generatedAt: string;
  summary: MeshGroupGrowthAggregateSummary;
  lifecycleDistribution: Record<LifecycleState, number>;
  ranking: MeshGroupGrowthRankingEntry[];
};

function average(values: number[]): number | null {
  if (values.length === 0) {
    return null;
  }
  return Math.round((values.reduce((sum, value) => sum + value, 0) / values.length) * 10) / 10;
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

/** Fail-closed empty aggregate when tenant context is missing. */
export function buildEmptyMeshGroupGrowthAggregate(
  nowMs = Date.now(),
): MeshGroupGrowthAggregateResult {
  return buildMeshGroupGrowthAggregateFromStatuses([], new Map(), nowMs);
}

/** Pure: collect collaboration group ids belonging to a single tenant. */
export function listTenantMeshGrowthGroupsFromSources(params: {
  tenantId: string;
  knownGroups: Array<{ groupId: string; title?: string | null }>;
  ownershipRecords: OwnershipRecord[];
}): MeshGroupGrowthInput[] {
  const tenantId = params.tenantId.trim();
  if (!tenantId) {
    return [];
  }

  const titleById = new Map(
    params.knownGroups.map((group) => [group.groupId.trim(), group.title?.trim() || group.groupId]),
  );
  const allowedIds = new Set<string>();

  for (const record of params.ownershipRecords) {
    if (
      record.tenantId === tenantId &&
      record.subjectKind === "group" &&
      record.bindingStatus !== "revoked"
    ) {
      const subjectId = record.subjectId.trim();
      if (subjectId) {
        allowedIds.add(subjectId);
      }
    }
  }

  return [...allowedIds]
    .map((groupId) => ({
      groupId,
      name: titleById.get(groupId) ?? groupId,
    }))
    .toSorted((left, right) => left.name.localeCompare(right.name, "zh-CN"));
}

/** 纯函数：由已读取的协作组成长状态构建企业聚合视图。 */
export function buildMeshGroupGrowthAggregateFromStatuses(
  groups: MeshGroupGrowthInput[],
  statuses: Map<string, GrowthStatus | null>,
  nowMs = Date.now(),
): MeshGroupGrowthAggregateResult {
  const lifecycleDistribution = emptyLifecycleDistribution();
  const rankingDraft: Omit<MeshGroupGrowthRankingEntry, "rank">[] = [];
  const activationScores: number[] = [];
  const operationalScores: number[] = [];
  const alignmentScores: number[] = [];
  const velocities: number[] = [];
  let trackedCount = 0;
  let withOperationalScore = 0;
  let withAlignmentScore = 0;
  let falseReadyCount = 0;
  let activatedCount = 0;
  let missionReadyCount = 0;

  for (const group of groups) {
    const status = statuses.get(group.groupId) ?? null;
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
    const alignment = status.dimensions.alignment;
    if (typeof alignment === "number") {
      withAlignmentScore += 1;
      alignmentScores.push(alignment);
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
      groupId: group.groupId,
      name: group.name,
      lifecycleState: status.lifecycleState,
      activationScore: status.activationScore,
      operationalScore: status.operationalScore,
      alignmentScore: typeof alignment === "number" ? alignment : null,
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
      groupCount: groups.length,
      trackedCount,
      withOperationalScore,
      withAlignmentScore,
      falseReadyCount,
      activatedCount,
      missionReadyCount,
      avgActivationScore: average(activationScores),
      avgOperationalScore: average(operationalScores),
      avgAlignmentScore: average(alignmentScores),
      avgGrowthVelocity: average(velocities),
    },
    lifecycleDistribution,
    ranking,
  };
}

/** Map group inputs to robot-shaped inputs for shared lifecycle ranking helpers in tests. */
export function meshGroupInputsAsAgentInputs(
  groups: MeshGroupGrowthInput[],
): MeshGrowthAgentInput[] {
  return groups.map((group) => ({ agentId: group.groupId, name: group.name }));
}

/** Reuse robot aggregate lifecycle math for parity tests. */
export function buildMeshGroupGrowthAggregateViaRobotAdapter(
  groups: MeshGroupGrowthInput[],
  statuses: Map<string, GrowthStatus | null>,
  nowMs = Date.now(),
): MeshGrowthAggregateResult {
  return buildMeshGrowthAggregateFromStatuses(
    meshGroupInputsAsAgentInputs(groups),
    statuses,
    nowMs,
  );
}

export async function listTenantMeshGrowthGroups(params: {
  tenantId: string;
}): Promise<MeshGroupGrowthInput[]> {
  const { listGatewayCollaborationSpaces } =
    await import("../collaboration-learning/space-store.js");
  const spaces = (await listGatewayCollaborationSpaces()).spaces ?? [];
  return listTenantMeshGrowthGroupsFromSources({
    tenantId: params.tenantId,
    knownGroups: spaces.map((space) => ({
      groupId: space.groupId,
      title: space.title,
    })),
    ownershipRecords: listOwnershipRecords(),
  });
}

export async function buildMeshGroupGrowthAggregate(
  groups: MeshGroupGrowthInput[],
): Promise<MeshGroupGrowthAggregateResult> {
  const statuses = new Map<string, GrowthStatus | null>();
  await Promise.all(
    groups.map(async (group) => {
      statuses.set(
        group.groupId,
        (await readGroupGrowthStatusById(group.groupId).catch(() => null)) ?? null,
      );
    }),
  );
  return buildMeshGroupGrowthAggregateFromStatuses(groups, statuses);
}
