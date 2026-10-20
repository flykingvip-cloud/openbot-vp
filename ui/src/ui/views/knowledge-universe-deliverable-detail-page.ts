import { html, nothing, type TemplateResult } from "lit";
import { t } from "../../i18n/index.ts";
import type {
  DeliverableDetailFocus,
  KnowledgeBaseSummary,
  WorkspaceDeliverableDownstreamLinkDto,
  WorkspaceDeliverableDto,
  WorkspaceDeliverableTraceDto,
  WorkspaceDeliverableTraceStepDto,
} from "../capability/knowledge-universe/workspace-endpoints.ts";
import type { WorkbenchKnowledgeSurface } from "../ports/employee/views/home-page-contracts.ts";
import {
  labelArtifactGovernanceStatus,
  labelArtifactSourceTypeShort,
  normalizeArtifactKind,
  normalizeArtifactSourceType,
  resolveArtifactGovernanceStatus,
} from "./knowledge-universe-artifact-taxonomy.ts";
import { formatDeliverableArchivedLibraryLabel } from "./knowledge-universe-deliverable-display.ts";
import {
  kuIconArchive,
  kuIconDatabase,
  kuIconFile,
  kuIconFolder,
  kuIconLink,
  kuIconRobot,
  kuIconUser,
} from "./knowledge-universe-icons.ts";
import { renderDeliverableSourcePillClass } from "./knowledge-universe-source-palette.ts";

/**
 * Deliverable detail = the "Outcome Object" viewer. The成果 is presented as five explicit
 * layers so its full value (not just the file) is visible:
 *   1. 内容 Content      — the outcome itself + key facts.
 *   2. 语义 Semantic     — AI-understandable layer (index / embedding state, model, cited count).
 *   3. 来源 Lineage      — how it was produced, who took part, based on what (trace steps).
 *   4. 关系 Relationship — links to knowledge base / cited knowledge / group / task / participants.
 *   5. 治理 Governance   — precipitation into knowledge, conflict & quality signals.
 * All layers are populated from committed data only (WorkspaceDeliverableTrace + the
 * deliverable DTO); deeper semantics (topics/claims) and downstream成果↔成果 relations are
 * honestly marked as generated after precipitation / once auto-capture is wired.
 */

function resolveDeliverable(surface: WorkbenchKnowledgeSurface): WorkspaceDeliverableDto | null {
  const id = surface.selectedWorkspaceSearchDeliverableId;
  if (!id) {
    return null;
  }
  return (
    surface.workspaceDeliverableTrace?.deliverable ??
    surface.workspaceDeliverables.find((item) => item.deliverableId === id) ??
    null
  );
}

function resolveOwnerLabel(item: WorkspaceDeliverableDto): string {
  return (
    item.primaryCreatorName ??
    item.creators[0] ??
    item.groupTitle ??
    t("frontstage.workbench.knowledgeUniverse.workspace.deliverableOwnerFallback")
  );
}

function formatRelativeTime(updatedAtMs: number): string {
  if (!updatedAtMs) {
    return t("frontstage.workbench.knowledgeUniverse.workspace.updatedUnknown");
  }
  const diffMs = Date.now() - updatedAtMs;
  const minutes = Math.floor(diffMs / 60_000);
  if (minutes < 1) {
    return t("frontstage.workbench.knowledgeUniverse.insights.justNow");
  }
  if (minutes < 60) {
    return t("frontstage.workbench.knowledgeUniverse.insights.minutesAgo", { count: minutes });
  }
  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    return t("frontstage.workbench.knowledgeUniverse.insights.hoursAgo", { count: hours });
  }
  return new Date(updatedAtMs).toLocaleString();
}

function formatStepTime(atMs?: number): string | null {
  if (!atMs) {
    return null;
  }
  return new Date(atMs).toLocaleString();
}

function suggestArchiveTargets(
  item: WorkspaceDeliverableDto,
  libraries: KnowledgeBaseSummary[],
): KnowledgeBaseSummary[] {
  if (item.relatedKnowledgeBaseId) {
    return libraries.filter((kb) => kb.id === item.relatedKnowledgeBaseId);
  }
  const titleHaystack = item.title.toLowerCase();
  const ranked = libraries
    .map((kb) => {
      const kbHaystack = `${kb.title} ${kb.description}`.toLowerCase();
      let score = 0;
      if (
        titleHaystack.includes(kb.title.toLowerCase()) ||
        kbHaystack.includes(titleHaystack.slice(0, 8))
      ) {
        score += 2;
      }
      if (kb.documentCount > 0) {
        score += 1;
      }
      return { kb, score };
    })
    .toSorted((a, b) => b.score - a.score)
    .map((entry) => entry.kb);
  return ranked.slice(0, 3);
}

function focusSectionClass(
  focus: DeliverableDetailFocus | null,
  ...sections: DeliverableDetailFocus[]
): string {
  return focus && sections.includes(focus) ? "ku-deliverable-detail__section--focused" : "";
}

/** Shared chrome for an Outcome Object layer (numbered header + body). */
function renderOutcomeLayer(params: {
  key: string;
  index: number;
  title: string;
  subtitle: string;
  body: TemplateResult;
  focusClass?: string;
  anchorId?: string;
}) {
  return html`
    <section
      class="ku-outcome-layer ku-outcome-layer--${params.key} ${params.focusClass ?? ""}"
      data-testid="ku-outcome-layer-${params.key}"
      id=${params.anchorId ?? nothing}
    >
      <header class="ku-outcome-layer__head">
        <span class="ku-outcome-layer__index" aria-hidden="true">${params.index}</span>
        <div class="ku-outcome-layer__head-text">
          <h3 class="ku-outcome-layer__title">${params.title}</h3>
          <p class="ku-outcome-layer__sub">${params.subtitle}</p>
        </div>
      </header>
      <div class="ku-outcome-layer__body">${params.body}</div>
    </section>
  `;
}

// ── Layer 1: 内容 Content ─────────────────────────────────────────────────────
function renderContentLayer(
  item: WorkspaceDeliverableDto,
  trace: WorkspaceDeliverableTraceDto | null,
) {
  const sourceType = normalizeArtifactSourceType(item);
  const artifactKind = normalizeArtifactKind(item);
  const previewText = trace?.previewText?.trim();
  return html`
    <div class="ku-deliverable-detail__preview">
      <div class="ku-deliverable-detail__preview-icon" aria-hidden="true">
        ${kuIconFile("ku-deliverable-detail__icon")}
      </div>
      <h3 class="ku-deliverable-detail__preview-title">${item.title}</h3>
      <div class="ku-deliverable-detail__preview-pills">
        <span class=${renderDeliverableSourcePillClass(item.source)}
          >${labelArtifactSourceTypeShort(sourceType)}</span
        >
        <span class="ku-deliverable-detail__pill">${artifactKind}</span>
        <span class="ku-deliverable-detail__pill ku-deliverable-detail__pill--status"
          >${item.status}</span
        >
        ${
          trace?.dataSource
            ? html`<span class="ku-deliverable-detail__pill ku-deliverable-detail__pill--source"
                >${
                  trace.dataSource === "live"
                    ? t("frontstage.workbench.knowledgeUniverse.deliverableDetail.traceLive")
                    : t(
                        "frontstage.workbench.knowledgeUniverse.deliverableDetail.traceReconstructed",
                      )
                }</span
              >`
            : nothing
        }
      </div>
      <dl class="ku-deliverable-detail__meta">
        <div>
          <dt>${t("frontstage.workbench.knowledgeUniverse.workspace.deliverableColOwner")}</dt>
          <dd>${resolveOwnerLabel(item)}</dd>
        </div>
        <div>
          <dt>${t("frontstage.workbench.knowledgeUniverse.workspace.deliverableColTime")}</dt>
          <dd>${formatRelativeTime(item.updatedAtMs)}</dd>
        </div>
      </dl>
      <div class="ku-deliverable-detail__preview-body">
        <p>
          ${
            previewText ??
            t("frontstage.workbench.knowledgeUniverse.deliverableDetail.previewPlaceholder")
          }
        </p>
      </div>
    </div>
  `;
}

// ── Layer 2: 语义 Semantic ────────────────────────────────────────────────────
function renderSemanticLayer(
  item: WorkspaceDeliverableDto,
  trace: WorkspaceDeliverableTraceDto | null,
) {
  const indexed = Boolean(item.relatedKnowledgeBaseId);
  const citedCount = trace?.citedKnowledge?.length ?? 0;
  const usage = trace?.modelUsage ?? null;
  const tokenLabel = usage?.totalTokens
    ? t("frontstage.workbench.knowledgeUniverse.deliverableDetail.semantic.tokens", {
        count: usage.totalTokens,
      })
    : null;
  return html`
    <div class="ku-outcome-facts">
      <div class="ku-outcome-fact" data-state=${indexed ? "on" : "off"}>
        <span class="ku-outcome-fact__icon" aria-hidden="true"
          >${kuIconDatabase("ku-outcome-fact__icon-svg")}</span
        >
        <span class="ku-outcome-fact__label">
          ${
            indexed
              ? t("frontstage.workbench.knowledgeUniverse.deliverableDetail.semantic.indexedTitle")
              : t("frontstage.workbench.knowledgeUniverse.deliverableDetail.semantic.pendingTitle")
          }
        </span>
        <span class="ku-outcome-fact__desc">
          ${
            indexed
              ? t("frontstage.workbench.knowledgeUniverse.deliverableDetail.semantic.indexedDesc")
              : t("frontstage.workbench.knowledgeUniverse.deliverableDetail.semantic.pendingDesc")
          }
        </span>
      </div>
      <div class="ku-outcome-fact">
        <span class="ku-outcome-fact__label"
          >${t("frontstage.workbench.knowledgeUniverse.deliverableDetail.citedHeading")}</span
        >
        <span class="ku-outcome-fact__desc"
          >${t("frontstage.workbench.knowledgeUniverse.deliverableDetail.semantic.citedCount", {
            count: citedCount,
          })}</span
        >
      </div>
      ${
        usage?.model
          ? html`<div class="ku-outcome-fact">
              <span class="ku-outcome-fact__label"
                >${t("frontstage.workbench.knowledgeUniverse.deliverableDetail.model")}</span
              >
              <span class="ku-outcome-fact__desc"
                >${usage.provider ? `${usage.provider} / ` : nothing}${usage.model}${
                  tokenLabel ? html` · ${tokenLabel}` : nothing
                }</span
              >
            </div>`
          : nothing
      }
    </div>
    <p class="ku-outcome-layer__note">
      ${t("frontstage.workbench.knowledgeUniverse.deliverableDetail.semantic.deepNote")}
    </p>
  `;
}

// ── Layer 3: 来源 Lineage ─────────────────────────────────────────────────────
function renderTraceStep(
  step: WorkspaceDeliverableTraceStepDto,
  index: number,
  highlightSource: boolean,
) {
  const timeLabel = formatStepTime(step.atMs);
  return html`
    <li
      class="ku-deliverable-detail__trace-step ku-deliverable-detail__trace-step--${step.kind} ${
        highlightSource ? "ku-deliverable-detail__trace-step--focused" : ""
      }"
      id=${highlightSource ? "ku-deliverable-focus-source" : nothing}
    >
      <span class="ku-deliverable-detail__trace-index">${index + 1}</span>
      <div class="ku-deliverable-detail__trace-body">
        <span class="ku-deliverable-detail__trace-title">${step.title}</span>
        ${
          step.actorName
            ? html`<span class="ku-deliverable-detail__trace-actor">${step.actorName}</span>`
            : nothing
        }
        <p class="ku-deliverable-detail__trace-desc">${step.description}</p>
        ${timeLabel ? html`<time class="ku-deliverable-detail__trace-time">${timeLabel}</time>` : nothing}
      </div>
    </li>
  `;
}

function renderLineageLayer(
  surface: WorkbenchKnowledgeSurface,
  trace: WorkspaceDeliverableTraceDto | null,
) {
  const steps = trace?.steps ?? [];
  const focus = surface.deliverableDetailFocus;
  const sourceStepIndex = steps.findIndex(
    (step) => step.kind === "trigger" || step.kind === "knowledge" || step.kind === "collaboration",
  );
  if (surface.workspaceDeliverableTraceLoading) {
    return html`<p class="ku-deliverable-detail__trace-loading">
      ${t("frontstage.workbench.knowledgeUniverse.deliverableDetail.traceLoading")}
    </p>`;
  }
  if (steps.length === 0) {
    return html`<p class="ku-deliverable-detail__trace-empty">
      ${t("frontstage.workbench.knowledgeUniverse.deliverableDetail.traceEmpty")}
    </p>`;
  }
  return html`<ol class="ku-deliverable-detail__trace-list">
    ${steps.map((step, index) =>
      renderTraceStep(step, index, focus === "source" && index === sourceStepIndex),
    )}
  </ol>`;
}

// ── Layer 4: 关系 Relationship ────────────────────────────────────────────────
function renderRelationshipRow(params: {
  icon: TemplateResult;
  label: string;
  value: string;
  onOpen?: () => void;
}) {
  const body = html`
    <span class="ku-outcome-rel__icon" aria-hidden="true">${params.icon}</span>
    <span class="ku-outcome-rel__label">${params.label}</span>
    <span class="ku-outcome-rel__value" title=${params.value}>${params.value}</span>
  `;
  if (params.onOpen) {
    return html`<button type="button" class="ku-outcome-rel ku-outcome-rel--link" @click=${params.onOpen}>
      ${body}
    </button>`;
  }
  return html`<div class="ku-outcome-rel">${body}</div>`;
}

function renderRelationshipLayer(
  surface: WorkbenchKnowledgeSurface,
  item: WorkspaceDeliverableDto,
  trace: WorkspaceDeliverableTraceDto | null,
) {
  const kb = item.relatedKnowledgeBaseId
    ? surface.knowledgeBases.find((entry) => entry.id === item.relatedKnowledgeBaseId)
    : null;
  const cited = trace?.citedKnowledge ?? [];
  const rows: TemplateResult[] = [];

  if (item.relatedKnowledgeBaseId) {
    rows.push(
      renderRelationshipRow({
        icon: kuIconFolder("ku-outcome-rel__icon-svg"),
        label: t("frontstage.workbench.knowledgeUniverse.deliverableDetail.relationship.library"),
        value:
          kb?.title ??
          formatDeliverableArchivedLibraryLabel(
            surface.knowledgeBases,
            item.relatedKnowledgeBaseId,
          ),
        onOpen: () => {
          if (item.relatedKnowledgeBaseId) {
            surface.onSelectKnowledgeBase(item.relatedKnowledgeBaseId);
            surface.onPageTabChange("workbench");
          }
        },
      }),
    );
  }
  if (item.groupTitle || item.groupId) {
    rows.push(
      renderRelationshipRow({
        icon: kuIconUser("ku-outcome-rel__icon-svg"),
        label: t("frontstage.workbench.knowledgeUniverse.deliverableDetail.relationship.group"),
        value: item.groupTitle ?? item.groupId ?? "",
      }),
    );
  }
  if (item.taskId) {
    rows.push(
      renderRelationshipRow({
        icon: kuIconLink("ku-outcome-rel__icon-svg"),
        label: t("frontstage.workbench.knowledgeUniverse.deliverableDetail.relationship.task"),
        value: item.taskId,
      }),
    );
  }
  rows.push(
    renderRelationshipRow({
      icon: kuIconRobot("ku-outcome-rel__icon-svg"),
      label: t(
        "frontstage.workbench.knowledgeUniverse.deliverableDetail.relationship.participants",
      ),
      value: resolveOwnerLabel(item),
    }),
  );

  return html`
    <div class="ku-outcome-rel-list">${rows}</div>
    ${
      cited.length > 0
        ? html`<section
            class="ku-deliverable-detail__cited"
            id="ku-deliverable-focus-citations"
          >
            <h4>${t("frontstage.workbench.knowledgeUniverse.deliverableDetail.relationship.citedKnowledge")}</h4>
            <ul class="ku-deliverable-detail__cited-list">
              ${cited.map(
                (entry) => html`
                  <li>
                    <span class="ku-deliverable-detail__cited-title"
                      >${entry.docTitle ?? entry.kbTitle ?? entry.kbId}</span
                    >
                    ${
                      entry.chunkText
                        ? html`<p class="ku-deliverable-detail__cited-chunk">${entry.chunkText}</p>`
                        : nothing
                    }
                  </li>
                `,
              )}
            </ul>
          </section>`
        : nothing
    }
    ${renderDownstreamDeliverables(surface, trace)}
  `;
}

function renderDownstreamDeliverables(
  surface: WorkbenchKnowledgeSurface,
  trace: WorkspaceDeliverableTraceDto | null,
) {
  const downstream = trace?.downstreamDeliverables ?? [];
  return html`
    <section class="ku-deliverable-detail__downstream" id="ku-deliverable-focus-downstream">
      <h4>
        ${t("frontstage.workbench.knowledgeUniverse.deliverableDetail.relationship.downstreamTitle")}
      </h4>
      ${
        downstream.length > 0
          ? html`<ul class="ku-deliverable-detail__downstream-list">
              ${downstream.map((link) => renderDownstreamItem(surface, link))}
            </ul>`
          : html`<span class="ku-deliverable-detail__downstream-empty">
              ${t("frontstage.workbench.knowledgeUniverse.deliverableDetail.relationship.downstreamEmpty")}
            </span>`
      }
    </section>
  `;
}

function renderDownstreamItem(
  surface: WorkbenchKnowledgeSurface,
  link: WorkspaceDeliverableDownstreamLinkDto,
) {
  const title =
    link.title?.trim() ||
    t("frontstage.workbench.knowledgeUniverse.deliverableDetail.relationship.downstreamUntitled");
  return html`<li>
    <button
      type="button"
      class="ku-deliverable-detail__downstream-link"
      data-testid="ku-deliverable-downstream-item"
      data-deliverable-id=${link.deliverableId}
      @click=${() => surface.onViewDeliverable(link.deliverableId)}
    >
      ${kuIconLink("ku-deliverable-detail__downstream-icon")}
      <span class="ku-deliverable-detail__downstream-title">${title}</span>
      ${
        link.agentName
          ? html`<span class="ku-deliverable-detail__downstream-agent"
              >${t("frontstage.workbench.knowledgeUniverse.deliverableDetail.relationship.downstreamConsumer")}
              · ${link.agentName}</span
            >`
          : nothing
      }
    </button>
  </li>`;
}

// ── Layer 5: 治理 Governance ──────────────────────────────────────────────────
function renderGovernanceLayer(surface: WorkbenchKnowledgeSurface, item: WorkspaceDeliverableDto) {
  const archived = Boolean(item.relatedKnowledgeBaseId);
  const targets = suggestArchiveTargets(item, surface.knowledgeBases);
  const selectedKb =
    surface.knowledgeBases.find((kb) => kb.id === surface.selectedKnowledgeBaseId) ?? null;
  const governance = resolveArtifactGovernanceStatus(item);

  return html`
    <aside class="ku-deliverable-detail__archive" id="ku-deliverable-focus-archive">
      <div class="ku-outcome-gov-statusbar">
        <div
          class="ku-outcome-gov-status ku-outcome-gov-status--${governance}"
          data-governance=${governance}
        >
          ${labelArtifactGovernanceStatus(governance)}
        </div>
        ${
          item.stale
            ? html`<div
                class="ku-outcome-gov-status ku-outcome-gov-status--stale"
                data-testid="ku-deliverable-stale"
                title=${t("frontstage.workbench.knowledgeUniverse.deliverableDetail.staleHint")}
              >
                ${t("frontstage.workbench.knowledgeUniverse.deliverableDetail.staleTitle")}
              </div>`
            : nothing
        }
      </div>
      ${
        archived
          ? html`<div class="ku-deliverable-detail__archive-notice ku-deliverable-detail__archive-notice--done">
              ${
                item.relatedKnowledgeBaseId
                  ? formatDeliverableArchivedLibraryLabel(
                      surface.knowledgeBases,
                      item.relatedKnowledgeBaseId,
                    )
                  : t("frontstage.workbench.knowledgeUniverse.workspace.archived")
              }
              <button
                type="button"
                class="btn btn--sm ku-deliverable-detail__archive-view-kb"
                @click=${() => {
                  if (item.relatedKnowledgeBaseId) {
                    surface.onSelectKnowledgeBase(item.relatedKnowledgeBaseId);
                    surface.onPageTabChange("workbench");
                  }
                }}
              >
                ${t("frontstage.workbench.knowledgeUniverse.deliverableDetail.viewInLibrary")}
              </button>
            </div>`
          : html`
              <p class="ku-deliverable-detail__section-sub">
                ${t("frontstage.workbench.knowledgeUniverse.deliverableDetail.archiveSub")}
              </p>
              <ul class="ku-deliverable-detail__archive-list">
                ${
                  targets.length === 0
                    ? html`<li class="ku-deliverable-detail__archive-empty">
                      ${t("frontstage.workbench.knowledgeUniverse.deliverableDetail.archiveNoLibrary")}
                    </li>`
                    : targets.map(
                        (kb) => html`
                        <li class="ku-deliverable-detail__archive-item">
                          <div>
                            <span class="ku-deliverable-detail__archive-name">${kb.title}</span>
                            <span class="ku-deliverable-detail__archive-meta"
                              >${t(
                                "frontstage.workbench.knowledgeUniverse.workspace.documentCount",
                                {
                                  count: kb.documentCount,
                                },
                              )}</span
                            >
                          </div>
                          <button
                            type="button"
                            class="ku-deliverable-detail__archive-btn"
                            ?disabled=${surface.workspaceBusy || surface.selectedKnowledgeBaseId !== kb.id}
                            title=${
                              surface.selectedKnowledgeBaseId === kb.id
                                ? t(
                                    "frontstage.workbench.knowledgeUniverse.workspace.archiveAction",
                                  )
                                : t(
                                    "frontstage.workbench.knowledgeUniverse.deliverableDetail.selectLibraryFirst",
                                    {
                                      title: kb.title,
                                    },
                                  )
                            }
                            @click=${async () => {
                              if (surface.selectedKnowledgeBaseId !== kb.id) {
                                surface.onSelectKnowledgeBase(kb.id);
                                return;
                              }
                              await surface.onArchiveDeliverable(item.deliverableId);
                            }}
                          >
                            ${kuIconArchive("ku-deliverable-detail__archive-icon")}
                            ${
                              surface.selectedKnowledgeBaseId === kb.id
                                ? t(
                                    "frontstage.workbench.knowledgeUniverse.workspace.archiveActionShort",
                                  )
                                : t(
                                    "frontstage.workbench.knowledgeUniverse.deliverableDetail.selectLibrary",
                                  )
                            }
                          </button>
                        </li>
                      `,
                      )
                }
              </ul>
              ${
                selectedKb && !targets.some((kb) => kb.id === selectedKb.id)
                  ? html`<button
                      type="button"
                      class="btn btn--sm btn--primary ku-deliverable-detail__archive-primary"
                      ?disabled=${surface.workspaceBusy}
                      @click=${() => void surface.onArchiveDeliverable(item.deliverableId)}
                    >
                      ${t("frontstage.workbench.knowledgeUniverse.workspace.archiveAction")}
                    </button>`
                  : nothing
              }
            `
      }

      <section class="ku-deliverable-detail__archive-hints">
        <h4>${t("frontstage.workbench.knowledgeUniverse.deliverableDetail.conflictHeading")}</h4>
        <p>
          ${
            governance === "conflict"
              ? t("frontstage.workbench.knowledgeUniverse.deliverableDetail.conflictFound")
              : t("frontstage.workbench.knowledgeUniverse.deliverableDetail.conflictClear")
          }
        </p>
      </section>
    </aside>
  `;
}

export function resolveSelectedDeliverable(
  surface: WorkbenchKnowledgeSurface,
): WorkspaceDeliverableDto | null {
  return resolveDeliverable(surface);
}

export function renderKnowledgeUniverseDeliverableDetailPage(surface: WorkbenchKnowledgeSurface) {
  const item = resolveDeliverable(surface);
  const trace = surface.workspaceDeliverableTrace;
  const focus = surface.deliverableDetailFocus;
  if (!item) {
    return html`
      <div class="ku-deliverable-detail ku-deliverable-detail--empty">
        <p>${t("frontstage.workbench.knowledgeUniverse.deliverableDetail.notFound")}</p>
        <button type="button" class="btn btn--sm" @click=${() => surface.onPageTabChange("workbench")}>
          ${t("frontstage.workbench.knowledgeUniverse.deliverableDetail.backToCenter")}
        </button>
      </div>
    `;
  }

  return html`
    <div class="ku-deliverable-detail ku-deliverable-detail--layers">
      <header class="ku-deliverable-detail__toolbar">
        <button
          type="button"
          class="btn btn--sm"
          @click=${() => surface.onPageTabChange("workbench")}
        >
          ${t("frontstage.workbench.knowledgeUniverse.deliverableDetail.backToCenter")}
        </button>
        <div class="ku-deliverable-detail__toolbar-actions">
          ${
            surface.onRefreshDeliverableTrace
              ? html`<button
                  type="button"
                  class="btn btn--sm"
                  ?disabled=${surface.workspaceDeliverableTraceLoading}
                  @click=${() => void surface.onRefreshDeliverableTrace?.()}
                >
                  ${
                    surface.workspaceDeliverableTraceLoading
                      ? t("frontstage.workbench.knowledgeUniverse.deliverableDetail.traceLoading")
                      : t("frontstage.workbench.knowledgeUniverse.deliverableDetail.refreshTrace")
                  }
                </button>`
              : nothing
          }
          ${
            !item.relatedKnowledgeBaseId
              ? html`<button
                  type="button"
                  class="btn btn--sm btn--primary"
                  ?disabled=${surface.workspaceBusy || !surface.selectedKnowledgeBaseId}
                  @click=${() => void surface.onArchiveDeliverable(item.deliverableId)}
                >
                  ${t("frontstage.workbench.knowledgeUniverse.workspace.archiveAction")}
                </button>`
              : nothing
          }
        </div>
      </header>

      ${renderOutcomeLayer({
        key: "content",
        index: 1,
        title: t("frontstage.workbench.knowledgeUniverse.deliverableDetail.layer.contentTitle"),
        subtitle: t("frontstage.workbench.knowledgeUniverse.deliverableDetail.layer.contentSub"),
        focusClass: focusSectionClass(focus, "preview"),
        body: renderContentLayer(item, trace),
      })}
      ${renderOutcomeLayer({
        key: "semantic",
        index: 2,
        title: t("frontstage.workbench.knowledgeUniverse.deliverableDetail.layer.semanticTitle"),
        subtitle: t("frontstage.workbench.knowledgeUniverse.deliverableDetail.layer.semanticSub"),
        body: renderSemanticLayer(item, trace),
      })}
      ${renderOutcomeLayer({
        key: "lineage",
        index: 3,
        title: t("frontstage.workbench.knowledgeUniverse.deliverableDetail.layer.lineageTitle"),
        subtitle: t("frontstage.workbench.knowledgeUniverse.deliverableDetail.layer.lineageSub"),
        focusClass: focusSectionClass(focus, "trace", "source"),
        body: renderLineageLayer(surface, trace),
      })}
      ${renderOutcomeLayer({
        key: "relationship",
        index: 4,
        title: t(
          "frontstage.workbench.knowledgeUniverse.deliverableDetail.layer.relationshipTitle",
        ),
        subtitle: t(
          "frontstage.workbench.knowledgeUniverse.deliverableDetail.layer.relationshipSub",
        ),
        focusClass: focusSectionClass(focus, "citations"),
        body: renderRelationshipLayer(surface, item, trace),
      })}
      ${renderOutcomeLayer({
        key: "governance",
        index: 5,
        title: t("frontstage.workbench.knowledgeUniverse.deliverableDetail.layer.governanceTitle"),
        subtitle: t("frontstage.workbench.knowledgeUniverse.deliverableDetail.layer.governanceSub"),
        focusClass: focusSectionClass(focus, "archive"),
        body: renderGovernanceLayer(surface, item),
      })}
    </div>
  `;
}
