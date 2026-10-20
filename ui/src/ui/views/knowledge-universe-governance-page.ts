import { html, nothing } from "lit";
import { t } from "../../i18n/index.ts";
import type {
  KnowledgeGovernanceSummary,
  KnowledgeGovernanceTask,
} from "../capability/knowledge-universe/endpoints.ts";
import type { WorkbenchKnowledgeSurface } from "../ports/employee/views/home-page-contracts.ts";
import {
  buildClaimConflictOptions,
  formatClaimSlotLabel,
} from "./knowledge-universe-governance-claim-conflict.ts";
import { sortGovernanceTasksForDisplay } from "./knowledge-universe-governance-sort.ts";
import { renderKnowledgeUniverseGraphCanvas } from "./knowledge-universe-graph-canvas.ts";
import { openKnowledgeUniversePersonalIngest } from "./knowledge-universe-workspace-nav.ts";

const EMPTY_LLM_USAGE: KnowledgeGovernanceSummary["llmUsage"] = {
  llmCallCount: 0,
  inputTokens: 0,
  outputTokens: 0,
  totalTokens: 0,
  creditsCharged: 0,
  lastCallAt: null,
};

export const EMPTY_GOVERNANCE_SUMMARY: KnowledgeGovernanceSummary = {
  openConflictCount: 0,
  openClaimConflictCount: 0,
  openDuplicateCount: 0,
  openOrphanCount: 0,
  openStaleCount: 0,
  suppressedChunkCount: 0,
  indexedChunkCount: 0,
  llmUsage: { ...EMPTY_LLM_USAGE },
};

function resolveGovernanceSummary(
  summary: KnowledgeGovernanceSummary | null,
): KnowledgeGovernanceSummary {
  return summary ?? EMPTY_GOVERNANCE_SUMMARY;
}

function taskTypeLabel(taskType: KnowledgeGovernanceTask["taskType"]): string {
  switch (taskType) {
    case "duplicate":
      return t("frontstage.workbench.knowledgeUniverse.governance.taskDuplicate");
    case "conflict":
      return t("frontstage.workbench.knowledgeUniverse.governance.taskConflict");
    case "claim_conflict":
      return t("frontstage.workbench.knowledgeUniverse.governance.taskClaimConflict");
    case "stale":
      return t("frontstage.workbench.knowledgeUniverse.governance.taskStale");
    case "orphan":
      return t("frontstage.workbench.knowledgeUniverse.governance.taskOrphan");
    default:
      return taskType;
  }
}

function renderLlmUsageSection(summary: KnowledgeGovernanceSummary) {
  const usage = summary.llmUsage;
  const hasUsage = usage.llmCallCount > 0;
  if (!hasUsage) {
    return html`
      <section
        class="knowledge-universe__governance-llm-usage knowledge-universe__governance-llm-usage--empty"
        data-testid="ku-governance-llm-usage"
      >
        <h3 class="knowledge-universe__governance-llm-usage-title">
          ${t("frontstage.workbench.knowledgeUniverse.governance.llmUsageHeading")}
        </h3>
        <p class="knowledge-universe__insight-empty">
          ${t("frontstage.workbench.knowledgeUniverse.governance.llmUsageEmpty")}
        </p>
      </section>
    `;
  }
  const tiles = [
    {
      label: t("frontstage.workbench.knowledgeUniverse.governance.llmCallCount"),
      value: usage.llmCallCount,
    },
    {
      label: t("frontstage.workbench.knowledgeUniverse.governance.llmTokenCount"),
      value: usage.totalTokens,
    },
    ...(usage.creditsCharged > 0
      ? [
          {
            label: t("frontstage.workbench.knowledgeUniverse.governance.llmCreditsCharged"),
            value: usage.creditsCharged,
          },
        ]
      : []),
  ];
  return html`
    <section class="knowledge-universe__governance-llm-usage" data-testid="ku-governance-llm-usage">
      <h3 class="knowledge-universe__governance-llm-usage-title">
        ${t("frontstage.workbench.knowledgeUniverse.governance.llmUsageHeading")}
      </h3>
      <div class="knowledge-universe__governance-summary">
        ${tiles.map(
          (tile) => html`
            <div
              class="knowledge-universe__governance-summary-tile knowledge-universe__governance-summary-tile--llm"
              data-testid="ku-governance-llm-usage-tile"
              data-kind=${tile.label}
            >
              <span class="knowledge-universe__governance-summary-value">${tile.value}</span>
              <span class="knowledge-universe__governance-summary-label">${tile.label}</span>
            </div>
          `,
        )}
      </div>
    </section>
  `;
}

function renderSummaryTiles(summary: KnowledgeGovernanceSummary) {
  const tiles = [
    {
      label: t("frontstage.workbench.knowledgeUniverse.governance.openConflicts"),
      value: summary.openConflictCount,
    },
    {
      label: t("frontstage.workbench.knowledgeUniverse.governance.openClaimConflicts"),
      value: summary.openClaimConflictCount,
    },
    {
      label: t("frontstage.workbench.knowledgeUniverse.governance.openDuplicates"),
      value: summary.openDuplicateCount,
    },
    {
      label: t("frontstage.workbench.knowledgeUniverse.governance.suppressedChunks"),
      value: summary.suppressedChunkCount,
    },
  ];
  return html`
    <div class="knowledge-universe__governance-summary">
      ${tiles.map(
        (tile) => html`
          <div
            class="knowledge-universe__governance-summary-tile"
            data-testid="ku-governance-summary-tile"
            data-kind=${tile.label}
          >
            <span class="knowledge-universe__governance-summary-value">${tile.value}</span>
            <span class="knowledge-universe__governance-summary-label">${tile.label}</span>
          </div>
        `,
      )}
    </div>
  `;
}

function claimConflictTaskHeading(task: KnowledgeGovernanceTask): string {
  if (task.taskType !== "claim_conflict") {
    return taskTypeLabel(task.taskType);
  }
  const { meta } = buildClaimConflictOptions(task);
  const slotLabel = formatClaimSlotLabel(meta);
  if (slotLabel) {
    return t("frontstage.workbench.knowledgeUniverse.governance.taskClaimConflictSubject", {
      subject: slotLabel,
    });
  }
  return taskTypeLabel(task.taskType);
}

function renderClaimConflictDetail(
  task: KnowledgeGovernanceTask,
  surface: WorkbenchKnowledgeSurface,
) {
  const { options } = buildClaimConflictOptions(task);
  if (options.length === 0) {
    return nothing;
  }
  const busy = surface.governanceTaskBusyId === task.id;
  const selectable = options.some((option) => option.canonicalClaimId.trim().length > 0);
  return html`
    <div class="knowledge-universe__governance-claim-detail" data-testid="ku-governance-claim-detail">
      <p class="knowledge-universe__governance-claim-prompt">
        ${t("frontstage.workbench.knowledgeUniverse.governance.claimTruthPrompt")}
      </p>
      <ul class="knowledge-universe__governance-claim-candidates">
        ${options.map(
          (option) => html`
            <li
              class="knowledge-universe__governance-claim-candidate ${
                option.isPlaceholder ? "is-placeholder" : ""
              } ${option.recommended ? "is-recommended" : ""}"
              data-testid="ku-governance-claim-candidate"
              data-recommended=${option.recommended ? "true" : "false"}
            >
              <div class="knowledge-universe__governance-claim-candidate-body">
                <div class="knowledge-universe__governance-claim-value-row">
                  <span
                    class="knowledge-universe__governance-claim-value ${
                      option.isPlaceholder ? "is-placeholder" : ""
                    }"
                    >${option.displayValue}</span
                  >
                  ${
                    option.recommended
                      ? html`<span
                          class="knowledge-universe__governance-claim-badge"
                          data-testid="ku-governance-claim-recommended"
                          >${t(
                            "frontstage.workbench.knowledgeUniverse.governance.claimRecommended",
                          )}</span
                        >`
                      : nothing
                  }
                </div>
                ${
                  option.contextExcerpt
                    ? html`<p class="knowledge-universe__governance-claim-context">
                        ${option.contextExcerpt}
                      </p>`
                    : nothing
                }
                <p class="knowledge-universe__governance-claim-sources">
                  ${t("frontstage.workbench.knowledgeUniverse.governance.claimFromSources", {
                    count: option.sourceCount,
                  })}
                  ${
                    option.isPlaceholder
                      ? html` · ${t(
                          "frontstage.workbench.knowledgeUniverse.governance.claimPlaceholderHint",
                        )}`
                      : nothing
                  }
                </p>
              </div>
              ${
                selectable
                  ? html`
                    <button
                      type="button"
                      class="knowledge-universe__governance-action knowledge-universe__governance-action--truth"
                      data-testid="ku-governance-claim-truth"
                      ?disabled=${busy}
                      @click=${() =>
                        void surface.onGovernanceTaskUpdate(
                          task.id,
                          "resolved",
                          option.canonicalClaimId,
                        )}
                    >
                      ${t("frontstage.workbench.knowledgeUniverse.governance.markTruth")}
                    </button>
                  `
                  : nothing
              }
            </li>
          `,
        )}
      </ul>
    </div>
  `;
}

function renderTaskGraph(surface: WorkbenchKnowledgeSurface, task: KnowledgeGovernanceTask) {
  if (surface.governanceSelectedTaskId !== task.id) {
    return nothing;
  }
  if (surface.governanceTaskGraphLoading) {
    return html`
      <div class="knowledge-universe__governance-task-graph" data-testid="ku-governance-task-graph">
        <p class="knowledge-universe__inline-notice knowledge-universe__inline-notice--muted">
          ${t("frontstage.workbench.knowledgeUniverse.governance.graphLoading")}
        </p>
      </div>
    `;
  }
  return html`
    <div class="knowledge-universe__governance-task-graph" data-testid="ku-governance-task-graph">
      <h4 class="knowledge-universe__governance-task-graph-title">
        ${t("frontstage.workbench.knowledgeUniverse.governance.issueGraph")}
      </h4>
      ${renderKnowledgeUniverseGraphCanvas({
        graph: surface.governanceTaskGraph,
        graphViewModel: surface.governanceTaskGraphViewModel,
        selectedNodeId: surface.governanceTaskGraphSelectedNodeId,
        hoveredNodeId: surface.governanceTaskGraphHoveredNodeId,
        zoom: surface.governanceTaskGraphZoom,
        panX: surface.governanceTaskGraphPanX,
        panY: surface.governanceTaskGraphPanY,
        onSelectNode: (nodeId) => surface.onGovernanceTaskGraphSelectNode(nodeId),
        onHoverNode: (nodeId) => surface.onGovernanceTaskGraphHoverNode(nodeId),
        onZoom: (delta) => surface.onGovernanceTaskGraphZoom(delta),
        onPan: (dx, dy) => surface.onGovernanceTaskGraphPan(dx, dy),
        onResetView: () => surface.onGovernanceTaskGraphResetView(),
      })}
    </div>
  `;
}

function renderTaskRow(task: KnowledgeGovernanceTask, surface: WorkbenchKnowledgeSurface) {
  const busy = surface.governanceTaskBusyId === task.id;
  const expanded = surface.governanceSelectedTaskId === task.id;
  const claimConflict = task.taskType === "claim_conflict";
  return html`
    <li
      class="knowledge-universe__governance-task ${expanded ? "is-expanded" : ""}"
      data-testid="ku-governance-task-row"
      data-task-type=${task.taskType}
    >
      <div class="knowledge-universe__governance-task-main">
        <span class="knowledge-universe__governance-task-type">${claimConflictTaskHeading(task)}</span>
        <span class="knowledge-universe__governance-task-meta">
          ${t("frontstage.workbench.knowledgeUniverse.governance.chunkCount", {
            count: task.relatedChunkIds.length,
          })}
        </span>
        ${renderClaimConflictDetail(task, surface)}
      </div>
      <div class="knowledge-universe__governance-task-actions">
        <button
          type="button"
          class="knowledge-universe__governance-action knowledge-universe__governance-action--muted"
          ?disabled=${busy}
          @click=${() => void surface.onGovernanceTaskSelect(expanded ? null : task.id)}
        >
          ${
            expanded
              ? t("frontstage.workbench.knowledgeUniverse.governance.hideGraph")
              : t("frontstage.workbench.knowledgeUniverse.governance.viewGraph")
          }
        </button>
        <button
          type="button"
          class="knowledge-universe__governance-action"
          data-testid="ku-governance-resolve"
          ?disabled=${busy || claimConflict}
          title=${
            claimConflict
              ? t("frontstage.workbench.knowledgeUniverse.governance.claimResolveDisabledHint")
              : ""
          }
          @click=${() => void surface.onGovernanceTaskUpdate(task.id, "resolved")}
        >
          ${t("frontstage.workbench.knowledgeUniverse.governance.resolve")}
        </button>
        <button
          type="button"
          class="knowledge-universe__governance-action knowledge-universe__governance-action--muted"
          ?disabled=${busy}
          @click=${() => void surface.onGovernanceTaskUpdate(task.id, "dismissed")}
        >
          ${t("frontstage.workbench.knowledgeUniverse.governance.dismiss")}
        </button>
      </div>
      ${renderTaskGraph(surface, task)}
    </li>
  `;
}

function renderGovernanceScope(surface: WorkbenchKnowledgeSurface) {
  const kbId = surface.selectedKnowledgeBaseId;
  if (!kbId) {
    return t("frontstage.workbench.knowledgeUniverse.governance.scopeAllLibraries");
  }
  const kb = surface.knowledgeBases.find((item) => item.id === kbId) ?? null;
  return t("frontstage.workbench.knowledgeUniverse.governance.scopeLibrary", {
    title: kb?.title?.trim() || kbId,
  });
}

function renderGovernanceStatusBanner(
  surface: WorkbenchKnowledgeSurface,
  summary: KnowledgeGovernanceSummary,
) {
  const openCount =
    summary.openConflictCount +
    summary.openClaimConflictCount +
    summary.openDuplicateCount +
    summary.openStaleCount +
    summary.openOrphanCount;
  const indexLabel =
    summary.indexedChunkCount === 0
      ? t("frontstage.workbench.knowledgeUniverse.governance.indexStatusNotReady")
      : t("frontstage.workbench.knowledgeUniverse.governance.indexStatusReady", {
          count: summary.indexedChunkCount,
        });
  return html`
    <section
      class="knowledge-universe__governance-status-banner"
      data-testid="ku-governance-status-banner"
      data-index-ready=${summary.indexedChunkCount > 0 ? "true" : "false"}
    >
      <div class="knowledge-universe__governance-status-row">
        <span class="knowledge-universe__governance-status-chip">${indexLabel}</span>
        <span class="knowledge-universe__governance-status-chip knowledge-universe__governance-status-chip--muted"
          >${renderGovernanceScope(surface)}</span
        >
        <span class="knowledge-universe__governance-status-chip"
          >${t("frontstage.workbench.knowledgeUniverse.governance.statusOpenTasks", {
            count: openCount,
          })}</span
        >
      </div>
    </section>
  `;
}

function openGovernanceIngestFlow(surface: WorkbenchKnowledgeSurface) {
  void (async () => {
    if (!surface.selectedKnowledgeBaseId) {
      await surface.onQuickCreateKnowledgeBase();
    }
    surface.onPageTabChange("personal");
    surface.onBrowseSubTabChange("private");
    surface.onPersonalCollectDrawerOpenChange(true, "collect");
  })();
}

function renderTasksEmptyState(
  surface: WorkbenchKnowledgeSurface,
  summary: KnowledgeGovernanceSummary,
) {
  if (summary.indexedChunkCount === 0) {
    return html`
      <div
        class="knowledge-universe__governance-empty knowledge-universe__governance-empty--index"
        data-testid="ku-governance-index-not-ready"
      >
        <p class="knowledge-universe__insight-empty">
          ${t("frontstage.workbench.knowledgeUniverse.governance.indexNotReady")}
        </p>
        <button
          type="button"
          class="knowledge-universe__governance-action"
          @click=${() => openGovernanceIngestFlow(surface)}
        >
          ${t("frontstage.workbench.knowledgeUniverse.governance.indexNotReadyAction")}
        </button>
      </div>
    `;
  }
  return html`<p class="knowledge-universe__insight-empty">
    ${t("frontstage.workbench.knowledgeUniverse.governance.emptyHealthy")}
  </p>`;
}

function renderGovernanceNotice(surface: WorkbenchKnowledgeSurface) {
  if (!surface.governanceNotice) {
    return nothing;
  }
  return html`
    <div
      class="knowledge-universe__governance-notice"
      role="status"
      data-testid="ku-governance-notice"
    >
      <p class="knowledge-universe__governance-notice-copy">${surface.governanceNotice}</p>
      <button
        type="button"
        class="knowledge-universe__governance-notice-dismiss"
        data-testid="ku-governance-notice-dismiss"
        @click=${() => surface.onDismissGovernanceNotice?.()}
      >
        ${t("frontstage.workbench.knowledgeUniverse.governance.noticeDismiss")}
      </button>
    </div>
  `;
}

export function renderKnowledgeUniverseGovernancePage(surface: WorkbenchKnowledgeSurface) {
  const summary = resolveGovernanceSummary(surface.governanceSummary);
  const openTasks = sortGovernanceTasksForDisplay(
    surface.governanceTasks.filter((task) => task.status === "open"),
  );
  return html`
    <div class="knowledge-universe__governance-page">
      <div class="knowledge-universe__governance-toolbar">
        <button
          type="button"
          class="knowledge-universe__insight-link"
          ?disabled=${surface.governanceLoading}
          @click=${() => void surface.onRefreshGovernance?.()}
        >
          ${t("frontstage.workbench.knowledgeUniverse.governance.refresh")}
        </button>
      </div>

      ${renderGovernanceStatusBanner(surface, summary)}

      ${renderGovernanceNotice(surface)}

      ${
        surface.governanceError
          ? html`<p class="knowledge-universe__inline-notice">${surface.governanceError}</p>`
          : nothing
      }
      ${
        surface.governanceLoading
          ? html`<p class="knowledge-universe__inline-notice knowledge-universe__inline-notice--muted">
            ${t("frontstage.workbench.knowledgeUniverse.governance.loading")}
          </p>`
          : nothing
      }

      ${renderSummaryTiles(summary)}
      ${renderLlmUsageSection(summary)}

      <section class="knowledge-universe__governance-tasks" aria-live="polite">
        <h3 class="knowledge-universe__governance-tasks-title">
          ${t("frontstage.workbench.knowledgeUniverse.governance.openTasks")}
        </h3>
        ${
          openTasks.length === 0
            ? renderTasksEmptyState(surface, summary)
            : html`<ul class="knowledge-universe__governance-task-list">
                ${openTasks.map((task) => renderTaskRow(task, surface))}
              </ul>`
        }
      </section>
    </div>
  `;
}

export function renderGovernanceInsightCard(
  surface: WorkbenchKnowledgeSurface,
  onExpand: () => void,
) {
  const summary = resolveGovernanceSummary(surface.governanceSummary);
  if (summary.indexedChunkCount === 0) {
    return html`
      <section class="knowledge-universe__insight-card" data-testid="ku-insights-governance-card">
        <header class="knowledge-universe__insight-card-head">
          <h3 class="knowledge-universe__insight-card-title">
            ${t("frontstage.workbench.knowledgeUniverse.governance.heading")}
          </h3>
          <button type="button" class="knowledge-universe__insight-link" @click=${onExpand}>
            ${t("frontstage.workbench.knowledgeUniverse.governance.openCenter")}
          </button>
        </header>
        <p class="knowledge-universe__insight-card-sub">
          ${t("frontstage.workbench.knowledgeUniverse.governance.cardSub")}
        </p>
        <div class="knowledge-universe__insight-card-body">
          <p class="knowledge-universe__insight-empty">
            ${t("frontstage.workbench.knowledgeUniverse.governance.cardIndexNotReady")}
          </p>
          <button
            type="button"
            class="knowledge-universe__insight-action-btn knowledge-universe__insight-action-btn--primary"
            data-testid="ku-governance-ingest-cta"
            @click=${() => openKnowledgeUniversePersonalIngest(surface)}
          >
            ${t("frontstage.workbench.knowledgeUniverse.governance.indexNotReadyAction")}
          </button>
        </div>
      </section>
    `;
  }
  const conflictCount = summary.openConflictCount + summary.openClaimConflictCount;
  const openCount =
    conflictCount + summary.openDuplicateCount + summary.openStaleCount + summary.openOrphanCount;
  return html`
    <section class="knowledge-universe__insight-card" data-testid="ku-insights-governance-card">
      <header class="knowledge-universe__insight-card-head">
        <h3 class="knowledge-universe__insight-card-title">
          ${t("frontstage.workbench.knowledgeUniverse.governance.heading")}
        </h3>
        <button type="button" class="knowledge-universe__insight-link" @click=${onExpand}>
          ${t("frontstage.workbench.knowledgeUniverse.governance.openCenter")}
        </button>
      </header>
      <p class="knowledge-universe__insight-card-sub">
        ${t("frontstage.workbench.knowledgeUniverse.governance.cardSub")}
      </p>
      <div class="knowledge-universe__insight-card-body">
        <p class="knowledge-universe__governance-open-count">
          ${t("frontstage.workbench.knowledgeUniverse.governance.openCount", { count: openCount })}
        </p>
        ${
          conflictCount > 0
            ? html`<p class="knowledge-universe__insight-card-sub">
                ${t("frontstage.workbench.knowledgeUniverse.governance.openConflictCount", {
                  count: conflictCount,
                })}
              </p>`
            : nothing
        }
      </div>
    </section>
  `;
}
