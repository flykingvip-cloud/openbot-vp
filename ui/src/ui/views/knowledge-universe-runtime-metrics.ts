import type { KnowledgeGovernanceSummary } from "../capability/knowledge-universe/endpoints.ts";
import type {
  KnowledgeDiscoveryEvent,
  KnowledgeDiscoveryEventType,
} from "../capability/knowledge-universe/types.ts";
import type { KnowledgeBaseSummary } from "../capability/knowledge-universe/workspace-endpoints.ts";
import type { WorkbenchKnowledgeSurface } from "../ports/employee/views/home-page-contracts.ts";

/**
 * Runtime metrics for the knowledge workspace header — the "AI Knowledge
 * Runtime" view treats a space as a live runtime boundary, not a file folder.
 * Every value is derived from real backend telemetry surfaced on the selected
 * knowledge base (chunks/relations/citations/active agents from
 * {@link KnowledgeBaseSummary}) plus the governance summary (open tasks +
 * health). All derivations degrade gracefully to 0 / 100 when a space has not
 * been indexed yet.
 */
export type KnowledgeRuntimeMetrics = {
  /** 知识片段 — indexed chunk count. */
  chunkCount: number;
  /** 关系数量 — chunk relation edges. */
  relationCount: number;
  /** 活跃 Agent — distinct agents that consumed/cited the space (lineage). */
  activeAgentCount: number;
  /** 引用次数 — total retrieval citations (sum of chunk reference_count). */
  citationCount: number;
  /** 治理任务 — open governance tasks awaiting resolution. */
  openGovernanceTaskCount: number;
  /** 知识健康度 — 0..100 health score. */
  healthScore: number;
};

/**
 * Mirrors the backend `computeKnowledgeHealthScore` penalty model so the header
 * gauge matches the governance health score exactly.
 */
function healthScoreFromSummary(summary: KnowledgeGovernanceSummary): number {
  const penalties =
    summary.openConflictCount * 8 +
    summary.openClaimConflictCount * 6 +
    summary.openDuplicateCount * 4 +
    summary.openStaleCount * 3 +
    summary.openOrphanCount * 2;
  return Math.max(0, Math.min(100, 100 - penalties));
}

function openGovernanceTaskCountFromSummary(summary: KnowledgeGovernanceSummary): number {
  return (
    summary.openConflictCount +
    summary.openClaimConflictCount +
    summary.openDuplicateCount +
    summary.openOrphanCount +
    summary.openStaleCount
  );
}

export function computeKnowledgeRuntimeMetrics(
  surface: Pick<WorkbenchKnowledgeSurface, "governanceSummary" | "governanceTasks">,
  kb: KnowledgeBaseSummary | null,
): KnowledgeRuntimeMetrics {
  const summary = surface.governanceSummary;

  const chunkCount = kb?.chunkCount ?? summary?.indexedChunkCount ?? 0;
  const relationCount = kb?.relationCount ?? 0;
  const activeAgentCount = kb?.activeAgentCount ?? 0;
  const citationCount = kb?.citationCount ?? 0;

  const openGovernanceTaskCount = summary
    ? openGovernanceTaskCountFromSummary(summary)
    : surface.governanceTasks.filter((task) => task.status === "open").length;

  const healthScore = summary ? healthScoreFromSummary(summary) : (kb?.healthScore ?? 100);

  return {
    chunkCount,
    relationCount,
    activeAgentCount,
    citationCount,
    openGovernanceTaskCount,
    healthScore,
  };
}

export function knowledgeRuntimeHealthTone(score: number): "good" | "fair" | "poor" {
  if (score >= 80) {
    return "good";
  }
  if (score >= 60) {
    return "fair";
  }
  return "poor";
}

/**
 * Workspace runtime trends — the bottom trend row reframes the space as a living
 * runtime by visualizing recent activity. Series are derived from the real
 * `discoveryEvents` feed (governance/lineage/usage projections) bucketed by day,
 * with a week-over-week delta computed from the same window. No fabricated
 * cumulative numbers: totals reflect the discovery window only.
 */
export type WorkspaceTrendSeries = {
  /** Total events in the window for this category. */
  total: number;
  /** Per-day counts, oldest first, newest last. */
  buckets: number[];
  /** Week-over-week delta (%), or null when the prior week had no activity. */
  deltaPct: number | null;
};

export type WorkspaceTrends = {
  evolution: WorkspaceTrendSeries;
  relations: WorkspaceTrendSeries;
  citations: WorkspaceTrendSeries;
  governance: WorkspaceTrendSeries;
};

export const WORKSPACE_TREND_DAYS = 14;

const TREND_DAY_MS = 86_400_000;

type WorkspaceTrendCategory = keyof WorkspaceTrends;

function categorizeTrendEvent(
  eventType: KnowledgeDiscoveryEventType,
): WorkspaceTrendCategory | null {
  switch (eventType) {
    case "knowledge_committed":
    case "deliverable_completed":
      return "evolution";
    case "new_relation":
      return "relations";
    case "frequently_cited":
      return "citations";
    case "new_conflict":
    case "new_duplicate":
    case "new_claim_conflict":
    case "stale_detected":
    case "orphan_detected":
      return "governance";
    default:
      return null;
  }
}

function finalizeTrendSeries(buckets: number[]): WorkspaceTrendSeries {
  const total = buckets.reduce((sum, count) => sum + count, 0);
  const half = Math.floor(WORKSPACE_TREND_DAYS / 2);
  const prior = buckets.slice(0, half).reduce((sum, count) => sum + count, 0);
  const recent = buckets.slice(WORKSPACE_TREND_DAYS - half).reduce((sum, count) => sum + count, 0);
  const deltaPct = prior > 0 ? Math.round(((recent - prior) / prior) * 100) : null;
  return { total, buckets, deltaPct };
}

export function computeWorkspaceTrends(
  events: ReadonlyArray<Pick<KnowledgeDiscoveryEvent, "eventType" | "timestamp">>,
  now: number = Date.now(),
): WorkspaceTrends {
  const series: Record<WorkspaceTrendCategory, number[]> = {
    evolution: Array.from({ length: WORKSPACE_TREND_DAYS }, () => 0),
    relations: Array.from({ length: WORKSPACE_TREND_DAYS }, () => 0),
    citations: Array.from({ length: WORKSPACE_TREND_DAYS }, () => 0),
    governance: Array.from({ length: WORKSPACE_TREND_DAYS }, () => 0),
  };
  const todayIndex = Math.floor(now / TREND_DAY_MS);
  for (const event of events) {
    const category = categorizeTrendEvent(event.eventType);
    if (!category || !event.timestamp) {
      continue;
    }
    const daysAgo = todayIndex - Math.floor(event.timestamp / TREND_DAY_MS);
    if (daysAgo < 0 || daysAgo >= WORKSPACE_TREND_DAYS) {
      continue;
    }
    const index = WORKSPACE_TREND_DAYS - 1 - daysAgo;
    series[category][index] = (series[category][index] ?? 0) + 1;
  }
  return {
    evolution: finalizeTrendSeries(series.evolution),
    relations: finalizeTrendSeries(series.relations),
    citations: finalizeTrendSeries(series.citations),
    governance: finalizeTrendSeries(series.governance),
  };
}
