import { getAgent, listAgents, listBindings, listTelemetry } from "../agent-runtime-store.js";
import {
  buildGovernanceAnomalies,
  buildGovernanceDashboard,
  buildGovernanceRanking,
  buildGovernanceSuggestedActions,
  withDerivedScores,
} from "../ai-workforce-governance/shared/governance-projection.js";
import { listGatewayCollaborationSpaces } from "../collaboration-learning/space-store.js";
import { requireResolvedEnterpriseTenantId } from "../enterprise-data/enterprise-data-seat-context.js";
import { findActiveOwnershipRecord } from "../ownership-store.js";
import { ErrorCodes, errorShape } from "../protocol/index.js";
import { isRecord, oneOf, requiredString, stringValue } from "./request-params.js";
import type { GatewayClient, GatewayRequestHandlers } from "./types.js";

type GovernanceAssetRecord = {
  id: string;
  name: string;
  type: "bot" | "group";
  status: "active" | "paused" | "error";
  position: string | null;
  owner: string | null;
  memberCount?: number;
  metrics: {
    taskCount: number;
    successRate: number;
    avgLatencyMs: number;
    totalCost: number;
  };
  riskLevel: "low" | "medium" | "high";
  activeAnomalyCount: number;
  score: number;
};

type GovernanceActionHistoryRecord = {
  id: string;
  assetId: string;
  assetName: string;
  action: string;
  trigger: "manual" | "auto_governance" | "anomaly";
  reason: string;
  status: "pending" | "executed" | "failed" | "cancelled";
  executedAt?: string;
  createdAt: string;
};

const governanceActionHistory: GovernanceActionHistoryRecord[] = [];

function deriveRiskLevel(params: {
  successRate: number;
  totalCost: number;
  issueCount: number;
}): "low" | "medium" | "high" {
  if (params.issueCount > 0 || params.successRate < 0.75) {
    return "high";
  }
  if (params.totalCost > 20 || params.successRate < 0.9) {
    return "medium";
  }
  return "low";
}

async function resolveGovernanceTenantId(
  client: GatewayClient | null,
  params: Record<string, unknown>,
): Promise<string | null> {
  let rejected = false;
  const tenantId = await requireResolvedEnterpriseTenantId({
    client,
    params,
    respond: () => {
      rejected = true;
    },
  });
  if (rejected || !tenantId) {
    return null;
  }
  return tenantId;
}

async function buildGovernanceAssets(tenantId: string): Promise<GovernanceAssetRecord[]> {
  const tenantAgents = listAgents({
    lifecycle: null,
    health: null,
    tenantId,
    searchQuery: "",
  });
  const tenantAgentIds = new Set(tenantAgents.map((agent) => agent.runtimeAgentId));
  const bindings = listBindings({
    runtimeAgentId: null,
    capabilityId: null,
    bindingType: null,
    bindingState: null,
    health: null,
  }).filter((binding) => tenantAgentIds.has(binding.runtimeAgentId));
  const telemetry = listTelemetry({
    runtimeAgentId: null,
    capabilityId: null,
    window: "30d",
  }).filter((sample) => tenantAgentIds.has(sample.runtimeAgentId));

  const agentAssets: GovernanceAssetRecord[] = bindings.map((binding) => {
    const agent = getAgent(binding.runtimeAgentId);
    const sample =
      telemetry
        .filter(
          (entry) =>
            entry.runtimeAgentId === binding.runtimeAgentId &&
            entry.capabilityId === binding.capabilityId,
        )
        .toSorted((left, right) => right.lastSampleAt - left.lastSampleAt)[0] ?? null;
    const ownership =
      findActiveOwnershipRecord({
        tenantId,
        subjectKind: "agent",
        subjectId: binding.runtimeAgentId,
      }) ?? null;
    const issueCount =
      (binding.healthStatus === "unhealthy" ? 1 : 0) +
      (binding.bindingState === "disabled" ? 1 : 0) +
      (sample && sample.successRate7d < 0.75 ? 1 : 0);
    return {
      id: binding.runtimeAgentId,
      name: agent?.name?.trim() || binding.runtimeAgentId,
      type: "bot",
      status:
        binding.bindingState === "disabled"
          ? "paused"
          : binding.healthStatus === "unhealthy"
            ? "error"
            : "active",
      position: ownership?.positionLabel ?? null,
      owner: ownership?.currentManagerLabel ?? ownership?.createdByUserLabel ?? null,
      metrics: {
        taskCount: sample?.calls7d ?? binding.invocationMetrics.calls7d,
        successRate: sample?.successRate7d ?? binding.invocationMetrics.successRate7d,
        avgLatencyMs: sample?.avgLatencyMs ?? binding.invocationMetrics.avgLatencyMs,
        totalCost:
          (sample?.tokenConsumption7d ?? binding.invocationMetrics.tokenConsumption7d) / 1000,
      },
      riskLevel: deriveRiskLevel({
        successRate: sample?.successRate7d ?? binding.invocationMetrics.successRate7d,
        totalCost:
          (sample?.tokenConsumption7d ?? binding.invocationMetrics.tokenConsumption7d) / 1000,
        issueCount,
      }),
      activeAnomalyCount: issueCount,
      score: 0,
    };
  });

  const spaces = ((await listGatewayCollaborationSpaces()).spaces ?? []).filter((space) =>
    Boolean(
      findActiveOwnershipRecord({
        tenantId,
        subjectKind: "group",
        subjectId: space.groupId,
      }),
    ),
  );
  const groupAssets: GovernanceAssetRecord[] = spaces.map((space) => {
    const ownership =
      findActiveOwnershipRecord({
        tenantId,
        subjectKind: "group",
        subjectId: space.groupId,
      }) ?? null;
    const activeMembers = (space.members?.humans ?? []).filter(
      (member) => member.status === "active",
    );
    const activeBots = (space.members?.bots ?? []).filter((member) => member.status === "active");
    const memberCount = activeMembers.length + activeBots.length;
    return {
      id: space.groupId,
      name: space.title ?? space.groupId,
      type: "group",
      status: "active",
      position: String(memberCount),
      owner:
        ownership?.createdByUserLabel ??
        ownership?.currentManagerLabel ??
        space.members.humans[0]?.name ??
        space.ownerUserId ??
        null,
      memberCount,
      metrics: {
        taskCount: 0,
        successRate: 1,
        avgLatencyMs: 0,
        totalCost: 0,
      },
      riskLevel: "low",
      activeAnomalyCount: 0,
      score: 0,
    };
  });

  return withDerivedScores([...agentAssets, ...groupAssets]);
}

function paginate<T>(items: T[], rawPagination: unknown) {
  const page =
    typeof (rawPagination as { page?: unknown } | undefined)?.page === "number"
      ? Math.max(1, Number((rawPagination as { page: number }).page))
      : 1;
  const pageSize =
    typeof (rawPagination as { pageSize?: unknown } | undefined)?.pageSize === "number"
      ? Math.max(1, Number((rawPagination as { pageSize: number }).pageSize))
      : 10;
  const total = items.length;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const currentPage = Math.min(page, totalPages);
  const start = (currentPage - 1) * pageSize;
  return {
    items: items.slice(start, start + pageSize),
    pagination: {
      page: currentPage,
      pageSize,
      total,
      totalPages,
    },
  };
}

async function assetsForClient(
  client: GatewayClient | null,
  params: Record<string, unknown>,
): Promise<GovernanceAssetRecord[] | null> {
  const tenantId = await resolveGovernanceTenantId(client, params);
  if (!tenantId) {
    return null;
  }
  return buildGovernanceAssets(tenantId);
}

export const governanceHandlers: GatewayRequestHandlers = {
  "governance.assets.list": async ({ client, params, respond }) => {
    const assets = await assetsForClient(client, params);
    if (!assets) {
      respond(true, paginate([], params.pagination), undefined);
      return;
    }
    const filters = isRecord(params.filters) ? params.filters : {};
    const sorting = isRecord(params.sorting) ? params.sorting : {};
    let items = assets;

    const type = stringValue(filters.type);
    if (type === "bot" || type === "group") {
      items = items.filter((item) => item.type === type);
    }
    const search = stringValue(filters.search)?.toLowerCase();
    if (search) {
      items = items.filter(
        (item) =>
          item.name.toLowerCase().includes(search) ||
          item.owner?.toLowerCase().includes(search) ||
          item.position?.toLowerCase().includes(search),
      );
    }
    const riskLevel = stringValue(filters.riskLevel);
    if (riskLevel === "low" || riskLevel === "medium" || riskLevel === "high") {
      items = items.filter((item) => item.riskLevel === riskLevel);
    }
    const status = stringValue(filters.status);
    if (status === "active" || status === "paused" || status === "error") {
      items = items.filter((item) => item.status === status);
    }

    items.sort((left, right) => {
      const direction = sorting.direction === "asc" ? 1 : -1;
      switch (sorting.field) {
        case "task":
          return (left.metrics.taskCount - right.metrics.taskCount) * direction;
        case "success_rate":
          return (left.metrics.successRate - right.metrics.successRate) * direction;
        case "cost":
          return (left.metrics.totalCost - right.metrics.totalCost) * direction;
        default:
          return left.name.localeCompare(right.name) * direction;
      }
    });

    respond(true, paginate(items, params.pagination), undefined);
  },

  "governance.anomalies.list": async ({ client, params, respond }) => {
    const assets = await assetsForClient(client, params);
    if (!assets) {
      respond(true, paginate([], params.pagination), undefined);
      return;
    }
    const filters = isRecord(params.filters) ? params.filters : {};
    const anomalies = buildGovernanceAnomalies(assets, new Date().toISOString());
    const assetId = stringValue(filters.assetId);
    const filtered = anomalies.filter((item) => (!assetId ? true : item.assetId === assetId));
    respond(true, paginate(filtered, params.pagination), undefined);
  },

  "governance.actions.list": async ({ client, params, respond }) => {
    const assets = await assetsForClient(client, params);
    if (!assets) {
      respond(
        true,
        { items: [], pagination: paginate([], params.pagination).pagination },
        undefined,
      );
      return;
    }
    const filters = isRecord(params.filters) ? params.filters : {};
    const assetId = stringValue(filters.assetId);
    const status = stringValue(filters.status);
    const merged = buildGovernanceSuggestedActions(
      assets,
      governanceActionHistory,
      new Date().toISOString(),
    );
    const filtered = merged.filter(
      (entry) => (!assetId || entry.assetId === assetId) && (!status || entry.status === status),
    );
    respond(
      true,
      { items: filtered, pagination: paginate(filtered, params.pagination).pagination },
      undefined,
    );
  },

  "governance.actions.execute": ({ params, respond }) => {
    const actionId = requiredString(params, "actionId", respond);
    if (!actionId) {
      return;
    }
    const existing = governanceActionHistory.find((entry) => entry.id === actionId);
    if (existing) {
      existing.status = "executed";
      existing.executedAt = new Date().toISOString();
      respond(
        true,
        { success: true, actionId, status: existing.status, executedAt: existing.executedAt },
        undefined,
      );
      return;
    }
    respond(
      true,
      { success: true, actionId, status: "executed", executedAt: new Date().toISOString() },
      undefined,
    );
  },

  "governance.ranking.get": async ({ client, params, respond }) => {
    const assets = (await assetsForClient(client, params)) ?? [];
    const type = oneOf(params.type, ["group", "position"] as const) ?? "bot";
    respond(true, buildGovernanceRanking(assets, type), undefined);
  },

  "governance.metrics.dashboard": async ({ client, params, respond }) => {
    const assets = (await assetsForClient(client, params)) ?? [];
    respond(true, buildGovernanceDashboard(assets, new Date().toISOString()), undefined);
  },

  "governance.assets.detail": async ({ client, params, respond }) => {
    const assetId = requiredString(params, "assetId", respond);
    if (!assetId) {
      return;
    }
    const assets = await assetsForClient(client, params);
    const asset = assets?.find((entry) => entry.id === assetId);
    if (!asset) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, `unknown assetId: ${assetId}`),
      );
      return;
    }
    respond(
      true,
      {
        asset: {
          id: asset.id,
          name: asset.name,
          type: asset.type,
          status: asset.status,
          position: asset.position ? { id: asset.position, title: asset.position } : null,
          owner: asset.owner
            ? { id: asset.owner, name: asset.owner, email: `${asset.owner}@local` }
            : null,
          runtime: { id: null, status: asset.status },
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
        metrics: {
          taskCount: asset.metrics.taskCount,
          successRate: asset.metrics.successRate,
          avgLatencyMs: asset.metrics.avgLatencyMs,
          totalCost: asset.metrics.totalCost,
          avgCostPerTask:
            asset.metrics.taskCount > 0 ? asset.metrics.totalCost / asset.metrics.taskCount : 0,
          errorCount: asset.activeAnomalyCount,
        },
        dailyMetrics: [],
        recentRuns: [],
        activeAnomalies: [],
        riskLevel: asset.riskLevel,
        riskFactors: asset.activeAnomalyCount > 0 ? ["runtime_governance_issue"] : [],
      },
      undefined,
    );
  },
};
