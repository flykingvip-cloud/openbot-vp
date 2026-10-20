import { html, nothing } from "lit";
import { t } from "../../i18n/index.ts";
import type {
  DeliverableGovernanceAction,
  WorkspaceDeliverableDto,
} from "../capability/knowledge-universe/workspace-endpoints.ts";
import type {
  WorkbenchKnowledgeSurface,
  WorkspaceDeliverableStatusFilter,
} from "../ports/employee/views/home-page-contracts.ts";
import {
  focusKnowledgeUniverseField,
  navigateKnowledgeUniverseAnchor,
} from "./knowledge-universe-anchor-nav.ts";
import { KNOWLEDGE_UNIVERSE_ANCHORS } from "./knowledge-universe-anchors.ts";
import { resolveArtifactGovernanceStatus } from "./knowledge-universe-artifact-taxonomy.ts";
import { openKnowledgeSpaceCreatePage } from "./knowledge-universe-create-entry.ts";
import {
  kuIconArchive,
  kuIconDocumentUpload,
  kuIconEye,
  kuIconFolder,
  kuIconMore,
  kuIconUser,
} from "./knowledge-universe-icons.ts";
import { partitionKnowledgeBasesForSidebar } from "./knowledge-universe-library-grouping.ts";
import { renderKnowledgeUniverseWorkspaceMetricStrip } from "./knowledge-universe-metric-strip.ts";
import {
  labelKnowledgeUniverseEvidenceSource,
  renderKnowledgeUniverseSourcePaletteClass,
  resolveKnowledgeUniverseSourcePalette,
} from "./knowledge-universe-source-palette.ts";
import { highlightSearchTerms } from "./knowledge-universe-text-highlight.ts";
import {
  renderArtifactGovernanceTrustBadge,
  renderEvidenceTrustBadges,
  renderKnowledgeBaseRuntimeBadges,
} from "./knowledge-universe-trust-badges.ts";

const DELIVERABLE_PREVIEW_LIMIT = 5;

function formatEvidenceCitation(item: {
  docTitle: string;
  versionLabel?: string;
  section?: string;
  heading?: string;
}): string {
  const version = item.versionLabel ? ` ${item.versionLabel}` : "";
  const section = item.section?.trim() || item.heading?.trim();
  return section ? `《${item.docTitle}${version}》${section}` : `《${item.docTitle}${version}》`;
}

function formatUpdatedAt(updatedAtMs: number): string {
  if (!updatedAtMs) {
    return t("frontstage.workbench.knowledgeUniverse.workspace.updatedUnknown");
  }
  const updated = new Date(updatedAtMs);
  const now = new Date();
  const sameDay =
    updated.getFullYear() === now.getFullYear() &&
    updated.getMonth() === now.getMonth() &&
    updated.getDate() === now.getDate();
  if (sameDay) {
    return t("frontstage.workbench.knowledgeUniverse.workspace.updatedToday");
  }
  return updated.toLocaleDateString();
}

function formatDeliverableRelativeTime(updatedAtMs: number): string {
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
  return formatUpdatedAt(updatedAtMs);
}

function looksLikeOpaqueCreatorId(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed) {
    return true;
  }
  if (/^(bot-|user-|agent-|skill:|del-|main$|agent$)/i.test(trimmed)) {
    return true;
  }
  if (/^[a-f0-9-]{8,}$/i.test(trimmed)) {
    return true;
  }
  return false;
}

function resolveDeliverableOwnerLabel(item: WorkspaceDeliverableDto): string {
  const primary = item.primaryCreatorName?.trim();
  if (primary && !looksLikeOpaqueCreatorId(primary)) {
    return primary;
  }
  if (item.creators.length > 0) {
    const named = item.creators.find((creator) => !looksLikeOpaqueCreatorId(creator));
    if (named) {
      return named;
    }
  }
  if (item.groupTitle?.trim()) {
    return item.groupTitle.trim();
  }
  if (primary) {
    return primary;
  }
  return t("frontstage.workbench.knowledgeUniverse.workspace.deliverableOwnerFallback");
}

function resolveDeliverableBucket(item: WorkspaceDeliverableDto): WorkspaceDeliverableStatusFilter {
  if (item.relatedKnowledgeBaseId || item.status === "archived") {
    return "archived";
  }
  if (item.status === "draft") {
    return "draft";
  }
  if (item.status === "submitted" || item.status === "in_review") {
    return "in_progress";
  }
  if (item.status === "approved" || item.status === "published") {
    return "done";
  }
  return "in_progress";
}

function filterDeliverables(
  items: WorkspaceDeliverableDto[],
  filter: WorkspaceDeliverableStatusFilter,
): WorkspaceDeliverableDto[] {
  if (filter === "all") {
    return items;
  }
  return items.filter((item) => resolveDeliverableBucket(item) === filter);
}

function renderDeliverablesTableHeader() {
  return html`
    <div
      class="knowledge-universe__deliverable-row-grid knowledge-universe__deliverable-row-grid--head"
      role="row"
    >
      <span
        class="knowledge-universe__deliverable-col-head knowledge-universe__deliverable-col-head--index"
        role="columnheader"
      >
        ${t("frontstage.workbench.knowledgeUniverse.workspace.deliverableColIndex")}
      </span>
      <span class="knowledge-universe__deliverable-col-head" role="columnheader">
        ${t("frontstage.workbench.knowledgeUniverse.workspace.deliverableColTitle")}
      </span>
      <span
        class="knowledge-universe__deliverable-col-head knowledge-universe__deliverable-col-head--owner"
        role="columnheader"
      >
        ${t("frontstage.workbench.knowledgeUniverse.workspace.deliverableColOwner")}
      </span>
      <span
        class="knowledge-universe__deliverable-col-head knowledge-universe__deliverable-col-head--time"
        role="columnheader"
      >
        ${t("frontstage.workbench.knowledgeUniverse.workspace.deliverableColTime")}
      </span>
      <span
        class="knowledge-universe__deliverable-col-head knowledge-universe__deliverable-col-head--actions"
        role="columnheader"
      >
        ${t("frontstage.workbench.knowledgeUniverse.workspace.deliverableColActions")}
      </span>
    </div>
  `;
}

function renderDeliverableListRow(
  surface: WorkbenchKnowledgeSurface,
  item: WorkspaceDeliverableDto,
  selectedKb: { id: string; title: string } | null,
  rowIndex: number,
) {
  return html`
    <article
      id=${
        item.deliverableId === surface.selectedWorkspaceSearchDeliverableId
          ? KNOWLEDGE_UNIVERSE_ANCHORS.deliverableFocus
          : nothing
      }
      class="knowledge-universe__deliverable-row ${item.deliverableId === surface.selectedWorkspaceSearchDeliverableId ? "is-selected" : ""} ${surface.openDeliverableMoreMenuId === item.deliverableId ? "is-menu-open" : ""}"
      role="row"
    >
      <div class="knowledge-universe__deliverable-row-grid">
        <span class="knowledge-universe__deliverable-index" aria-hidden="true">${rowIndex}</span>
        <div class="knowledge-universe__deliverable-titlecell knowledge-universe__deliverable-titlecell--inline">
          <span class="knowledge-universe__deliverable-title" title=${item.title}>${item.title}</span>
        </div>
        <span class="knowledge-universe__deliverable-owner" title=${resolveDeliverableOwnerLabel(item)}>
          <span class="knowledge-universe__deliverable-owner-icon" aria-hidden="true"
            >${kuIconUser("knowledge-universe__deliverable-owner-icon-svg")}</span
          >
          <span class="knowledge-universe__deliverable-owner-label"
            >${resolveDeliverableOwnerLabel(item)}</span
          >
        </span>
        ${renderDeliverableTimeCell(item)}
        ${renderDeliverableActions(surface, item, selectedKb)}
      </div>
    </article>
  `;
}

function renderDeliverableTimeCell(item: WorkspaceDeliverableDto) {
  return html`
    <span class="knowledge-universe__deliverable-time-cell">
      <span class="knowledge-universe__deliverable-time"
        >${formatDeliverableRelativeTime(item.updatedAtMs)}</span
      >
      ${renderArtifactGovernanceIndicator(item)}
    </span>
  `;
}

function renderDeliverableMoreItem(
  surface: WorkbenchKnowledgeSurface,
  item: WorkspaceDeliverableDto,
  action: DeliverableGovernanceAction,
  label: string,
) {
  return html`
    <button
      type="button"
      class="knowledge-universe__deliverable-more-item"
      role="menuitem"
      @click=${(event: Event) => {
        event.stopPropagation();
        void surface.onDeliverableGovernanceAction(item.deliverableId, action);
      }}
    >
      ${label}
    </button>
  `;
}

function renderDeliverableArchiveMenuItem(
  surface: WorkbenchKnowledgeSurface,
  item: WorkspaceDeliverableDto,
  selectedKb: { id: string; title: string } | null,
) {
  const archived = Boolean(item.relatedKnowledgeBaseId);
  const archiveLabel = archived
    ? t("frontstage.workbench.knowledgeUniverse.workspace.archived")
    : selectedKb
      ? t("frontstage.workbench.knowledgeUniverse.workspace.archiveAction")
      : t("frontstage.workbench.knowledgeUniverse.workspace.archiveActionSelectLibrary");
  return html`
    <button
      type="button"
      class="knowledge-universe__deliverable-more-item knowledge-universe__deliverable-more-item--accent"
      role="menuitem"
      data-testid="ku-deliverable-archive-item"
      ?disabled=${surface.workspaceBusy || archived}
      @click=${(event: Event) => {
        event.stopPropagation();
        surface.onDeliverableMoreMenuChange(null);
        void surface.onArchiveDeliverable(item.deliverableId);
      }}
    >
      <span class="knowledge-universe__deliverable-more-item-icon" aria-hidden="true"
        >${kuIconArchive("knowledge-universe__deliverable-action-icon")}</span
      >
      ${archiveLabel}
    </button>
  `;
}

// Destructive [删除] menu item — confirms before permanently deleting the deliverable.
function renderDeliverableDeleteMenuItem(
  surface: WorkbenchKnowledgeSurface,
  item: WorkspaceDeliverableDto,
) {
  return html`
    <button
      type="button"
      class="knowledge-universe__deliverable-more-item knowledge-universe__deliverable-more-item--danger"
      role="menuitem"
      data-testid="ku-deliverable-delete-item"
      ?disabled=${surface.workspaceBusy}
      @click=${(event: Event) => {
        event.stopPropagation();
        surface.onDeliverableMoreMenuChange(null);
        const confirmed = window.confirm(
          t("frontstage.workbench.knowledgeUniverse.workspace.deliverableDeleteConfirm", {
            title: item.title,
          }),
        );
        if (!confirmed) {
          return;
        }
        void surface.onDeleteDeliverable(item.deliverableId);
      }}
    >
      ${t("frontstage.workbench.knowledgeUniverse.workspace.deliverableDelete")}
    </button>
  `;
}

// High-density row actions: one highlighted primary [查看] button per row; every
// secondary action (沉淀/归档 + governance) collapses into the 更多(··) overflow menu
// so the table no longer wastes visual bandwidth on a row of disabled buttons.
function renderDeliverableActions(
  surface: WorkbenchKnowledgeSurface,
  item: WorkspaceDeliverableDto,
  selectedKb: { id: string; title: string } | null,
) {
  const viewLabel = t("frontstage.workbench.knowledgeUniverse.workspace.deliverableView");
  const moreShortLabel = t("frontstage.workbench.knowledgeUniverse.workspace.deliverableMoreShort");
  const menuOpen = surface.openDeliverableMoreMenuId === item.deliverableId;

  return html`
    <div class="knowledge-universe__deliverable-governance-actions knowledge-universe__deliverable-governance-actions--dense">
      <button
        type="button"
        class="knowledge-universe__deliverable-action knowledge-universe__deliverable-action--labeled knowledge-universe__deliverable-action--primary"
        data-testid="ku-deliverable-view"
        title=${viewLabel}
        aria-label=${viewLabel}
        @click=${() => surface.onViewDeliverable(item.deliverableId)}
      >
        ${kuIconEye("knowledge-universe__deliverable-action-icon")}
        <span class="knowledge-universe__deliverable-action-label">${viewLabel}</span>
      </button>
      <div class="knowledge-universe__deliverable-more ${menuOpen ? "is-open" : ""}">
        <button
          type="button"
          class="knowledge-universe__deliverable-action knowledge-universe__deliverable-action--icon"
          data-testid="ku-deliverable-more"
          title=${t("frontstage.workbench.knowledgeUniverse.workspace.deliverableMore")}
          aria-label=${moreShortLabel}
          aria-expanded=${menuOpen ? "true" : "false"}
          aria-haspopup="menu"
          @click=${(event: Event) => {
            event.stopPropagation();
            surface.onDeliverableMoreMenuChange(menuOpen ? null : item.deliverableId);
          }}
        >
          ${kuIconMore("knowledge-universe__deliverable-action-icon")}
        </button>
        ${
          menuOpen
            ? html`<div
                class="knowledge-universe__deliverable-more-menu"
                role="menu"
                @click=${(event: Event) => event.stopPropagation()}
                @mousedown=${(event: Event) => event.stopPropagation()}
              >
                ${renderDeliverableArchiveMenuItem(surface, item, selectedKb)}
                <div class="knowledge-universe__deliverable-more-divider" role="separator"></div>
                ${renderDeliverableMoreItem(
                  surface,
                  item,
                  "viewRelations",
                  t(
                    "frontstage.workbench.knowledgeUniverse.workspace.deliverableGovernance.viewRelations",
                  ),
                )}
                ${renderDeliverableMoreItem(
                  surface,
                  item,
                  "viewCitations",
                  t(
                    "frontstage.workbench.knowledgeUniverse.workspace.deliverableGovernance.viewCitations",
                  ),
                )}
                ${renderDeliverableMoreItem(
                  surface,
                  item,
                  "viewSource",
                  t(
                    "frontstage.workbench.knowledgeUniverse.workspace.deliverableGovernance.viewSource",
                  ),
                )}
                ${renderDeliverableMoreItem(
                  surface,
                  item,
                  "mergeKnowledge",
                  t(
                    "frontstage.workbench.knowledgeUniverse.workspace.deliverableGovernance.mergeKnowledge",
                  ),
                )}
                ${renderDeliverableMoreItem(
                  surface,
                  item,
                  "markInvalid",
                  t(
                    "frontstage.workbench.knowledgeUniverse.workspace.deliverableGovernance.markInvalid",
                  ),
                )}
                ${renderDeliverableMoreItem(
                  surface,
                  item,
                  "assignExpert",
                  t(
                    "frontstage.workbench.knowledgeUniverse.workspace.deliverableGovernance.assignExpert",
                  ),
                )}
                <div class="knowledge-universe__deliverable-more-divider" role="separator"></div>
                ${renderDeliverableDeleteMenuItem(surface, item)}
              </div>`
            : nothing
        }
      </div>
    </div>
  `;
}

function renderArtifactGovernanceIndicator(item: WorkspaceDeliverableDto) {
  const status = resolveArtifactGovernanceStatus(item);
  return renderArtifactGovernanceTrustBadge(status, {
    testId: "ku-deliverable-governance-badge",
  });
}

function renderEvidenceSourcePill(sourceKind: string) {
  const palette = resolveKnowledgeUniverseSourcePalette(sourceKind);
  return html`
    <span
      class=${renderKnowledgeUniverseSourcePaletteClass(palette, "knowledge-universe__source-pill")}
    >
      ${labelKnowledgeUniverseEvidenceSource(sourceKind)}
    </span>
  `;
}

function renderStatusChip(
  surface: WorkbenchKnowledgeSurface,
  filter: WorkspaceDeliverableStatusFilter,
  label: string,
) {
  const active = surface.workspaceDeliverableStatusFilter === filter;
  return html`
    <button
      type="button"
      class="knowledge-universe__status-chip ${active ? "is-active" : ""}"
      @click=${() => surface.onDeliverableStatusFilterChange(filter)}
    >
      ${label}
    </button>
  `;
}

export function renderEmptyLibraryCard(
  surface: WorkbenchKnowledgeSurface,
  options?: { onOpenLibraryCreate?: () => void },
) {
  return html`
    <div class="knowledge-universe__library-empty-card">
      <div class="knowledge-universe__library-empty-visual knowledge-universe__library-empty-visual--upload" aria-hidden="true">
        ${kuIconDocumentUpload("knowledge-universe__library-empty-icon")}
      </div>
      <h3 class="knowledge-universe__library-empty-title">
        ${t("frontstage.workbench.knowledgeUniverse.workspace.emptyLibraries")}
      </h3>
      <p class="knowledge-universe__library-empty-copy">
        ${t("frontstage.workbench.knowledgeUniverse.workspace.emptyLibraryHeroCopy")}
      </p>
      <div class="knowledge-universe__workspace-create knowledge-universe__workspace-create--empty">
        <button
          type="button"
          class="btn btn--primary knowledge-universe__create-submit knowledge-universe__create-submit--hero"
          data-testid="ku-formal-create-space"
          ?disabled=${surface.workspaceBusy}
          @click=${() =>
            options?.onOpenLibraryCreate
              ? options.onOpenLibraryCreate()
              : openKnowledgeSpaceCreatePage(surface)}
        >
          ${t("frontstage.workbench.knowledgeUniverse.workspace.createAction")}
        </button>
      </div>
    </div>
  `;
}

function promptSelectLibraryForArchive(surface: WorkbenchKnowledgeSurface) {
  navigateKnowledgeUniverseAnchor(KNOWLEDGE_UNIVERSE_ANCHORS.workspace);
  if (surface.knowledgeBases.length === 0) {
    openKnowledgeSpaceCreatePage(surface);
    return;
  }
  const firstLibrary = document.querySelector<HTMLElement>(
    ".knowledge-universe__library-column .ku-cockpit__tree-leaf",
  );
  firstLibrary?.focus();
}

function renderHomeLibrarySection(
  surface: WorkbenchKnowledgeSurface,
  title: string,
  libraries: import("../capability/knowledge-universe/workspace-endpoints.ts").KnowledgeBaseSummary[],
  options?: { onOpenLibraryWorkspace?: () => void },
) {
  if (libraries.length === 0) {
    return nothing;
  }
  return html`
    <div class="knowledge-universe__library-home-section">
      <h4 class="knowledge-universe__library-home-section-title">${title}</h4>
      <div class="knowledge-universe__workspace-list knowledge-universe__workspace-list--cards">
        ${libraries.map(
          (kb) => html`
            <button
              type="button"
              class="knowledge-universe__workspace-item knowledge-universe__workspace-item--row ${
                surface.selectedKnowledgeBaseId === kb.id ? "is-active" : ""
              }"
              @click=${() => {
                surface.onSelectKnowledgeBase(kb.id);
                options?.onOpenLibraryWorkspace?.();
              }}
            >
              <span class="knowledge-universe__workspace-item-icon" aria-hidden="true"
                >${kuIconFolder("knowledge-universe__workspace-item-icon-svg")}</span
              >
              <span class="knowledge-universe__workspace-item-body">
                <span class="knowledge-universe__workspace-item-title">${kb.title}</span>
                <span class="knowledge-universe__workspace-item-meta">
                  ${t("frontstage.workbench.knowledgeUniverse.workspace.lastUpdated", {
                    when: formatUpdatedAt(kb.updatedAtMs),
                  })}
                </span>
              </span>
              <span class="knowledge-universe__workspace-item-count">
                ${renderKnowledgeBaseRuntimeBadges(kb)}
              </span>
            </button>
          `,
        )}
      </div>
    </div>
  `;
}

function renderLibraryList(
  surface: WorkbenchKnowledgeSurface,
  options?: { onOpenLibraryWorkspace?: () => void; onOpenLibraryCreate?: () => void },
) {
  const grouped = partitionKnowledgeBasesForSidebar(surface);
  return html`
    <div class="knowledge-universe__library-list">
      <button
        type="button"
        class="btn btn--primary knowledge-universe__create-submit knowledge-universe__create-submit--hero knowledge-universe__create-submit--compact"
        ?disabled=${surface.workspaceBusy}
        @click=${() =>
          options?.onOpenLibraryCreate
            ? options.onOpenLibraryCreate()
            : openKnowledgeSpaceCreatePage(surface)}
      >
        ${t("frontstage.workbench.knowledgeUniverse.supplySpaces.createAction")}
      </button>
      ${renderHomeLibrarySection(
        surface,
        t("frontstage.workbench.knowledgeUniverse.libraryWorkspace.pinnedHeading"),
        grouped.pinned,
        options,
      )}
      ${renderHomeLibrarySection(
        surface,
        t("frontstage.workbench.knowledgeUniverse.libraryWorkspace.favoritesHeading"),
        grouped.favorites,
        options,
      )}
      ${renderHomeLibrarySection(
        surface,
        t("frontstage.workbench.knowledgeUniverse.libraryWorkspace.treeSectionPersonal"),
        grouped.privateSpaces,
        options,
      )}
      ${renderHomeLibrarySection(
        surface,
        t("frontstage.workbench.knowledgeUniverse.libraryWorkspace.treeSectionTeam"),
        grouped.teamSpaces,
        options,
      )}
      ${renderHomeLibrarySection(
        surface,
        t("frontstage.workbench.knowledgeUniverse.libraryWorkspace.treeSectionEnterprise"),
        grouped.enterpriseSpaces,
        options,
      )}
    </div>
  `;
}

function renderLibraryColumn(
  surface: WorkbenchKnowledgeSurface,
  options?: {
    onOpenLibraryWorkspace?: () => void;
    onOpenLibraryCreate?: () => void;
    onOpenGovernance?: () => void;
    onExpandRelations?: () => void;
    onOpenMyAssets?: () => void;
  },
) {
  const hasLibraries = surface.knowledgeBases.length > 0;
  const hasSelection = Boolean(surface.selectedKnowledgeBaseId);

  return html`
    <div class="knowledge-universe__stage-card knowledge-universe__library-column ${hasSelection ? "is-selected" : ""}">
      <div class="knowledge-universe__stage-card-head knowledge-universe__stage-card-head--library">
        <div class="knowledge-universe__stage-card-head-main">
          <span class="knowledge-universe__panel-title">
            ${t("frontstage.workbench.knowledgeUniverse.workspace.librariesHeading")}
          </span>
          ${renderKnowledgeUniverseWorkspaceMetricStrip(surface, {
            onOpenGovernance: options?.onOpenGovernance,
            onExpandRelations: options?.onExpandRelations,
          })}
        </div>
        <div class="knowledge-universe__stage-card-head-actions">
          ${
            options?.onOpenMyAssets
              ? html`
                  <button
                    type="button"
                    class="knowledge-universe__stage-card-link"
                    data-testid="ku-my-assets-workspace-link"
                    @click=${() => options.onOpenMyAssets?.()}
                  >
                    ${t("frontstage.workbench.knowledgeUniverse.quickActions.myAssets")}
                  </button>
                `
              : nothing
          }
          <button
            type="button"
            class="knowledge-universe__stage-card-link"
            @click=${() =>
              options?.onOpenLibraryWorkspace
                ? options.onOpenLibraryWorkspace()
                : focusKnowledgeUniverseField(KNOWLEDGE_UNIVERSE_ANCHORS.libraryCreateTitle)}
          >
            ${t("frontstage.workbench.knowledgeUniverse.workspace.manageAllLibraries")}
          </button>
        </div>
      </div>
      <div class="knowledge-universe__stage-card-body">
        ${hasLibraries ? renderLibraryList(surface, options) : renderEmptyLibraryCard(surface, options)}
      </div>
    </div>
  `;
}

function renderDeliverablesSection(
  surface: WorkbenchKnowledgeSurface,
  options?: { forceExpanded?: boolean; onViewAll?: () => void; embedded?: boolean },
) {
  const filteredDeliverables = filterDeliverables(
    surface.workspaceDeliverables,
    surface.workspaceDeliverableStatusFilter,
  );
  const showAll = options?.forceExpanded === true || surface.workspaceDeliverablesExpanded;
  const preview = showAll
    ? filteredDeliverables
    : filteredDeliverables.slice(0, DELIVERABLE_PREVIEW_LIMIT);
  const showStatusFilters = surface.workspaceDeliverables.length > 0;
  const selectedKb =
    surface.knowledgeBases.find((item) => item.id === surface.selectedKnowledgeBaseId) ?? null;
  const hasUnarchivedDeliverables = surface.workspaceDeliverables.some(
    (item) => !item.relatedKnowledgeBaseId,
  );
  const showArchiveLibraryHint =
    !surface.workspaceDeliverablesUnavailable &&
    !selectedKb &&
    hasUnarchivedDeliverables &&
    !options?.forceExpanded;
  const openDeliverables = () => {
    if (options?.onViewAll) {
      options.onViewAll();
      return;
    }
    surface.onWorkspaceDeliverablesExpandedChange(true);
  };

  const tableBody = html`
    <div class="knowledge-universe__stage-card-body">
      ${
        surface.workspaceDeliverablesUnavailable
          ? html`
              <div class="knowledge-universe__inline-notice" role="status">
                <div class="knowledge-universe__inline-notice-title">
                  ${t("frontstage.workbench.knowledgeUniverse.workspace.deliverablesUnavailableTitle")}
                </div>
                <p>${t("frontstage.workbench.knowledgeUniverse.workspace.deliverablesUnavailableCopy")}</p>
              </div>
            `
          : preview.length === 0
            ? html`
                <div class="knowledge-universe__inline-notice knowledge-universe__inline-notice--muted">
                  <p>${t("frontstage.workbench.knowledgeUniverse.workspace.emptyDeliverablesCopy")}</p>
                </div>
              `
            : html`
                <div
                  class="knowledge-universe__deliverables-list knowledge-universe__deliverables-list--panel knowledge-universe__deliverables-table"
                  role="table"
                  aria-label=${t("frontstage.workbench.knowledgeUniverse.workspace.deliverablesHeading")}
                  @click=${() => surface.onDeliverableMoreMenuChange(null)}
                >
                  ${renderDeliverablesTableHeader()}
                  ${preview.map((item, index) =>
                    renderDeliverableListRow(surface, item, selectedKb, index + 1),
                  )}
                </div>
              `
      }
    </div>
  `;

  const statusToolbar =
    showStatusFilters && !options?.embedded
      ? html`<div class="knowledge-universe__stage-card-toolbar">
          <div
            class="knowledge-universe__status-filters knowledge-universe__segmented knowledge-universe__segmented--compact knowledge-universe__status-filters--toolbar"
            role="group"
            aria-label=${t("frontstage.workbench.knowledgeUniverse.workspace.statusFilterLabel")}
          >
            ${renderStatusChip(
              surface,
              "all",
              t("frontstage.workbench.knowledgeUniverse.workspace.statusAll"),
            )}
            ${renderStatusChip(
              surface,
              "draft",
              t("frontstage.workbench.knowledgeUniverse.workspace.statusDraft"),
            )}
            ${renderStatusChip(
              surface,
              "in_progress",
              t("frontstage.workbench.knowledgeUniverse.workspace.statusInProgress"),
            )}
            ${renderStatusChip(
              surface,
              "done",
              t("frontstage.workbench.knowledgeUniverse.workspace.statusDone"),
            )}
            ${renderStatusChip(
              surface,
              "archived",
              t("frontstage.workbench.knowledgeUniverse.workspace.statusArchived"),
            )}
          </div>
          ${
            showArchiveLibraryHint
              ? html`<button
                  type="button"
                  class="btn btn--sm knowledge-universe__archive-library-hint"
                  @click=${() => promptSelectLibraryForArchive(surface)}
                >
                  ${t("frontstage.workbench.knowledgeUniverse.workspace.archiveActionSelectLibrary")}
                </button>`
              : nothing
          }
        </div>`
      : nothing;

  if (options?.embedded) {
    return html`
      <div class="ku-output-center__table-shell">
        ${
          showStatusFilters
            ? html`<div class="ku-output-center__toolbar">
                <div
                  class="knowledge-universe__status-filters knowledge-universe__segmented knowledge-universe__segmented--compact"
                  role="group"
                  aria-label=${t("frontstage.workbench.knowledgeUniverse.workspace.statusFilterLabel")}
                >
                  ${renderStatusChip(
                    surface,
                    "all",
                    t("frontstage.workbench.knowledgeUniverse.workspace.statusAll"),
                  )}
                  ${renderStatusChip(
                    surface,
                    "draft",
                    t("frontstage.workbench.knowledgeUniverse.workspace.statusDraft"),
                  )}
                  ${renderStatusChip(
                    surface,
                    "in_progress",
                    t("frontstage.workbench.knowledgeUniverse.workspace.statusInProgress"),
                  )}
                  ${renderStatusChip(
                    surface,
                    "done",
                    t("frontstage.workbench.knowledgeUniverse.workspace.statusDone"),
                  )}
                  ${renderStatusChip(
                    surface,
                    "archived",
                    t("frontstage.workbench.knowledgeUniverse.workspace.statusArchived"),
                  )}
                </div>
              </div>`
            : nothing
        }
        ${tableBody}
      </div>
    `;
  }

  return html`
    <section
      id=${KNOWLEDGE_UNIVERSE_ANCHORS.deliverables}
      class="knowledge-universe__stage-card knowledge-universe__deliverables-panel ${preview.length <= 1 ? "is-compact" : ""} ${options?.forceExpanded ? "knowledge-universe__deliverables-panel--full" : ""}"
    >
      <div class="knowledge-universe__stage-card-head knowledge-universe__stage-card-head--deliverables">
        <div class="knowledge-universe__stage-card-head-top">
          <span class="knowledge-universe__panel-title">
            ${t("frontstage.workbench.knowledgeUniverse.workspace.deliverablesHeading")}
          </span>
          ${
            options?.forceExpanded
              ? nothing
              : html`<button
                  type="button"
                  class="knowledge-universe__stage-card-link"
                  @click=${openDeliverables}
                >
                  ${t("frontstage.workbench.knowledgeUniverse.workspace.viewAllShort")}
                </button>`
          }
        </div>
        ${statusToolbar}
      </div>
      ${tableBody}
    </section>
  `;
}

export function renderKnowledgeUniverseLibrarySearchResults(surface: WorkbenchKnowledgeSurface) {
  if (
    surface.kbSearchEvidence.length === 0 &&
    surface.kbSearchSubstringResults.length === 0 &&
    !surface.kbSearchMode
  ) {
    return nothing;
  }

  const highlightKey = surface.selectedKbSearchHighlightKey;
  const highlightQuery = (surface.query || surface.kbSearchQuery).trim();
  const evidencePaletteClass = (sourceKind: string) =>
    renderKnowledgeUniverseSourcePaletteClass(
      resolveKnowledgeUniverseSourcePalette(sourceKind),
      "knowledge-universe__evidence-card",
    );

  return html`
    <div class="knowledge-universe__library-search-results knowledge-universe__library-search-results--overlay">
      ${
        surface.kbSearchMode
          ? html`<div class="knowledge-universe__workspace-mode">
              ${t("frontstage.workbench.knowledgeUniverse.workspace.searchMode", {
                mode: surface.kbSearchMode,
              })}
            </div>`
          : nothing
      }
      <div class="knowledge-universe__workspace-results">
        ${
          surface.kbSearchEvidence.length > 0
            ? surface.kbSearchEvidence.map(
                (item) => html`
                  <article
                    id=${
                      item.docId === highlightKey
                        ? KNOWLEDGE_UNIVERSE_ANCHORS.kbSearchFocus
                        : nothing
                    }
                    class="${evidencePaletteClass(item.sourceKind)} knowledge-universe__evidence-card--flat ${item.docId === highlightKey ? "is-selected" : ""}"
                    role="button"
                    tabindex="0"
                    @click=${() => surface.onKbSearchHighlightKeyChange(item.docId)}
                    @keydown=${(event: KeyboardEvent) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        surface.onKbSearchHighlightKeyChange(item.docId);
                      }
                    }}
                  >
                    <div class="knowledge-universe__evidence-head">
                      ${renderEvidenceSourcePill(item.sourceKind)}
                      <div class="knowledge-universe__evidence-title">
                        ${highlightSearchTerms(formatEvidenceCitation(item), highlightQuery)}
                      </div>
                      ${renderEvidenceTrustBadges(item)}
                    </div>
                    <p class="knowledge-universe__evidence-excerpt">
                      ${highlightSearchTerms(item.chunkText, highlightQuery)}
                    </p>
                  </article>
                `,
              )
            : surface.kbSearchSubstringResults.map(
                (item) => html`
                  <article
                    id=${
                      item.id === highlightKey ? KNOWLEDGE_UNIVERSE_ANCHORS.kbSearchFocus : nothing
                    }
                    class="${evidencePaletteClass("knowledge")} knowledge-universe__evidence-card--flat ${item.id === highlightKey ? "is-selected" : ""}"
                    role="button"
                    tabindex="0"
                    @click=${() => surface.onKbSearchHighlightKeyChange(item.id)}
                    @keydown=${(event: KeyboardEvent) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        surface.onKbSearchHighlightKeyChange(item.id);
                      }
                    }}
                  >
                    <div class="knowledge-universe__evidence-head">
                      ${renderEvidenceSourcePill("knowledge")}
                      <div class="knowledge-universe__evidence-title">
                        ${highlightSearchTerms(item.title, highlightQuery)}
                      </div>
                    </div>
                    <p class="knowledge-universe__evidence-excerpt">
                      ${highlightSearchTerms(item.summary, highlightQuery)}
                    </p>
                  </article>
                `,
              )
        }
      </div>
    </div>
  `;
}

export function renderKnowledgeUniverseDeliverablesPage(surface: WorkbenchKnowledgeSurface) {
  return renderDeliverablesSection(surface, { forceExpanded: true });
}

export function renderKnowledgeUniverseDeliverablesTableEmbedded(
  surface: WorkbenchKnowledgeSurface,
) {
  return renderDeliverablesSection(surface, { forceExpanded: true, embedded: true });
}

/**
 * Cockpit "成果孵化中心" panel: the standard (non-embedded) deliverables table with its
 * own heading, status filter chips, and "view all" link. Used as the right-top section of
 * the productivity cockpit so the homepage no longer couples it inside the library split.
 */
export function renderKnowledgeUniverseDeliverablesPanel(
  surface: WorkbenchKnowledgeSurface,
  options?: { onViewAll?: () => void },
) {
  return renderDeliverablesSection(surface, { onViewAll: options?.onViewAll });
}

export function renderKnowledgeUniverseWorkspacePanels(
  surface: WorkbenchKnowledgeSurface,
  options?: {
    onOpenDeliverablesPage?: () => void;
    onOpenLibraryWorkspace?: () => void;
    onOpenLibraryCreate?: () => void;
    onOpenGovernance?: () => void;
    onExpandRelations?: () => void;
    onOpenMyAssets?: () => void;
  },
) {
  return html`
    <div id=${KNOWLEDGE_UNIVERSE_ANCHORS.workspace} class="knowledge-universe__workspace knowledge-universe__workspace--refined">
      ${
        surface.workspaceBusy
          ? html`
              <div class="knowledge-universe__workspace-skeleton" aria-hidden="true">
                <span></span><span></span><span></span>
              </div>
            `
          : nothing
      }

      ${
        surface.workspaceError
          ? html`<div class="knowledge-universe__error" role="alert">${surface.workspaceError}</div>`
          : nothing
      }
      ${
        surface.workspaceNotice
          ? html`<div class="knowledge-universe__notice">${surface.workspaceNotice}</div>`
          : nothing
      }
      ${
        surface.workspaceHint
          ? html`<div class="knowledge-universe__hint" role="status">${surface.workspaceHint}</div>`
          : nothing
      }

      <div class="knowledge-universe__workspace-split">
        ${renderLibraryColumn(surface, {
          onOpenLibraryWorkspace: options?.onOpenLibraryWorkspace,
          onOpenLibraryCreate: options?.onOpenLibraryCreate,
          onOpenGovernance: options?.onOpenGovernance,
          onExpandRelations: options?.onExpandRelations,
          onOpenMyAssets: options?.onOpenMyAssets,
        })}
        <div class="knowledge-universe__deliverables-column">
          ${renderDeliverablesSection(surface, { onViewAll: options?.onOpenDeliverablesPage })}
        </div>
      </div>
    </div>
  `;
}
