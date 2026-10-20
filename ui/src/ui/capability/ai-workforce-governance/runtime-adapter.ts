import type { EnterprisePortReadModel } from "../../ports/enterprise/semantic/enterprise-read-model.ts";
import type {
  AgentsListResult,
  CollaborationSpaceSnapshotTransport,
  CollaborationSpacesListResult,
  GatewayAgentRow,
} from "../../types.ts";
import type {
  AssetListItem,
  GovernanceActionRecord,
  RankingItem,
  RankingView,
} from "./types/index.ts";

function resolveMemberForAgent(
  readModel: EnterprisePortReadModel,
  userId: string | null | undefined,
  hintName?: string | null,
): EnterprisePortReadModel["memberSummaries"][number] | null {
  const normalized = userId?.trim().toLowerCase();
  if (normalized) {
    const byUser = readModel.memberSummaries.find(
      (entry) => entry.user.trim().toLowerCase() === normalized,
    );
    if (byUser) {
      return byUser;
    }
  }
  const hint = hintName?.trim();
  if (!hint) {
    return null;
  }
  return (
    readModel.memberSummaries.find((entry) => entry.displayLabel === hint) ??
    readModel.memberSummaries.find((entry) => entry.seatTitle === hint) ??
    null
  );
}

function pickPersonLabel(params: {
  preferred?: string | null;
  seatTitle?: string | null;
  fallback?: string | null;
}): string | null {
  const preferred = params.preferred?.trim() || null;
  const seat = params.seatTitle?.trim() || null;
  if (preferred && preferred !== seat) {
    return preferred;
  }
  const fallback = params.fallback?.trim() || null;
  if (fallback && fallback !== seat) {
    return fallback;
  }
  return preferred || fallback;
}

type GovernanceProjectionAsset = {
  id: string;
  name: string;
  type: "bot" | "group";
  status: "active" | "paused" | "error";
  metrics: {
    taskCount: number;
    successRate: number;
    avgLatencyMs: number;
    totalCost: number;
    lifetimeCost?: number;
  };
  riskLevel: "low" | "medium" | "high";
  activeAnomalyCount: number;
};

function deriveGovernanceScore(
  asset: Pick<GovernanceProjectionAsset, "metrics" | "activeAnomalyCount" | "status">,
) {
  const activityScore = Math.min(asset.metrics.taskCount * 2, 35);
  const successScore = asset.metrics.successRate * 45;
  const costPenalty = Math.min(asset.metrics.totalCost, 20);
  const anomalyPenalty = asset.activeAnomalyCount * 10;
  const statusPenalty = asset.status === "error" ? 20 : asset.status === "paused" ? 10 : 0;
  return Math.max(
    0,
    Math.round(activityScore + successScore - costPenalty - anomalyPenalty - statusPenalty),
  );
}

function withDerivedScores<T extends GovernanceProjectionAsset>(assets: T[]) {
  return assets.map((asset) => ({
    ...asset,
    score: deriveGovernanceScore(asset),
  }));
}

export function adaptMeshAssets(readModel: EnterprisePortReadModel): AssetListItem[] {
  const agentAssets: GovernanceProjectionAsset[] = readModel.meshAgents.map((agent) => ({
    id: agent.agentId,
    name: agent.name,
    type: "bot",
    status:
      agent.governanceStatus === "paused"
        ? "paused"
        : agent.governanceStatus === "restricted"
          ? "error"
          : "active",
    position: agent.ownership.positionLabel ?? null,
    owner: agent.ownership.currentManagerLabel ?? agent.creatorLabel ?? null,
    metrics: {
      taskCount: agent.sessionCount,
      successRate:
        agent.sessionCount > 0
          ? Math.max(0, (agent.sessionCount - agent.errorCount) / agent.sessionCount)
          : 0,
      avgLatencyMs: 0,
      totalCost: agent.totalCost,
      lifetimeCost: agent.lifetimeCost ?? agent.totalCost,
    },
    riskLevel:
      agent.governanceStatus === "restricted" || agent.errorCount > 0
        ? "high"
        : agent.governanceStatus === "watch" || agent.budgetStatus === "warning"
          ? "medium"
          : "low",
    activeAnomalyCount: readModel.meshAnomalies.filter(
      (entry) => entry.kind === "agent" && entry.targetId === agent.agentId,
    ).length,
  }));

  const groupAssets: GovernanceProjectionAsset[] = readModel.meshGroups.map((group) => ({
    id: group.groupId,
    name: group.name,
    type: "group",
    status:
      group.governanceStatus === "paused"
        ? "paused"
        : group.governanceStatus === "restricted"
          ? "error"
          : "active",
    position: String(group.memberCount),
    owner: group.ownership.createdByUserLabel ?? group.creatorLabel ?? null,
    memberCount: group.memberCount,
    metrics: {
      taskCount: group.sessionCount,
      successRate:
        group.sessionCount > 0
          ? Math.max(0, (group.sessionCount - group.incidentCount) / group.sessionCount)
          : 0,
      avgLatencyMs: 0,
      totalCost: group.totalCost,
      lifetimeCost: group.lifetimeCost ?? group.totalCost,
    },
    riskLevel:
      group.governanceStatus === "restricted" || group.incidentCount > 0
        ? "high"
        : group.governanceStatus === "watch" || group.budgetStatus === "warning"
          ? "medium"
          : "low",
    activeAnomalyCount: readModel.meshAnomalies.filter(
      (entry) => entry.kind === "group" && entry.targetId === group.groupId,
    ).length,
  }));

  return withDerivedScores([...agentAssets, ...groupAssets])
    .map(
      (asset): AssetListItem => ({
        id: asset.id,
        name: asset.name,
        type: asset.type,
        status: asset.status,
        position:
          asset.type === "group"
            ? String(
                readModel.meshGroups.find((group) => group.groupId === asset.id)?.memberCount ?? 0,
              )
            : (readModel.meshAgents.find((agent) => agent.agentId === asset.id)?.ownership
                .positionLabel ?? null),
        owner:
          asset.type === "group"
            ? (readModel.meshGroups.find((group) => group.groupId === asset.id)?.ownership
                .createdByUserLabel ??
              readModel.meshGroups.find((group) => group.groupId === asset.id)?.creatorLabel ??
              null)
            : (readModel.meshAgents.find((agent) => agent.agentId === asset.id)?.ownership
                .currentManagerLabel ??
              readModel.meshAgents.find((agent) => agent.agentId === asset.id)?.creatorLabel ??
              null),
        memberCount:
          asset.type === "group"
            ? readModel.meshGroups.find((group) => group.groupId === asset.id)?.memberCount
            : undefined,
        metrics: {
          taskCount: asset.metrics.taskCount,
          successRate: asset.metrics.successRate,
          avgLatency: asset.metrics.avgLatencyMs,
          totalCost: asset.metrics.totalCost,
          lifetimeCost: asset.metrics.lifetimeCost ?? asset.metrics.totalCost,
          avgCostPerTask:
            asset.metrics.taskCount > 0 ? asset.metrics.totalCost / asset.metrics.taskCount : 0,
        },
        riskLevel: asset.riskLevel,
        activeAnomalyCount: asset.activeAnomalyCount,
        score: asset.score,
      }),
    )
    .toSorted((left, right) => (right.score ?? 0) - (left.score ?? 0));
}

export function adaptCreatorAssets(params: {
  readModel: EnterprisePortReadModel;
  agentsList?: AgentsListResult | null;
  collaborationSpacesResult?: CollaborationSpacesListResult | null;
  /** Enterprise mesh embed should include shared/team scoped agents. */
  includeSharedTeamScopes?: boolean;
}): AssetListItem[] {
  const ownerFallback =
    params.readModel.memberSummaries.find((entry) => entry.membershipRole === "enterprise-admin")
      ?.displayLabel ??
    params.readModel.authenticatedUser ??
    "未知";

  const agentRows = params.agentsList?.agents ?? [];
  const meshAgentById = new Map(
    params.readModel.meshAgents.map((entry) => [entry.agentId, entry] as const),
  );
  const robotAssets: AssetListItem[] = agentRows
    .filter((agent) => {
      if (params.includeSharedTeamScopes) {
        return true;
      }
      const scope = agent.scope?.trim().toLowerCase();
      return scope !== "shared" && scope !== "team";
    })
    .map((agent) =>
      adaptCreatorRobot(
        agent,
        meshAgentById.get(agent.id) ?? null,
        ownerFallback,
        params.readModel,
      ),
    );

  const spaces = params.collaborationSpacesResult?.spaces ?? [];
  const meshGroupById = new Map(
    params.readModel.meshGroups.map((entry) => [entry.groupId, entry] as const),
  );
  const spaceAssets: AssetListItem[] = spaces.map((space) =>
    adaptCreatorSpace(space, meshGroupById.get(space.groupId ?? space.id) ?? null),
  );

  return [...robotAssets, ...spaceAssets].toSorted(
    (left, right) => (right.score ?? 0) - (left.score ?? 0),
  );
}

/** Build ranking from enterprise creator assets (avoids gateway seed names like "{tenant} Runtime"). */
export function buildCreatorRanking(params: {
  readModel: EnterprisePortReadModel;
  agentsList?: AgentsListResult | null;
  collaborationSpacesResult?: CollaborationSpacesListResult | null;
  rankingType: "bot" | "group" | "position";
}): RankingView {
  const assets = adaptCreatorAssets(params);
  let items: RankingItem[];
  if (params.rankingType === "position") {
    const byPosition = new Map<
      string,
      { taskCount: number; successSum: number; costSum: number; scoreSum: number; count: number }
    >();
    for (const asset of assets.filter((entry) => entry.type === "bot")) {
      const key = asset.position?.trim() || "未分配岗位";
      const current = byPosition.get(key) ?? {
        taskCount: 0,
        successSum: 0,
        costSum: 0,
        scoreSum: 0,
        count: 0,
      };
      current.taskCount += asset.metrics.taskCount;
      current.successSum += asset.metrics.successRate;
      current.costSum += asset.metrics.avgCostPerTask ?? 0;
      current.scoreSum += asset.score ?? 0;
      current.count += 1;
      byPosition.set(key, current);
    }
    items = Array.from(byPosition.entries())
      .map(([name, agg]) => ({
        id: `position:${name}`,
        name,
        type: "position" as const,
        score: Math.round(agg.scoreSum / Math.max(agg.count, 1)),
        rank: 0,
        metrics: {
          taskCount: agg.taskCount,
          successRate: agg.successSum / Math.max(agg.count, 1),
          avgCost: agg.costSum / Math.max(agg.count, 1),
        },
      }))
      .toSorted((left, right) => right.score - left.score)
      .map((item, index) => ({ ...item, rank: index + 1 }));
  } else {
    items = assets
      .filter((entry) => entry.type === params.rankingType)
      .map((asset, index) => ({
        id: asset.id,
        name: asset.name,
        type: asset.type,
        score: asset.score ?? 0,
        rank: index + 1,
        metrics: {
          taskCount: asset.metrics.taskCount,
          successRate: asset.metrics.successRate,
          avgCost: asset.metrics.avgCostPerTask ?? 0,
        },
      }));
  }
  return {
    type: params.rankingType,
    items,
    total: items.length,
    generatedAt: new Date().toISOString(),
  };
}

/** Build ranking from meshAgents / meshGroups when creator lists are unavailable. */
export function buildMeshRanking(params: {
  readModel: EnterprisePortReadModel;
  rankingType: "bot" | "group" | "position";
}): RankingView {
  const assets = adaptMeshAssets(params.readModel);
  let items: RankingItem[];
  if (params.rankingType === "position") {
    const byPosition = new Map<
      string,
      { taskCount: number; successSum: number; costSum: number; scoreSum: number; count: number }
    >();
    for (const asset of assets.filter((entry) => entry.type === "bot")) {
      const key = asset.position?.trim() || "未分配岗位";
      const current = byPosition.get(key) ?? {
        taskCount: 0,
        successSum: 0,
        costSum: 0,
        scoreSum: 0,
        count: 0,
      };
      current.taskCount += asset.metrics.taskCount;
      current.successSum += asset.metrics.successRate;
      current.costSum += asset.metrics.avgCostPerTask ?? 0;
      current.scoreSum += asset.score ?? 0;
      current.count += 1;
      byPosition.set(key, current);
    }
    items = Array.from(byPosition.entries())
      .map(([name, agg]) => ({
        id: `position:${name}`,
        name,
        type: "position" as const,
        score: agg.count > 0 ? Math.round(agg.scoreSum / agg.count) : 0,
        rank: 0,
        metrics: {
          taskCount: agg.taskCount,
          successRate: agg.count > 0 ? agg.successSum / agg.count : 0,
          avgCost: agg.count > 0 ? agg.costSum / agg.count : 0,
        },
      }))
      .toSorted((left, right) => right.score - left.score)
      .map((item, index) => ({ ...item, rank: index + 1 }));
  } else {
    items = assets
      .filter((entry) => entry.type === params.rankingType)
      .map((asset, index) => ({
        id: asset.id,
        name: asset.name,
        type: asset.type,
        score: asset.score ?? 0,
        rank: index + 1,
        metrics: {
          taskCount: asset.metrics.taskCount,
          successRate: asset.metrics.successRate,
          avgCost: asset.metrics.avgCostPerTask ?? 0,
        },
      }));
  }
  return {
    type: params.rankingType,
    items,
    total: items.length,
    generatedAt: new Date().toISOString(),
  };
}

export function buildCreatorGovernanceActions(assets: AssetListItem[]): GovernanceActionRecord[] {
  return assets
    .filter((asset) => asset.riskLevel !== "low" || asset.activeAnomalyCount > 0)
    .map((asset) => ({
      id: `creator-action:${asset.id}`,
      assetId: asset.id,
      assetName: asset.name,
      action: asset.riskLevel === "high" ? "pause" : "notify_admin",
      trigger: "anomaly",
      reason:
        asset.riskLevel === "high"
          ? "运行成功率偏低、成本异常或治理风险较高"
          : "建议人工复核当前运行状态与负责人归属",
      status: "pending",
      createdAt: new Date().toISOString(),
    }));
}

function adaptCreatorRobot(
  agent: GatewayAgentRow,
  meshAgent: EnterprisePortReadModel["meshAgents"][number] | null,
  ownerFallback: string,
  readModel: EnterprisePortReadModel,
): AssetListItem {
  const taskCount = meshAgent?.sessionCount ?? 0;
  const totalCost = meshAgent?.totalCost ?? 0;
  const errorCount = meshAgent?.errorCount ?? 0;
  // Zero tasks must not look like perfect reliability.
  const successRate = taskCount > 0 ? Math.max(0, (taskCount - errorCount) / taskCount) : 0;
  const managerMember = resolveMemberForAgent(
    readModel,
    meshAgent?.ownership.currentManagerUserId,
    meshAgent?.ownership.currentManagerLabel,
  );
  const member = resolveMemberForAgent(readModel, agent.ownerId, agent.ownerName);
  const seatTitle =
    managerMember?.seatTitle?.trim() ||
    member?.seatTitle?.trim() ||
    meshAgent?.ownership.positionLabel?.trim() ||
    null;
  const rawPosition = meshAgent?.ownership.positionLabel?.trim() || null;
  // Prefer real ownership position / manager seat; never echo person-or-seat conflated ownerName.
  const position =
    (rawPosition &&
    rawPosition !== "默认管理岗位" &&
    rawPosition !== agent.ownerName?.trim() &&
    rawPosition !== agent.ownerId?.trim()
      ? rawPosition
      : null) ||
    seatTitle ||
    (rawPosition && rawPosition !== agent.ownerName?.trim() ? rawPosition : null);
  const owner =
    pickPersonLabel({
      preferred: managerMember?.displayLabel ?? meshAgent?.ownership.currentManagerLabel,
      seatTitle,
      fallback: meshAgent?.creatorLabel,
    }) ||
    pickPersonLabel({
      preferred: member?.displayLabel,
      seatTitle,
      fallback: null,
    }) ||
    // Avoid using position-style ownerName (e.g. "CEO") as the person column.
    (agent.ownerName?.trim() && agent.ownerName.trim() !== seatTitle
      ? agent.ownerName.trim()
      : null) ||
    agent.ownerId?.trim() ||
    ownerFallback;
  const projection = withDerivedScores([
    {
      id: agent.id,
      name: agent.name?.trim() || agent.identity?.name?.trim() || agent.id,
      type: "bot" as const,
      status:
        meshAgent?.governanceStatus === "paused"
          ? "paused"
          : meshAgent?.governanceStatus === "restricted"
            ? "error"
            : "active",
      metrics: {
        taskCount,
        successRate,
        avgLatencyMs: 0,
        totalCost,
      },
      riskLevel:
        meshAgent?.governanceStatus === "restricted" || errorCount > 0
          ? "high"
          : meshAgent?.governanceStatus === "watch" || meshAgent?.budgetStatus === "warning"
            ? "medium"
            : "low",
      activeAnomalyCount: errorCount,
    },
  ])[0];

  return {
    id: projection.id,
    name: projection.name,
    type: projection.type,
    status: projection.status,
    position,
    owner,
    metrics: {
      taskCount: projection.metrics.taskCount,
      successRate: projection.metrics.successRate,
      avgLatency: projection.metrics.avgLatencyMs,
      totalCost: projection.metrics.totalCost,
      avgCostPerTask: taskCount > 0 ? totalCost / taskCount : 0,
    },
    riskLevel: projection.riskLevel,
    activeAnomalyCount: projection.activeAnomalyCount,
    score: projection.score,
  };
}

function adaptCreatorSpace(
  space: CollaborationSpaceSnapshotTransport,
  meshGroup: EnterprisePortReadModel["meshGroups"][number] | null,
): AssetListItem {
  const humanMembers = (space.members?.humans ?? []).filter(
    (
      entry: NonNullable<
        NonNullable<CollaborationSpaceSnapshotTransport["members"]>["humans"]
      >[number],
    ) => entry.status !== "removed",
  );
  const botMembers = (space.members?.bots ?? []).filter(
    (
      entry: NonNullable<
        NonNullable<CollaborationSpaceSnapshotTransport["members"]>["bots"]
      >[number],
    ) => entry.status !== "removed",
  );
  const memberCount = humanMembers.length + botMembers.length;
  const taskCount = meshGroup?.sessionCount ?? 0;
  const totalCost = meshGroup?.totalCost ?? 0;
  const incidentCount = meshGroup?.incidentCount ?? 0;
  const successRate = taskCount > 0 ? Math.max(0, (taskCount - incidentCount) / taskCount) : 0;
  const ownerLabel =
    humanMembers
      .find(
        (
          entry: NonNullable<
            NonNullable<CollaborationSpaceSnapshotTransport["members"]>["humans"]
          >[number],
        ) => entry.userId === space.ownerUserId,
      )
      ?.name?.trim() ||
    space.ownerUserId?.trim() ||
    meshGroup?.ownership.createdByUserLabel ||
    meshGroup?.creatorLabel ||
    null;
  const projection = withDerivedScores([
    {
      id: space.groupId ?? space.id,
      name: space.title?.trim() || space.groupId || space.id,
      type: "group" as const,
      status:
        meshGroup?.governanceStatus === "paused"
          ? "paused"
          : meshGroup?.governanceStatus === "restricted"
            ? "error"
            : "active",
      metrics: {
        taskCount,
        successRate,
        avgLatencyMs: 0,
        totalCost,
      },
      riskLevel:
        meshGroup?.governanceStatus === "restricted" || incidentCount > 0
          ? "high"
          : meshGroup?.governanceStatus === "watch" || meshGroup?.budgetStatus === "warning"
            ? "medium"
            : "low",
      activeAnomalyCount: incidentCount,
    },
  ])[0];

  return {
    id: projection.id,
    name: projection.name,
    type: projection.type,
    status: projection.status,
    position: String(memberCount),
    owner: ownerLabel,
    memberCount,
    metrics: {
      taskCount: projection.metrics.taskCount,
      successRate: projection.metrics.successRate,
      avgLatency: projection.metrics.avgLatencyMs,
      totalCost: projection.metrics.totalCost,
      avgCostPerTask: taskCount > 0 ? totalCost / taskCount : 0,
    },
    riskLevel: projection.riskLevel,
    activeAnomalyCount: projection.activeAnomalyCount,
    score: projection.score,
  };
}
