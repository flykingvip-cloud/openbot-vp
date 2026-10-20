import { html, nothing } from "lit";
import { t } from "../../i18n/index.ts";
import { graphGovernanceStatusLabel } from "../capability/knowledge-universe/node-kind-labels.ts";
import type {
  KnowledgeActionSuggestion,
  KnowledgeObject,
  KnowledgeRelatedGroups,
  RelationshipEdgeType,
  RelationshipGraph,
  RelationshipNodeGovernance,
} from "../capability/knowledge-universe/types.ts";
import {
  type KnowledgeInsightCardDiscovery,
  type KnowledgeInsightTrustLevel,
  renderKnowledgeInsightCard,
} from "./knowledge-universe-insight-card.ts";

export type { KnowledgeInsightTrustLevel };
export type KnowledgeDetailDiscovery = KnowledgeInsightCardDiscovery;

export type KnowledgeDetailHealth = {
  score: number;
  stars: number;
  statusLabel: string;
  summary: string;
  bullets: string[];
  tone: "ok" | "warn" | "critical";
};

export type KnowledgeDetailInsights = {
  health: KnowledgeDetailHealth;
  discoveries: KnowledgeDetailDiscovery[];
};

const RELATION_REASON_KEY: Partial<Record<RelationshipEdgeType, string>> = {
  related: "related",
  supports: "supports",
  conflicts: "conflicts",
  "derived-from": "derivedFrom",
  "archived-into": "archivedInto",
  "owned-by": "ownedBy",
  "used-by": "usedBy",
  "recommended-for": "recommendedFor",
};

const REASON_TOKEN_LABEL: Record<string, string> = {
  "shared-tags": "sharedTags",
  "shared-project-context": "sharedProjectContext",
  "shared-scope": "sharedScope",
  "explicit-reference": "explicitReference",
  "capability-scenario": "capabilityScenario",
  "visible-agent": "visibleAgent",
  "agent-topic-overlap": "agentTopicOverlap",
  "owner-link": "ownerLink",
};

function relationExplainReason(type: RelationshipEdgeType): string {
  const key = RELATION_REASON_KEY[type] ?? "related";
  return t(`frontstage.workbench.knowledgeUniverse.detail.relationExplain.${key}`);
}

export function humanizeRelationReason(reason: string): string | null {
  if (reason.startsWith("conflict:")) {
    const detail = reason.slice("conflict:".length);
    if (detail === "same-topic-divergent-summary") {
      return t(
        "frontstage.workbench.knowledgeUniverse.detail.conflictReason.sameTopicDivergentSummary",
      );
    }
    if (detail.includes("/")) {
      return t("frontstage.workbench.knowledgeUniverse.detail.conflictReason.markerPair", {
        pair: detail,
      });
    }
    return t("frontstage.workbench.knowledgeUniverse.detail.conflictReason.generic");
  }
  const separator = reason.indexOf(":");
  const key = separator >= 0 ? reason.slice(0, separator) : reason;
  const detail = separator >= 0 ? reason.slice(separator + 1) : "";
  const labelKey = REASON_TOKEN_LABEL[key];
  if (!labelKey) {
    return null;
  }
  const label = t(`frontstage.workbench.knowledgeUniverse.detail.relationReason.${labelKey}`);
  const readableDetail = detail
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean)
    .join("、");
  return readableDetail ? `${label}：${readableDetail}` : label;
}

function tieReasonText(reasons: string[] | undefined, relationType: RelationshipEdgeType): string {
  for (const reason of reasons ?? []) {
    const humanized = humanizeRelationReason(reason);
    if (humanized) {
      return humanized;
    }
  }
  return relationExplainReason(relationType);
}

function buildEvidence(
  reasons: string[] | undefined,
  relationType: RelationshipEdgeType,
): string[] {
  const items: string[] = [];
  for (const reason of reasons ?? []) {
    const humanized = humanizeRelationReason(reason);
    if (humanized) {
      items.push(humanized);
    }
  }
  if (items.length === 0) {
    items.push(relationExplainReason(relationType));
  }
  return items;
}

export function scoreToTrustLevel(score: number): KnowledgeInsightTrustLevel {
  if (score >= 85) {
    return "high";
  }
  if (score >= 65) {
    return "medium";
  }
  return "low";
}

function actionButtonLabel(action: KnowledgeActionSuggestion): string {
  const key = `frontstage.workbench.knowledgeUniverse.actions.button.${action.actionType}`;
  const translated = t(key);
  return translated === key ? action.title : translated;
}

function isConflictAction(action: KnowledgeActionSuggestion): boolean {
  return action.actionType === "review_conflict" || action.actionType === "merge_duplicate";
}

const MAX_EDGE_DISCOVERIES = 4;

function discoveryPriority(discovery: KnowledgeDetailDiscovery): number {
  if (discovery.tone === "warn") {
    return 0;
  }
  if (discovery.action && isConflictAction(discovery.action.suggestion)) {
    return 1;
  }
  if (discovery.tone === "info") {
    return 2;
  }
  return 3;
}

function sortDiscoveriesByPriority(
  discoveries: KnowledgeDetailDiscovery[],
): KnowledgeDetailDiscovery[] {
  return discoveries.toSorted((left, right) => discoveryPriority(left) - discoveryPriority(right));
}

function appendEdgeDiscoveries(params: {
  discoveries: KnowledgeDetailDiscovery[];
  graph: RelationshipGraph;
  selectedNodeId: string;
  prioritizeConflicts: boolean;
}): void {
  const nodeById = new Map(params.graph.nodes.map((node) => [node.id, node]));
  const ties = params.graph.edges
    .filter(
      (edge) => edge.sourceId === params.selectedNodeId || edge.targetId === params.selectedNodeId,
    )
    .map((edge) => {
      const otherId = edge.sourceId === params.selectedNodeId ? edge.targetId : edge.sourceId;
      const other = nodeById.get(otherId);
      return other ? { other, edge } : null;
    })
    .filter((tie): tie is NonNullable<typeof tie> => tie !== null);

  const conflictTies = ties
    .filter((tie) => tie.edge.relationType === "conflicts")
    .toSorted((left, right) => right.edge.score - left.edge.score);
  const relatedTies = ties
    .filter((tie) => tie.edge.relationType === "related" && tie.edge.score >= 70)
    .toSorted((left, right) => right.edge.score - left.edge.score);

  const orderedTies = params.prioritizeConflicts
    ? [...conflictTies, ...relatedTies]
    : ties.toSorted((left, right) => right.edge.score - left.edge.score);

  let edgeSlots = MAX_EDGE_DISCOVERIES;
  for (const tie of orderedTies) {
    if (edgeSlots <= 0) {
      break;
    }
    const alreadyCovered = params.discoveries.some((item) =>
      item.headline.includes(tie.other.title),
    );
    if (alreadyCovered) {
      continue;
    }
    if (tie.edge.relationType === "conflicts") {
      params.discoveries.push({
        id: `edge-conflict-${tie.other.id}`,
        tone: "warn",
        headline: t("frontstage.workbench.knowledgeUniverse.detail.insights.conflictHeadline", {
          title: tie.other.title,
        }),
        bullets: [tieReasonText(tie.edge.reasons, tie.edge.relationType)],
        trustLevel: scoreToTrustLevel(tie.edge.score),
        trustScore: tie.edge.score,
        evidence: buildEvidence(tie.edge.reasons, tie.edge.relationType),
      });
      edgeSlots -= 1;
      continue;
    }
    if (tie.edge.relationType === "related" && tie.edge.score >= 70) {
      params.discoveries.push({
        id: `edge-related-${tie.other.id}`,
        tone: "info",
        headline: t("frontstage.workbench.knowledgeUniverse.detail.insights.relatedHeadline", {
          title: tie.other.title,
        }),
        bullets: [tieReasonText(tie.edge.reasons, tie.edge.relationType)],
        trustLevel: scoreToTrustLevel(tie.edge.score),
        trustScore: tie.edge.score,
        evidence: buildEvidence(tie.edge.reasons, tie.edge.relationType),
      });
      edgeSlots -= 1;
    }
  }
}

function computeHealthScore(params: {
  governance: RelationshipNodeGovernance | undefined;
  relationshipSummary: KnowledgeObject["relationshipSummary"];
}): number {
  const governance = params.governance;
  const summary = params.relationshipSummary;
  if (governance?.qualityScore != null) {
    return Math.max(0, Math.min(100, Math.round(governance.qualityScore)));
  }
  let score = 88;
  const conflictCount = governance?.conflictCount ?? summary?.conflictCount ?? 0;
  if (conflictCount > 0) {
    score -= conflictCount * 25;
  }
  if (governance?.freshness === "stale") {
    score -= 12;
  }
  if (governance?.freshness === "expired") {
    score -= 25;
  }
  if (governance?.status === "dormant") {
    score -= 20;
  }
  const relatedCount = summary?.relatedCount ?? 0;
  if (relatedCount === 0) {
    score -= 15;
  } else if (relatedCount >= 5) {
    score += 5;
  }
  return Math.max(0, Math.min(100, score));
}

function healthTone(params: {
  governance: RelationshipNodeGovernance | undefined;
  relationshipSummary: KnowledgeObject["relationshipSummary"];
}): KnowledgeDetailHealth["tone"] {
  const conflictCount =
    params.governance?.conflictCount ?? params.relationshipSummary?.conflictCount ?? 0;
  if (conflictCount > 0 || params.governance?.status === "conflict") {
    return "critical";
  }
  if (
    params.governance?.status === "attention" ||
    params.governance?.freshness === "stale" ||
    params.governance?.freshness === "expired" ||
    params.governance?.status === "dormant"
  ) {
    return "warn";
  }
  return "ok";
}

function discoveryFromAction(action: KnowledgeActionSuggestion): KnowledgeDetailDiscovery {
  const evidence =
    action.evidence && action.evidence.length > 0
      ? action.evidence
      : action.reason
        ? [action.reason]
        : [];
  return {
    id: action.actionId,
    tone: isConflictAction(action) ? "warn" : "info",
    headline: action.title,
    bullets: action.reason ? [action.reason] : [],
    trustLevel: action.trustLabel ?? scoreToTrustLevel(action.score),
    trustScore: action.score,
    evidence,
    action: {
      label: actionButtonLabel(action),
      suggestion: action,
      executable: action.executable,
    },
  };
}

function buildStableNetworkDiscovery(params: {
  objectTitle: string;
  agentCount: number;
  knowledgeCount: number;
  relatedCount: number;
}): KnowledgeDetailDiscovery | null {
  if (params.relatedCount < 2) {
    return null;
  }
  const bullets: string[] = [];
  if (params.agentCount > 0) {
    bullets.push(
      t("frontstage.workbench.knowledgeUniverse.detail.insights.agentRefs", {
        count: params.agentCount,
      }),
    );
  }
  if (params.knowledgeCount > 0) {
    bullets.push(
      t("frontstage.workbench.knowledgeUniverse.detail.insights.knowledgeRefs", {
        count: params.knowledgeCount,
      }),
    );
  }
  bullets.push(
    t("frontstage.workbench.knowledgeUniverse.detail.insights.relatedNetwork", {
      count: params.relatedCount,
    }),
  );
  return {
    id: "stable-network",
    tone: "ok",
    headline: t("frontstage.workbench.knowledgeUniverse.detail.insights.stableHeadline", {
      title: params.objectTitle,
    }),
    bullets,
    trustLevel: "high",
    evidence: bullets,
    action: {
      label: t("frontstage.workbench.knowledgeUniverse.detail.insights.noActionNeeded"),
      suggestion: {
        actionId: "noop-stable",
        actionType: "open_object",
        title: "",
        reason: "",
        score: 100,
        context: {},
        executable: false,
      },
      executable: false,
    },
  };
}

export function buildKnowledgeDetailInsights(params: {
  object: KnowledgeObject | null;
  objectTitle: string;
  governance: RelationshipNodeGovernance | undefined;
  graph: RelationshipGraph | null;
  selectedNodeId: string | null;
  relatedGroups?: KnowledgeRelatedGroups | null;
  focusActions: KnowledgeActionSuggestion[];
}): KnowledgeDetailInsights {
  const summary = params.object?.relationshipSummary;
  const score = computeHealthScore({
    governance: params.governance,
    relationshipSummary: summary,
  });
  const stars = Math.max(1, Math.min(5, Math.round(score / 20)));
  const tone = healthTone({
    governance: params.governance,
    relationshipSummary: summary,
  });
  const conflictCount = params.governance?.conflictCount ?? summary?.conflictCount ?? 0;
  const relatedCount = summary?.relatedCount ?? 0;
  const agentCount = params.relatedGroups?.agents.length ?? 0;
  const knowledgeCount = params.relatedGroups?.knowledge.length ?? 0;
  const usageCount = params.governance?.usageCount;

  const healthBullets: string[] = [];
  healthBullets.push(
    conflictCount > 0
      ? t("frontstage.workbench.knowledgeUniverse.detail.insights.healthHasConflicts", {
          count: conflictCount,
        })
      : t("frontstage.workbench.knowledgeUniverse.detail.insights.healthNoConflicts"),
  );
  if (params.governance?.freshness === "stale" || params.governance?.freshness === "expired") {
    healthBullets.push(t("frontstage.workbench.knowledgeUniverse.detail.healthStale"));
  } else if (params.governance?.freshness === "fresh") {
    healthBullets.push(t("frontstage.workbench.knowledgeUniverse.detail.healthFresh"));
  }
  if (usageCount != null && usageCount > 0) {
    healthBullets.push(
      t("frontstage.workbench.knowledgeUniverse.detail.insights.usageRecent", {
        count: usageCount,
      }),
    );
  } else if (relatedCount > 0) {
    healthBullets.push(
      t("frontstage.workbench.knowledgeUniverse.detail.insights.healthRelatedMeaning", {
        count: relatedCount,
        agents: agentCount,
      }),
    );
  } else {
    healthBullets.push(t("frontstage.workbench.knowledgeUniverse.detail.healthOrphan"));
  }

  const healthSummary =
    tone === "ok"
      ? t("frontstage.workbench.knowledgeUniverse.detail.insights.healthStable")
      : tone === "warn"
        ? t("frontstage.workbench.knowledgeUniverse.detail.insights.healthNeedsAttention")
        : t("frontstage.workbench.knowledgeUniverse.detail.insights.healthConflict");

  const health: KnowledgeDetailHealth = {
    score,
    stars,
    statusLabel: params.governance
      ? graphGovernanceStatusLabel(params.governance.status)
      : t("frontstage.workbench.knowledgeUniverse.detail.insights.healthUnknown"),
    summary: healthSummary,
    bullets: healthBullets,
    tone,
  };

  const discoveries: KnowledgeDetailDiscovery[] = [];
  const actionIds = new Set<string>();

  for (const action of params.focusActions) {
    discoveries.push(discoveryFromAction(action));
    actionIds.add(action.actionId);
  }

  const conflictCountInGroups = params.relatedGroups?.conflicts.length ?? 0;
  if (conflictCount === 0 && conflictCountInGroups === 0 && params.focusActions.length === 0) {
    const stable = buildStableNetworkDiscovery({
      objectTitle: params.objectTitle,
      agentCount,
      knowledgeCount,
      relatedCount,
    });
    if (stable) {
      discoveries.push(stable);
    }
  }

  if (params.graph && params.selectedNodeId) {
    const prioritizeConflicts =
      tone === "critical" ||
      conflictCount > 0 ||
      params.governance?.status === "conflict" ||
      conflictCountInGroups > 0;
    appendEdgeDiscoveries({
      discoveries,
      graph: params.graph,
      selectedNodeId: params.selectedNodeId,
      prioritizeConflicts,
    });
  }

  return {
    health,
    discoveries: sortDiscoveriesByPriority(discoveries),
  };
}

function renderStars(count: number): string {
  return "★".repeat(count) + "☆".repeat(Math.max(0, 5 - count));
}

export function renderKnowledgeDetailInsights(params: {
  insights: KnowledgeDetailInsights;
  variant?: "detail" | "compact";
  maxDiscoveries?: number;
  onExecuteKnowledgeAction?: (action: KnowledgeActionSuggestion) => void;
}) {
  const { health, discoveries } = params.insights;
  const compact = params.variant === "compact";
  const shownDiscoveries = params.maxDiscoveries
    ? discoveries.slice(0, params.maxDiscoveries)
    : discoveries;
  return html`
    <div
      class=${`ku-detail-insights${compact ? " ku-detail-insights--compact" : ""}`}
      data-testid="ku-detail-insights"
    >
      ${
        compact
          ? html`<div class="ku-detail-insights__health-compact" data-testid="ku-detail-health">
              <span
                class=${`ku-detail-insights__health-status ku-detail-insights__health-status--${health.tone}`}
                >${health.statusLabel}</span
              >
              <span class="ku-detail-insights__score"
                >${t("frontstage.workbench.knowledgeUniverse.detail.insights.healthScore", {
                  score: health.score,
                })}</span
              >
              <span class="ku-detail-insights__health-summary">${health.summary}</span>
            </div>`
          : html`<section class="ku-detail-insights__health" data-testid="ku-detail-health">
              <div class="ku-detail-insights__health-head">
                <span class="ku-detail-insights__health-title"
                  >${t("frontstage.workbench.knowledgeUniverse.detail.insights.healthHeading")}</span
                >
                <span
                  class=${`ku-detail-insights__health-status ku-detail-insights__health-status--${health.tone}`}
                  >${health.statusLabel}</span
                >
              </div>
              <div class="ku-detail-insights__health-score" aria-label=${health.summary}>
                <span class="ku-detail-insights__stars" aria-hidden="true"
                  >${renderStars(health.stars)}</span
                >
                <span class="ku-detail-insights__score"
                  >${t("frontstage.workbench.knowledgeUniverse.detail.insights.healthScore", {
                    score: health.score,
                  })}</span
                >
              </div>
              <p class="ku-detail-insights__health-summary">${health.summary}</p>
              <ul class="ku-detail-insights__health-bullets">
                ${health.bullets.map((bullet) => html`<li>${bullet}</li>`)}
              </ul>
            </section>`
      }

      <section class="ku-detail-insights__discoveries">
        ${
          compact
            ? nothing
            : html`<div class="ku-detail-insights__discoveries-head">
                <h4 class="ku-detail-insights__title">
                  ${t("frontstage.workbench.knowledgeUniverse.detail.insights.heading")}
                </h4>
                <p class="ku-detail-insights__lead">
                  ${t("frontstage.workbench.knowledgeUniverse.detail.insights.lead")}
                </p>
              </div>`
        }
        ${
          shownDiscoveries.length === 0
            ? html`<p class="ku-detail-insights__empty">
                ${t("frontstage.workbench.knowledgeUniverse.detail.insights.empty")}
              </p>`
            : html`<ol class="ku-detail-insights__list">
                ${shownDiscoveries.map(
                  (discovery, index) => html`
                  <li>
                    ${renderKnowledgeInsightCard({
                      discovery,
                      index,
                      variant: params.variant,
                      onExecuteKnowledgeAction: params.onExecuteKnowledgeAction,
                    })}
                  </li>
                `,
                )}
              </ol>`
        }
      </section>
    </div>
  `;
}
