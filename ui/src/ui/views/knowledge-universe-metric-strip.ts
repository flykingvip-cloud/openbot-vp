import { html, nothing } from "lit";
import { t } from "../../i18n/index.ts";
import type { KnowledgeSourceSummary } from "../capability/knowledge-universe/types.ts";
import type { WorkbenchKnowledgeSurface } from "../ports/employee/views/home-page-contracts.ts";
import { navigateKnowledgeUniverseAnchor } from "./knowledge-universe-anchor-nav.ts";
import { KNOWLEDGE_UNIVERSE_ANCHORS } from "./knowledge-universe-anchors.ts";

type MetricChipTarget = "anchor" | "governance" | "relations";

function renderMetricChip(params: {
  label: string;
  value: number;
  target: MetricChipTarget;
  testId: string;
  onGovernance?: () => void;
  onExpandRelations?: () => void;
  anchorId?: string;
}) {
  const handleClick = () => {
    if (params.target === "governance") {
      params.onGovernance?.();
      return;
    }
    if (params.target === "relations") {
      params.onExpandRelations?.();
      navigateKnowledgeUniverseAnchor(KNOWLEDGE_UNIVERSE_ANCHORS.relations, { block: "start" });
      return;
    }
    if (params.anchorId) {
      navigateKnowledgeUniverseAnchor(params.anchorId, { block: "start" });
    }
  };

  return html`
    <button
      type="button"
      class="knowledge-universe__metric-chip"
      data-testid=${params.testId}
      @click=${handleClick}
    >
      <span class="knowledge-universe__metric-chip-value">${params.value}</span>
      <span class="knowledge-universe__metric-chip-label">${params.label}</span>
    </button>
  `;
}

function resolveOpenGovernanceCount(surface: WorkbenchKnowledgeSurface): number {
  const summary = surface.governanceSummary;
  if (!summary) {
    return 0;
  }
  return (
    summary.openConflictCount +
    summary.openClaimConflictCount +
    summary.openDuplicateCount +
    summary.openOrphanCount +
    summary.openStaleCount
  );
}

function resolveRelationCount(surface: WorkbenchKnowledgeSurface): number {
  return surface.knowledgeBases.reduce((sum, kb) => sum + (kb.relationCount ?? 0), 0);
}

function resolveChunkCount(surface: WorkbenchKnowledgeSurface): number {
  return surface.knowledgeBases.reduce(
    (sum, kb) => sum + (kb.chunkCount ?? kb.documentCount ?? 0),
    0,
  );
}

export function renderKnowledgeUniverseWorkspaceMetricStrip(
  surface: WorkbenchKnowledgeSurface,
  options?: {
    onOpenGovernance?: () => void;
    onExpandRelations?: () => void;
  },
) {
  const libraryCount = surface.knowledgeBases.length;
  const deliverableCount = surface.workspaceDeliverables.length;
  const chunkCount = resolveChunkCount(surface);
  const relationCount = resolveRelationCount(surface);
  const governanceCount = resolveOpenGovernanceCount(surface);

  return html`
    <div
      class="knowledge-universe__metric-strip knowledge-universe__metric-strip--flat knowledge-universe__metric-strip--compact"
      role="group"
      aria-label=${t("frontstage.workbench.knowledgeUniverse.metricStrip.heading")}
      data-testid="ku-workspace-metric-strip"
    >
      ${renderMetricChip({
        label: t("frontstage.workbench.knowledgeUniverse.metricStrip.spaces"),
        value: libraryCount,
        target: "anchor",
        anchorId: KNOWLEDGE_UNIVERSE_ANCHORS.workspace,
        testId: "ku-metric-spaces",
      })}
      ${renderMetricChip({
        label: t("frontstage.workbench.knowledgeUniverse.metricStrip.deliverables"),
        value: deliverableCount,
        target: "anchor",
        anchorId: KNOWLEDGE_UNIVERSE_ANCHORS.deliverables,
        testId: "ku-metric-deliverables",
      })}
      ${renderMetricChip({
        label: t("frontstage.workbench.knowledgeUniverse.metricStrip.chunks"),
        value: chunkCount,
        target: "relations",
        testId: "ku-metric-chunks",
        onExpandRelations: options?.onExpandRelations,
      })}
      ${renderMetricChip({
        label: t("frontstage.workbench.knowledgeUniverse.metricStrip.governance"),
        value: governanceCount,
        target: "governance",
        testId: "ku-metric-governance",
        onGovernance: options?.onOpenGovernance,
      })}
      ${renderMetricChip({
        label: t("frontstage.workbench.knowledgeUniverse.metricStrip.relations"),
        value: relationCount,
        target: "relations",
        testId: "ku-metric-relations",
        onExpandRelations: options?.onExpandRelations,
      })}
    </div>
  `;
}

export function renderKnowledgeUniverseMetricStrip(params: {
  sourceSummary: KnowledgeSourceSummary | null;
  knowledgeBaseCount: number;
  deliverableCount: number;
}) {
  if (!params.sourceSummary) {
    return nothing;
  }
  const summary = params.sourceSummary;
  return html`
    <div
      class="knowledge-universe__metric-strip knowledge-universe__metric-strip--flat"
      role="group"
      aria-label=${t("frontstage.workbench.knowledgeUniverse.metricStrip.heading")}
    >
      ${renderMetricChip({
        anchorId: KNOWLEDGE_UNIVERSE_ANCHORS.workspace,
        label: t("frontstage.workbench.knowledgeUniverse.metricStrip.spaces"),
        value: params.knowledgeBaseCount,
        target: "anchor",
        testId: "ku-metric-spaces",
      })}
      ${renderMetricChip({
        anchorId: KNOWLEDGE_UNIVERSE_ANCHORS.deliverables,
        label: t("frontstage.workbench.knowledgeUniverse.metricStrip.deliverables"),
        value: params.deliverableCount,
        target: "anchor",
        testId: "ku-metric-deliverables",
      })}
      ${renderMetricChip({
        anchorId: KNOWLEDGE_UNIVERSE_ANCHORS.personal,
        label: t("frontstage.workbench.knowledgeUniverse.metricStrip.chunks"),
        value: summary.personal.documentCount,
        target: "anchor",
        testId: "ku-metric-chunks",
      })}
      ${renderMetricChip({
        anchorId: KNOWLEDGE_UNIVERSE_ANCHORS.enterprise,
        label: t("frontstage.workbench.knowledgeUniverse.metricStrip.enterprise"),
        value: summary.enterprise.accessibleCount,
        target: "anchor",
        testId: "ku-metric-enterprise",
      })}
      ${renderMetricChip({
        anchorId: KNOWLEDGE_UNIVERSE_ANCHORS.capabilityCenter,
        label: t("frontstage.workbench.knowledgeUniverse.metricStrip.capabilities"),
        value: summary.data.grantedCount,
        target: "anchor",
        testId: "ku-metric-capabilities",
      })}
    </div>
  `;
}
