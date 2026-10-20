import { relationshipGraphToViewModel } from "./graph-view-model.ts";
import type { GraphViewEdge, GraphViewModel, GraphViewNode, RelationshipGraph } from "./types.ts";

const DEFAULT_WIDTH = 720;
/** Tall enough for 2-line node labels under the outer ring without clipping the viewBox. */
const DEFAULT_HEIGHT = 480;
/** Vertical room reserved under each node for up to two label lines. */
const LABEL_RESERVE_PX = 52;
const EDGE_PAD_PX = 18;

/**
 * Soft-wrap a node title into at most two SVG label lines.
 * Prefers breaks at spaces / light punctuation; ellipsizes the last line when needed.
 */
export function formatGraphNodeLabelLines(
  title: string,
  options?: { maxCharsPerLine?: number; maxLines?: number },
): string[] {
  const maxCharsPerLine = options?.maxCharsPerLine ?? 14;
  const maxLines = options?.maxLines ?? 2;
  const normalized = title.replace(/\s+/g, " ").trim();
  if (!normalized) {
    return [""];
  }
  if (normalized.length <= maxCharsPerLine) {
    return [normalized];
  }

  const lines: string[] = [];
  let rest = normalized;
  while (rest.length > 0 && lines.length < maxLines) {
    if (lines.length === maxLines - 1) {
      if (rest.length > maxCharsPerLine) {
        lines.push(`${rest.slice(0, Math.max(1, maxCharsPerLine - 1))}…`);
      } else {
        lines.push(rest);
      }
      break;
    }
    const window = rest.slice(0, maxCharsPerLine + 1);
    const breakCandidates = [" ", "·", "-", "/", "（", "(", "—", "："].map((token) =>
      window.lastIndexOf(token),
    );
    const punct = Math.max(...breakCandidates);
    if (punct >= Math.floor(maxCharsPerLine * 0.45)) {
      const consumeSpace = window[punct] === " ";
      lines.push(rest.slice(0, punct + (consumeSpace ? 0 : 1)).trimEnd());
      rest = rest.slice(punct + 1).trimStart();
      continue;
    }
    lines.push(rest.slice(0, maxCharsPerLine));
    rest = rest.slice(maxCharsPerLine);
  }
  return lines;
}

function categoryForNodeKind(
  kind: RelationshipGraph["nodes"][number]["kind"],
): GraphViewNode["category"] {
  if (kind === "knowledge-base") {
    return "knowledge-base";
  }
  if (kind === "deliverable") {
    return "deliverable";
  }
  if (kind === "data-capability") {
    return "data";
  }
  if (kind === "agent") {
    return "agent";
  }
  if (kind === "project") {
    return "project";
  }
  if (kind === "owner") {
    return "owner";
  }
  return "knowledge";
}

export function buildRadialGraphLayout(
  graph: RelationshipGraph,
  options?: {
    width?: number;
    height?: number;
    centerNodeId?: string;
  },
): GraphViewModel {
  const width = options?.width ?? DEFAULT_WIDTH;
  const height = options?.height ?? DEFAULT_HEIGHT;
  const centerX = width / 2;
  const centerY = height / 2;
  const centerNodeId = options?.centerNodeId ?? "node:me";
  const nodes = graph.nodes;
  const center = nodes.find((node) => node.id === centerNodeId) ?? nodes[0];
  const others = nodes.filter((node) => node.id !== center?.id);
  const ringOne = others.slice(0, 3);
  const ringTwo = others.slice(3);

  const positioned = new Map<string, { x: number; y: number; radius: number }>();
  if (center) {
    positioned.set(center.id, { x: centerX, y: centerY, radius: 34 });
  }

  ringOne.forEach((node, index) => {
    const angle = -Math.PI / 2 + (index * (2 * Math.PI)) / Math.max(ringOne.length, 1);
    positioned.set(node.id, {
      x: centerX + Math.cos(angle) * 130,
      y: centerY + Math.sin(angle) * 110,
      radius: 28,
    });
  });

  ringTwo.forEach((node, index) => {
    const angle = -Math.PI / 3 + (index * (2 * Math.PI)) / Math.max(ringTwo.length, 1);
    positioned.set(node.id, {
      x: centerX + Math.cos(angle) * 210,
      // Keep outer-ring nodes above the 2-line label reserve so titles aren't clipped.
      y: centerY + Math.sin(angle) * 150,
      radius: 24,
    });
  });

  for (const [id, point] of positioned) {
    const minY = point.radius + EDGE_PAD_PX;
    const maxY = height - LABEL_RESERVE_PX - EDGE_PAD_PX;
    const minX = point.radius + EDGE_PAD_PX;
    const maxX = width - point.radius - EDGE_PAD_PX;
    positioned.set(id, {
      ...point,
      x: Math.min(maxX, Math.max(minX, point.x)),
      y: Math.min(maxY, Math.max(minY, point.y)),
    });
  }

  const viewNodes: GraphViewNode[] = nodes
    .map((node) => {
      const point = positioned.get(node.id);
      if (!point) {
        return null;
      }
      return {
        id: node.id,
        x: point.x,
        y: point.y,
        radius: point.radius,
        label: node.title,
        category: categoryForNodeKind(node.kind),
        // Omit objectId when absent so the literal stays assignable to GraphViewNode
        // under exactOptionalPropertyTypes (objectId?: string, not string | undefined).
        ...(node.objectId !== undefined ? { objectId: node.objectId } : {}),
        ...(node.governance !== undefined ? { governance: node.governance } : {}),
      };
    })
    .filter((node): node is GraphViewNode => node !== null);

  const viewEdges: GraphViewEdge[] = graph.edges.map((edge, index) => ({
    id: `edge:${index}:${edge.sourceId}:${edge.targetId}`,
    sourceId: edge.sourceId,
    targetId: edge.targetId,
    score: edge.score,
    relationType: edge.relationType,
  }));

  return {
    width,
    height,
    nodes: viewNodes,
    edges: viewEdges,
  };
}

export function buildHomeGraphViewModel(graph: RelationshipGraph): GraphViewModel {
  return relationshipGraphToViewModel(graph, buildRadialGraphLayout(graph));
}
