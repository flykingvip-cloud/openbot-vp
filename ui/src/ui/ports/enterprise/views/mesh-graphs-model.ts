/**
 * Mesh graph pure model/layout/filter helpers (no Lit / no custom elements).
 */

import { pathForTab } from "../../../navigation.ts";
import type {
  AgentsListResult,
  CollaborationSpaceSnapshotTransport,
  CollaborationSpacesListResult,
} from "../../../types.ts";
import type { EnterprisePortReadModel } from "../semantic/enterprise-read-model.ts";
import { resolveCollaborationGroupDisplayName } from "./enterprise-handover-asset-helpers.ts";

export type MeshGraphAgentNode = {
  id: string;
  name: string;
  sessionCount: number;
  groupCount: number;
  totalCost: number;
  statusLabel: string;
  intensity: number;
};

export type MeshGraphGroupNode = {
  id: string;
  name: string;
  humanCount: number;
  botCount: number;
  sessionCount: number;
  totalCost: number;
};

export type MeshGraphEdge = {
  agentId: string;
  agentName: string;
  groupId: string;
  groupName: string;
};

export type MeshGraphModel = {
  agents: MeshGraphAgentNode[];
  groups: MeshGraphGroupNode[];
  edges: MeshGraphEdge[];
};

export type MeshBipartiteLayoutNode = {
  id: string;
  kind: "agent" | "group";
  name: string;
  meta: string;
  x: number;
  y: number;
  r: number;
};

export type MeshBipartiteLayoutEdge = {
  key: string;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  cx: number;
  cy: number;
};

export type MeshBipartiteLayout = {
  width: number;
  height: number;
  nodes: MeshBipartiteLayoutNode[];
  edges: MeshBipartiteLayoutEdge[];
  truncatedAgents: number;
  truncatedGroups: number;
  visibleEdgeCount: number;
};

function meshObjectHref(
  basePath: string,
  tenantId: string | null,
  kind: "agents" | "groups",
  id: string,
) {
  const base = pathForTab("enterpriseMesh", basePath, { tenantId }).replace(/\/$/, "");
  return `${base}/overview/${kind}/${encodeURIComponent(id)}`;
}

function agentStatusLabel(
  meshAgent: EnterprisePortReadModel["meshAgents"][number] | null | undefined,
): string {
  if (!meshAgent) {
    return "未监测";
  }
  switch (meshAgent.governanceStatus) {
    case "paused":
      return "已暂停";
    case "restricted":
      return "受限";
    case "watch":
      return "关注中";
    default:
      break;
  }
  switch (meshAgent.status) {
    case "online":
      return "在线";
    case "offline":
      return "离线";
    default:
      return meshAgent.sessionCount > 0 ? "有会话" : "空闲";
  }
}

function activeHumans(space: CollaborationSpaceSnapshotTransport): number {
  return (space.members?.humans ?? []).filter((entry) => entry.status !== "removed").length;
}

function activeBots(space: CollaborationSpaceSnapshotTransport) {
  return (space.members?.bots ?? []).filter((entry) => entry.status !== "removed");
}

function resolveAgentDisplayName(params: {
  agentId: string;
  agentsList?: AgentsListResult | null;
  meshAgent?: EnterprisePortReadModel["meshAgents"][number] | null;
}): string {
  const fromList = params.agentsList?.agents?.find((entry) => entry.id === params.agentId);
  return (
    fromList?.name?.trim() ||
    fromList?.identity?.name?.trim() ||
    params.meshAgent?.name?.trim() ||
    params.agentId
  );
}

function findMeshGroup(
  readModel: EnterprisePortReadModel,
  groupId: string,
): EnterprisePortReadModel["meshGroups"][number] | null {
  const normalized = groupId.trim();
  return (
    readModel.meshGroups.find((entry) => entry.groupId === normalized) ??
    readModel.meshGroups.find(
      (entry) =>
        entry.groupId.replace(/^(space|group)[-_:/]+/i, "").toLowerCase() ===
        normalized.replace(/^(space|group)[-_:/]+/i, "").toLowerCase(),
    ) ??
    null
  );
}

export function truncateMeshGraphLabel(label: string, max = 12): string {
  const value = label.trim();
  if (value.length <= max) {
    return value;
  }
  return `${value.slice(0, max - 1)}…`;
}

export function meshGraphNodeKey(kind: "agent" | "group", id: string): string {
  return `${kind}:${id}`;
}

export type MeshGraphViewFilter = {
  query: string;
  kind: "all" | "agent" | "group";
  connectedOnly: boolean;
};

/** Filter/search model for canvas (neighbor expansion on query). */
export function filterMeshGraphModel(
  model: MeshGraphModel,
  filter: MeshGraphViewFilter,
): MeshGraphModel {
  const query = filter.query.trim().toLowerCase();
  let agents = model.agents.slice();
  let groups = model.groups.slice();
  let edges = model.edges.slice();

  if (query) {
    const agentHit = new Set(
      agents.filter((entry) => entry.name.toLowerCase().includes(query)).map((entry) => entry.id),
    );
    const groupHit = new Set(
      groups.filter((entry) => entry.name.toLowerCase().includes(query)).map((entry) => entry.id),
    );
    for (const edge of model.edges) {
      if (agentHit.has(edge.agentId)) {
        groupHit.add(edge.groupId);
      }
      if (groupHit.has(edge.groupId)) {
        agentHit.add(edge.agentId);
      }
    }
    agents = agents.filter((entry) => agentHit.has(entry.id));
    groups = groups.filter((entry) => groupHit.has(entry.id));
  }

  if (filter.kind === "agent") {
    groups = [];
    edges = [];
  } else if (filter.kind === "group") {
    agents = [];
    edges = [];
  } else {
    const agentIds = new Set(agents.map((entry) => entry.id));
    const groupIds = new Set(groups.map((entry) => entry.id));
    edges = edges.filter((edge) => agentIds.has(edge.agentId) && groupIds.has(edge.groupId));
    if (filter.connectedOnly) {
      const linkedAgents = new Set(edges.map((edge) => edge.agentId));
      const linkedGroups = new Set(edges.map((edge) => edge.groupId));
      agents = agents.filter((entry) => linkedAgents.has(entry.id));
      groups = groups.filter((entry) => linkedGroups.has(entry.id));
    }
  }

  return { agents, groups, edges };
}

function distributeY(count: number, height: number, padTop: number, padBottom: number): number[] {
  if (count <= 0) {
    return [];
  }
  if (count === 1) {
    return [(padTop + height - padBottom) / 2];
  }
  const usable = Math.max(height - padTop - padBottom, 1);
  const step = usable / (count - 1);
  return Array.from({ length: count }, (_, index) => padTop + step * index);
}

export function buildMeshGraphEdgesFromNodes(
  nodes: MeshBipartiteLayoutNode[],
  modelEdges: MeshGraphEdge[],
): MeshBipartiteLayoutEdge[] {
  const nodeById = new Map(nodes.map((node) => [meshGraphNodeKey(node.kind, node.id), node]));
  const edges: MeshBipartiteLayoutEdge[] = [];
  for (const edge of modelEdges) {
    const from = nodeById.get(meshGraphNodeKey("agent", edge.agentId));
    const to = nodeById.get(meshGraphNodeKey("group", edge.groupId));
    if (!from || !to) {
      continue;
    }
    const midX = (from.x + to.x) / 2;
    edges.push({
      key: `${edge.agentId}->${edge.groupId}`,
      x1: from.x + from.r,
      y1: from.y,
      x2: to.x - to.r,
      y2: to.y,
      cx: midX,
      cy: (from.y + to.y) / 2,
    });
  }
  return edges;
}

export function applyMeshNodePositions(
  layout: MeshBipartiteLayout,
  positions: Record<string, { x: number; y: number }>,
  modelEdges: MeshGraphEdge[],
): MeshBipartiteLayout {
  const nodes = layout.nodes.map((node) => {
    const override = positions[meshGraphNodeKey(node.kind, node.id)];
    return override ? { ...node, x: override.x, y: override.y } : node;
  });
  const edges = buildMeshGraphEdgesFromNodes(nodes, modelEdges);
  return {
    ...layout,
    nodes,
    edges,
    visibleEdgeCount: edges.length,
  };
}

/** Pure bipartite layout for the interactive SVG canvas. */
export function layoutMeshBipartiteGraph(
  model: MeshGraphModel,
  options?: {
    width?: number;
    height?: number;
    maxAgents?: number;
    maxGroups?: number;
  },
): MeshBipartiteLayout {
  const width = options?.width ?? 760;
  const height = options?.height ?? 340;
  const maxAgents = options?.maxAgents ?? 10;
  const maxGroups = options?.maxGroups ?? 8;
  const agents = model.agents.slice(0, maxAgents);
  const groups = model.groups.slice(0, maxGroups);
  const centerX = width / 2;
  const leftX = groups.length === 0 ? centerX : 118;
  const rightX = agents.length === 0 ? centerX : width - 118;
  const agentYs = distributeY(agents.length, height, 42, 28);
  const groupYs = distributeY(groups.length, height, 42, 28);
  const maxIntensity = Math.max(...agents.map((entry) => entry.intensity), 1);

  const nodes: MeshBipartiteLayoutNode[] = [
    ...agents.map((agent, index) => ({
      id: agent.id,
      kind: "agent" as const,
      name: agent.name,
      meta: `${agent.statusLabel} · 会话 ${agent.sessionCount}`,
      x: leftX,
      y: agentYs[index] ?? height / 2,
      r: 10 + Math.round((agent.intensity / maxIntensity) * 6),
    })),
    ...groups.map((group, index) => ({
      id: group.id,
      kind: "group" as const,
      name: group.name,
      meta: `成员 ${group.humanCount} · 机器人 ${group.botCount}`,
      x: rightX,
      y: groupYs[index] ?? height / 2,
      r: 12 + Math.min(group.botCount, 4),
    })),
  ];

  const edges = buildMeshGraphEdgesFromNodes(nodes, model.edges);

  return {
    width,
    height,
    nodes,
    edges,
    truncatedAgents: Math.max(0, model.agents.length - agents.length),
    truncatedGroups: Math.max(0, model.groups.length - groups.length),
    visibleEdgeCount: edges.length,
  };
}

export function buildMeshObjectHref(
  basePath: string,
  tenantId: string | null,
  kind: "agents" | "groups",
  id: string,
) {
  return meshObjectHref(basePath, tenantId, kind, id);
}

/** Pure model builder — unit-tested without Lit. */
export function buildMeshGraphModel(params: {
  readModel: EnterprisePortReadModel;
  agentsList?: AgentsListResult | null;
  collaborationSpacesResult?: CollaborationSpacesListResult | null;
}): MeshGraphModel {
  const { readModel, agentsList, collaborationSpacesResult } = params;
  const meshAgentById = new Map(
    readModel.meshAgents.map((entry) => [entry.agentId, entry] as const),
  );
  const spaces = collaborationSpacesResult?.spaces ?? [];

  const agentRows =
    agentsList?.agents?.filter((agent) => {
      const scope = agent.scope?.trim().toLowerCase();
      return scope !== "shared" && scope !== "team";
    }) ?? [];

  const agents: MeshGraphAgentNode[] =
    agentRows.length > 0
      ? agentRows.map((agent) => {
          const mesh = meshAgentById.get(agent.id) ?? null;
          const sessionCount = mesh?.sessionCount ?? 0;
          const groupCount = mesh?.groupCount ?? 0;
          const totalCost = mesh?.totalCost ?? 0;
          return {
            id: agent.id,
            name: agent.name?.trim() || agent.identity?.name?.trim() || mesh?.name || agent.id,
            sessionCount,
            groupCount,
            totalCost,
            statusLabel: agentStatusLabel(mesh),
            intensity: totalCost * 10 + sessionCount,
          };
        })
      : readModel.meshAgents.map((mesh) => ({
          id: mesh.agentId,
          name: mesh.name,
          sessionCount: mesh.sessionCount,
          groupCount: mesh.groupCount,
          totalCost: mesh.totalCost,
          statusLabel: agentStatusLabel(mesh),
          intensity: mesh.totalCost * 10 + mesh.sessionCount,
        }));

  agents.sort((left, right) => right.intensity - left.intensity);

  const groups: MeshGraphGroupNode[] = [];
  const edges: MeshGraphEdge[] = [];
  const agentNameById = new Map(agents.map((entry) => [entry.id, entry.name] as const));

  if (spaces.length > 0) {
    for (const space of spaces) {
      const groupId = (space.groupId ?? space.id).trim();
      if (!groupId) {
        continue;
      }
      const bots = activeBots(space);
      const mesh = findMeshGroup(readModel, groupId);
      const name = resolveCollaborationGroupDisplayName(
        readModel,
        groupId,
        collaborationSpacesResult,
      );
      groups.push({
        id: groupId,
        name,
        humanCount: activeHumans(space),
        botCount: bots.length,
        sessionCount: mesh?.sessionCount ?? 0,
        totalCost: mesh?.totalCost ?? 0,
      });
      for (const bot of bots) {
        const agentId = bot.agentId?.trim();
        if (!agentId) {
          continue;
        }
        edges.push({
          agentId,
          agentName:
            bot.name?.trim() ||
            resolveAgentDisplayName({
              agentId,
              agentsList,
              meshAgent: meshAgentById.get(agentId),
            }) ||
            agentNameById.get(agentId) ||
            agentId,
          groupId,
          groupName: name,
        });
      }
    }
  } else {
    for (const mesh of readModel.meshGroups) {
      const name = resolveCollaborationGroupDisplayName(
        readModel,
        mesh.groupId,
        collaborationSpacesResult,
      );
      groups.push({
        id: mesh.groupId,
        name,
        humanCount: mesh.memberCount,
        botCount: mesh.agentCount,
        sessionCount: mesh.sessionCount,
        totalCost: mesh.totalCost,
      });
    }
  }

  groups.sort(
    (left, right) =>
      right.sessionCount - left.sessionCount ||
      right.botCount - left.botCount ||
      left.name.localeCompare(right.name, "zh"),
  );

  edges.sort(
    (left, right) =>
      left.groupName.localeCompare(right.groupName, "zh") ||
      left.agentName.localeCompare(right.agentName, "zh"),
  );

  return { agents, groups, edges };
}
