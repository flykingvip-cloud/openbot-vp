import type { TaskHandoff } from "./effective-policy.js";
import { InvalidTaskHandoffError, normalizeTaskHandoff } from "./task-runtime.js";

/** Same-round Bot→Bot edges attached after PRIMARY_COMPLETED. Depth is always 1. */
export type CollabEdgeKind = "peer_ask" | "handoff" | "challenge" | "request_review";

export type CollabEdge = {
  kind: CollabEdgeKind;
  fromAgentId: string;
  toAgentId: string;
  reason: string;
  depth: 1;
  /** Present when kind === "handoff" — reused by task-runtime normalize/apply. */
  handoff?: TaskHandoff;
};

export const MAX_COLLAB_EDGES_PER_ROUND = 2;

const EDGE_KINDS = new Set<CollabEdgeKind>(["peer_ask", "handoff", "challenge", "request_review"]);

/**
 * Compact directive emitted by bots, e.g.
 * [[collab_edge:challenge|to=bot-b|reason=风险未覆盖]]
 * [[collab_edge:handoff|to=bot-c|reason=owner_transfer|remaining=写验收|acceptance=通过评审]]
 */
const COLLAB_EDGE_RE =
  /\[\[\s*collab_edge\s*:\s*(peer_ask|handoff|challenge|request_review)\s*\|([^\]\n]+)\]\]/gi;

function compact(value: string | null | undefined): string {
  return value?.trim() ?? "";
}

function parseEdgeFields(raw: string): Record<string, string> {
  const fields: Record<string, string> = {};
  for (const part of raw.split("|")) {
    const trimmed = part.trim();
    if (!trimmed) {
      continue;
    }
    const eq = trimmed.indexOf("=");
    if (eq <= 0) {
      continue;
    }
    const key = trimmed.slice(0, eq).trim().toLowerCase();
    const value = trimmed.slice(eq + 1).trim();
    if (key && value) {
      fields[key] = value;
    }
  }
  return fields;
}

export function isCollabEdgeKind(value: string): value is CollabEdgeKind {
  return EDGE_KINDS.has(value as CollabEdgeKind);
}

export function hasCollabEdgeDirective(text: string | undefined): boolean {
  if (!text) {
    return false;
  }
  return new RegExp(COLLAB_EDGE_RE.source, "i").test(text);
}

export function stripCollabEdgeDirectives(text: string): string {
  return text
    .replace(COLLAB_EDGE_RE, "")
    .replace(/[ \t]+\n/g, "\n")
    .trim();
}

/**
 * Resolve a `to=` value (agentId, display name, or `@name`) to a group bot agentId.
 * Bots only see display names in chat, so name targets must work end-to-end.
 */
export function createCollabEdgeTargetResolver(
  bots: ReadonlyArray<{ agentId: string; name?: string | null }>,
): (raw: string) => string | null {
  const normalize = (value: string | null | undefined) =>
    value
      ?.trim()
      .replace(/^@+/, "")
      .replace(/[\s「」『』"'`]+/g, "")
      .toLowerCase() ?? "";
  return (raw: string) => {
    const target = normalize(raw);
    if (!target) {
      return null;
    }
    const byId = bots.find((bot) => normalize(bot.agentId) === target);
    if (byId) {
      return byId.agentId;
    }
    const byName = bots.find((bot) => normalize(bot.name) === target);
    return byName?.agentId ?? null;
  };
}

export function parseCollabEdgesFromText(params: {
  text: string;
  fromAgentId: string;
  taskId?: string | null;
  /**
   * Map `to=` onto a group bot. When provided, targets that do not resolve to a
   * bot in this group are dropped (no edges to outsiders / typos).
   */
  resolveTargetAgentId?: (raw: string) => string | null;
}): { edges: CollabEdge[]; visibleText: string } {
  const fromAgentId = compact(params.fromAgentId);
  const edges: CollabEdge[] = [];
  const seen = new Set<string>();
  let match: RegExpExecArray | null;
  const re = new RegExp(COLLAB_EDGE_RE.source, COLLAB_EDGE_RE.flags);
  while ((match = re.exec(params.text)) !== null) {
    const kind = match[1]?.toLowerCase() as CollabEdgeKind;
    if (!isCollabEdgeKind(kind)) {
      continue;
    }
    const fields = parseEdgeFields(match[2] ?? "");
    const rawTo = compact(fields.to);
    const toAgentId = params.resolveTargetAgentId
      ? compact(params.resolveTargetAgentId(rawTo))
      : rawTo;
    const reason = compact(fields.reason) || kind;
    if (!fromAgentId || !toAgentId || fromAgentId === toAgentId) {
      continue;
    }
    const dedupeKey = `${kind}|${fromAgentId}|${toAgentId}|${reason}`;
    if (seen.has(dedupeKey)) {
      continue;
    }
    seen.add(dedupeKey);
    const edge: CollabEdge = {
      kind,
      fromAgentId,
      toAgentId,
      reason,
      depth: 1,
    };
    if (kind === "handoff") {
      try {
        edge.handoff = normalizeTaskHandoff({
          taskId: compact(params.taskId) || "round-handoff",
          from: fromAgentId,
          to: toAgentId,
          reason,
          remainingWork: compact(fields.remaining) || reason,
          acceptanceCriteria: compact(fields.acceptance)
            ? compact(fields.acceptance)
                .split(/[,，;；]/)
                .map((s) => s.trim())
                .filter(Boolean)
            : [reason],
          completedArtifacts: compact(fields.artifacts)
            ? compact(fields.artifacts)
                .split(/[,，;；]/)
                .map((s) => s.trim())
                .filter(Boolean)
            : [],
        });
      } catch (err) {
        if (err instanceof InvalidTaskHandoffError) {
          continue;
        }
        throw err;
      }
    }
    edges.push(edge);
  }
  return {
    edges: budgetCollabEdges(edges),
    visibleText: stripCollabEdgeDirectives(params.text),
  };
}

/** Cap ≤2 edges per round; depth is always 1 (no chaining). */
export function budgetCollabEdges(edges: readonly CollabEdge[]): CollabEdge[] {
  const kept: CollabEdge[] = [];
  const targets = new Set<string>();
  for (const edge of edges) {
    if (kept.length >= MAX_COLLAB_EDGES_PER_ROUND) {
      break;
    }
    if (edge.depth !== 1) {
      continue;
    }
    const targetKey = `${edge.kind}|${edge.toAgentId}`;
    if (targets.has(targetKey)) {
      continue;
    }
    targets.add(targetKey);
    kept.push({ ...edge, depth: 1 });
  }
  return kept;
}

export function collabEdgeContributionRole(
  kind: CollabEdgeKind,
): "challenge" | "supplement" | "executor" {
  if (kind === "challenge" || kind === "request_review") {
    return "challenge";
  }
  if (kind === "handoff") {
    return "executor";
  }
  return "supplement";
}
