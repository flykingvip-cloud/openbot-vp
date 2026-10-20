/**
 * P2 Feed daily digest — aggregates discovery / nextActions / recommendations
 * into a lightweight daily readout (no new primary model).
 */
import type { KnowledgeActionSuggestion } from "../actions/types.js";
import type { KnowledgeDiscoveryEvent } from "../discovery/types.js";
import type { KnowledgeRecommendation } from "../types.js";

export type KnowledgeFeedDigestHighlight = {
  kind: "discovery" | "action" | "recommendation";
  title: string;
  summary: string;
  timestamp: number;
  refId?: string;
};

export type KnowledgeFeedDigestCounts = {
  newKnowledge: number;
  governance: number;
  relations: number;
  usage: number;
  actions: number;
  recommendations: number;
};

export type KnowledgeFeedDigest = {
  dayKey: string;
  generatedAt: number;
  headline: string;
  counts: KnowledgeFeedDigestCounts;
  highlights: KnowledgeFeedDigestHighlight[];
};

function dayKeyOf(timestamp: number): string {
  const d = new Date(timestamp);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function isToday(timestamp: number, now: number): boolean {
  return dayKeyOf(timestamp) === dayKeyOf(now);
}

export function buildKnowledgeFeedDailyDigest(params: {
  discoveryEvents: KnowledgeDiscoveryEvent[];
  actions?: KnowledgeActionSuggestion[];
  recommendations?: KnowledgeRecommendation[];
  now?: number;
  maxHighlights?: number;
}): KnowledgeFeedDigest {
  const now = params.now ?? Date.now();
  const dayKey = dayKeyOf(now);
  const maxHighlights = params.maxHighlights ?? 8;

  const todayEvents = params.discoveryEvents.filter((event) => isToday(event.timestamp, now));
  const counts: KnowledgeFeedDigestCounts = {
    newKnowledge: todayEvents.filter(
      (e) => e.eventType === "knowledge_committed" || e.eventType === "deliverable_completed",
    ).length,
    governance: todayEvents.filter((e) =>
      [
        "new_conflict",
        "new_claim_conflict",
        "new_duplicate",
        "stale_detected",
        "orphan_detected",
      ].includes(e.eventType),
    ).length,
    relations: todayEvents.filter((e) => e.eventType === "new_relation").length,
    usage: todayEvents.filter((e) => e.eventType === "frequently_cited").length,
    actions: params.actions?.length ?? 0,
    recommendations: params.recommendations?.length ?? 0,
  };

  const highlights: KnowledgeFeedDigestHighlight[] = [];
  for (const event of todayEvents.toSorted((a, b) => b.timestamp - a.timestamp)) {
    if (highlights.length >= maxHighlights) {
      break;
    }
    highlights.push({
      kind: "discovery",
      title: event.title,
      summary: event.summary,
      timestamp: event.timestamp,
      refId: event.eventId,
    });
  }
  for (const action of params.actions ?? []) {
    if (highlights.length >= maxHighlights) {
      break;
    }
    highlights.push({
      kind: "action",
      title: action.title,
      summary: action.reason,
      timestamp: now,
      refId: action.actionId,
    });
  }
  for (const rec of params.recommendations ?? []) {
    if (highlights.length >= maxHighlights) {
      break;
    }
    highlights.push({
      kind: "recommendation",
      title: rec.object.title,
      summary: rec.reason,
      timestamp: now,
      refId: rec.object.id,
    });
  }

  const total =
    counts.newKnowledge +
    counts.governance +
    counts.relations +
    counts.usage +
    counts.actions +
    counts.recommendations;
  const headline =
    total === 0
      ? "今日暂无新的知识动态"
      : `今日 ${counts.newKnowledge} 条新增 · ${counts.governance} 条治理 · ${counts.actions} 条建议`;

  return {
    dayKey,
    generatedAt: now,
    headline,
    counts,
    highlights,
  };
}
