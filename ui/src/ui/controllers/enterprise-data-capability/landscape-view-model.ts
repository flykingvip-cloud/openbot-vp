/**
 * 企业数据能力中心 — 资产全景图专用 view model + 列式四层布局（Task 3.2）。
 *
 * **不复用**知识宇宙的 GraphViewModel/buildHomeGraphViewModel（节点种类与中心辐射布局不匹配）。
 * 列式布局：数据源列 → 能力列 → 知识列 → 部门/岗位/角色列。仅供 SVG 渲染消费。
 *
 * @module enterprise-data-capability/landscape-view-model
 */

import type {
  AssetLandscapeEdge,
  AssetLandscapeGraph,
  AssetLandscapeNode,
} from "../../capability/enterprise-data-capability/types.ts";

export type LandscapeColumnIndex = 0 | 1 | 2 | 3;

export type PositionedLandscapeNode = AssetLandscapeNode & {
  column: LandscapeColumnIndex;
  x: number;
  y: number;
};

export type PositionedLandscapeEdge = AssetLandscapeEdge & {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
};

export type LandscapeViewModel = {
  width: number;
  height: number;
  nodes: PositionedLandscapeNode[];
  edges: PositionedLandscapeEdge[];
};

const COLUMN_OF_KIND: Record<AssetLandscapeNode["kind"], LandscapeColumnIndex> = {
  source: 0,
  capability: 1,
  knowledge: 2,
  department: 3,
  seat: 3,
  role: 3,
};

const COLUMN_X = [90, 320, 550, 790] as const;
const ROW_GAP = 56;
const ROW_TOP = 48;
const NODE_WIDTH = 150;
const NODE_HEIGHT = 34;

/** 节点配色（决策稿）：source=蓝 / capability=绿 / knowledge=紫 / 部门岗位角色=橙。 */
export function landscapeNodeTone(
  kind: AssetLandscapeNode["kind"],
): "blue" | "green" | "purple" | "amber" {
  if (kind === "source") {
    return "blue";
  }
  if (kind === "capability") {
    return "green";
  }
  if (kind === "knowledge") {
    return "purple";
  }
  return "amber";
}

export function buildLandscapeViewModel(graph: AssetLandscapeGraph): LandscapeViewModel {
  const columns: AssetLandscapeNode[][] = [[], [], [], []];
  for (const node of graph.nodes) {
    columns[COLUMN_OF_KIND[node.kind]].push(node);
  }

  const positioned = new Map<string, PositionedLandscapeNode>();
  columns.forEach((columnNodes, columnIndex) => {
    columnNodes.forEach((node, rowIndex) => {
      positioned.set(node.id, {
        ...node,
        column: columnIndex as LandscapeColumnIndex,
        x: COLUMN_X[columnIndex],
        y: ROW_TOP + rowIndex * ROW_GAP,
      });
    });
  });

  const maxRows = Math.max(1, ...columns.map((column) => column.length));
  const height = ROW_TOP + maxRows * ROW_GAP;
  const width = COLUMN_X[3] + NODE_WIDTH + 40;

  const edges: PositionedLandscapeEdge[] = [];
  for (const edge of graph.edges) {
    const from = positioned.get(edge.from);
    const to = positioned.get(edge.to);
    if (!from || !to) {
      continue;
    }
    edges.push({
      ...edge,
      x1: from.x + NODE_WIDTH,
      y1: from.y + NODE_HEIGHT / 2,
      x2: to.x,
      y2: to.y + NODE_HEIGHT / 2,
    });
  }

  return { width, height, nodes: [...positioned.values()], edges };
}

export const LANDSCAPE_NODE_WIDTH = NODE_WIDTH;
export const LANDSCAPE_NODE_HEIGHT = NODE_HEIGHT;

export type LandscapeNeighbors = {
  node: AssetLandscapeNode;
  /** 入边来源节点（如能力的来源数据源）。 */
  incoming: Array<{ node: AssetLandscapeNode; relation: AssetLandscapeEdge["relation"] }>;
  /** 出边目标节点（如能力生成的知识、数据源开放的部门）。 */
  outgoing: Array<{ node: AssetLandscapeNode; relation: AssetLandscapeEdge["relation"] }>;
};

/** 从已加载的图就地计算某节点的邻居（Drawer 用，无需额外 RPC）。 */
export function resolveLandscapeNeighbors(
  graph: AssetLandscapeGraph,
  nodeId: string,
): LandscapeNeighbors | null {
  const nodeById = new Map(graph.nodes.map((node) => [node.id, node] as const));
  const node = nodeById.get(nodeId);
  if (!node) {
    return null;
  }
  const incoming: LandscapeNeighbors["incoming"] = [];
  const outgoing: LandscapeNeighbors["outgoing"] = [];
  for (const edge of graph.edges) {
    if (edge.to === nodeId) {
      const from = nodeById.get(edge.from);
      if (from) {
        incoming.push({ node: from, relation: edge.relation });
      }
    }
    if (edge.from === nodeId) {
      const to = nodeById.get(edge.to);
      if (to) {
        outgoing.push({ node: to, relation: edge.relation });
      }
    }
  }
  return { node, incoming, outgoing };
}
