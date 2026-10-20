import { html, nothing, type TemplateResult } from "lit";
import { t } from "../../i18n/index.ts";
import type { KnowledgeBaseSummary } from "../capability/knowledge-universe/workspace-endpoints.ts";
import type { WorkbenchKnowledgeSurface } from "../ports/employee/views/home-page-contracts.ts";
import { KNOWLEDGE_UNIVERSE_ANCHORS } from "./knowledge-universe-anchors.ts";
import {
  kuIconBookmark,
  kuIconBuilding,
  kuIconFile,
  kuIconFolder,
  kuIconPin,
  kuIconUser,
} from "./knowledge-universe-icons.ts";
import {
  listFavoriteFunnelEntries,
  partitionKnowledgeBasesForSidebar,
  resolveTreeDocumentsForKnowledgeBase,
  resolveTreeSourcesForKnowledgeBase,
} from "./knowledge-universe-library-grouping.ts";
import { canCreateKnowledgeFolderInSection } from "./knowledge-universe-reserved-folders.ts";
import {
  renderKnowledgeTreeFolderMenu,
  renderKnowledgeTreeInlineRename,
} from "./knowledge-universe-tree-folder-actions.ts";

export type KnowledgeUniverseCockpitTreeOptions = {
  onOpenLibraryCreate?: () => void;
  /** Inline "+" under a visibility section — stays on the current page. */
  onCreateFolderInSection?: (
    visibility: KnowledgeBaseSummary["visibility"],
  ) => void | Promise<void>;
  /** Selecting a tree leaf selects the library and drives the right-side linkage. */
  onSelectLeaf?: (kbId: string) => void;
};

/** Tree leaf click: stay on the home reader. Never open the library workspace page. */
function focusLibraryDocumentFromTree(
  surface: WorkbenchKnowledgeSurface,
  kb: KnowledgeBaseSummary,
  documentId: string,
) {
  const trimmed = documentId.trim();
  if (!trimmed) {
    return;
  }
  if (surface.selectedKnowledgeBaseId !== kb.id) {
    surface.onSelectKnowledgeBase(kb.id);
  }
  surface.onHomeFocusChange({ kind: "document", id: trimmed, kbId: kb.id });
}

function renderDocumentLeaf(
  surface: WorkbenchKnowledgeSurface,
  kb: KnowledgeBaseSummary,
  doc: import("../capability/knowledge-universe/workspace-endpoints.ts").KnowledgeBaseDocumentSummaryDto,
) {
  const focused = surface.homeFocus?.kind === "document" && surface.homeFocus.id === doc.docId;
  return html`
    <button
      type="button"
      class="ku-cockpit__tree-doc ${focused ? "is-active" : ""}"
      data-testid="ku-cockpit-tree-doc"
      data-doc-id=${doc.docId}
      aria-current=${focused ? "true" : "false"}
      @click=${() => focusLibraryDocumentFromTree(surface, kb, doc.docId)}
    >
      <span class="ku-cockpit__tree-doc-icon" aria-hidden="true"
        >${kuIconFile("ku-cockpit__tree-doc-icon-svg")}</span
      >
      <span class="ku-cockpit__tree-doc-title" title=${doc.title}>${doc.title}</span>
    </button>
  `;
}

function renderSourceLeaf(
  surface: WorkbenchKnowledgeSurface,
  kb: KnowledgeBaseSummary,
  source: import("../capability/knowledge-universe/workspace-endpoints.ts").KnowledgeBaseSourceListItemDto,
) {
  // Cabin tree "doc" list has only a real navigation model for documents.
  // After sync/ingest, active sources carry `documentId` and become focusable.
  // Bound sources without a projected document stay visible but read-only.
  const title = source.title ?? source.id;
  const documentId = source.documentId?.trim();
  if (documentId) {
    const focused = surface.homeFocus?.kind === "document" && surface.homeFocus.id === documentId;
    return html`
      <button
        type="button"
        class="ku-cockpit__tree-doc ku-cockpit__tree-doc--source ${focused ? "is-focused" : ""}"
        data-testid="ku-cockpit-tree-source"
        data-source-id=${source.id}
        data-source-kind=${source.kind}
        data-source-plane=${source.plane}
        data-doc-id=${documentId}
        aria-current=${focused ? "true" : "false"}
        @click=${() => focusLibraryDocumentFromTree(surface, kb, documentId)}
      >
        <span class="ku-cockpit__tree-doc-icon" aria-hidden="true"
          >${kuIconFile("ku-cockpit__tree-doc-icon-svg")}</span
        >
        <span class="ku-cockpit__tree-doc-title" title=${title}>${title}</span>
      </button>
    `;
  }
  return html`
    <button
      type="button"
      class="ku-cockpit__tree-doc ku-cockpit__tree-doc--source"
      data-testid="ku-cockpit-tree-source"
      data-source-id=${source.id}
      data-source-kind=${source.kind}
      data-source-plane=${source.plane}
      aria-current="false"
      aria-disabled="true"
      disabled
    >
      <span class="ku-cockpit__tree-doc-icon" aria-hidden="true"
        >${kuIconFile("ku-cockpit__tree-doc-icon-svg")}</span
      >
      <span class="ku-cockpit__tree-doc-title" title=${title}>${title}</span>
    </button>
  `;
}

function renderTreeLeafDocuments(surface: WorkbenchKnowledgeSurface, kb: KnowledgeBaseSummary) {
  const documents = resolveTreeDocumentsForKnowledgeBase(surface, kb.id);
  const indexedDocIds = new Set(documents.map((doc) => doc.docId));
  // Active bindings without a projected doc, plus ingested bindings whose docId
  // is not already represented in the document list (stable srcdir:* ids).
  const sourceLeaves = resolveTreeSourcesForKnowledgeBase(surface, kb.id).filter((item) => {
    const docId = item.documentId?.trim();
    if (!docId) {
      return true;
    }
    return !indexedDocIds.has(docId);
  });
  const loading =
    Boolean(surface.treeDocumentsLoadingByKbId?.[kb.id]) ||
    (surface.selectedKnowledgeBaseId === kb.id &&
      (surface.libraryWorkspaceDocumentsLoading || surface.libraryWorkspaceSourcesLoading));
  if (loading && documents.length === 0 && sourceLeaves.length === 0) {
    return html`<p class="ku-cockpit__tree-empty">
      ${t("frontstage.workbench.knowledgeUniverse.home.knowledgeCabin.documentsLoading")}
    </p>`;
  }
  if (documents.length === 0 && sourceLeaves.length === 0) {
    return html`<p class="ku-cockpit__tree-empty">
      ${t("frontstage.workbench.knowledgeUniverse.home.knowledgeCabin.noDocuments")}
    </p>`;
  }
  const nodes = [
    ...documents.map((doc) => renderDocumentLeaf(surface, kb, doc)),
    ...sourceLeaves.map((source) => renderSourceLeaf(surface, kb, source)),
  ];
  return html`${nodes}`;
}

/**
 * Compact health tone for a knowledge space leaf. Mirrors the fuller
 * `renderKnowledgeBaseRuntimeBadges` mapping (governanceStatus, else conflict-count fallback) so
 * the dense home tree keeps the same healthy / attention / conflict signal without the badge row.
 */
function resolveKnowledgeBaseHealthTone(
  kb: KnowledgeBaseSummary,
): NonNullable<KnowledgeBaseSummary["governanceStatus"]> {
  if (kb.governanceStatus) {
    return kb.governanceStatus;
  }
  return (kb.conflictCount ?? 0) > 0 ? "conflict" : "healthy";
}

function renderTreeLeafHealthDot(kb: KnowledgeBaseSummary) {
  const tone = resolveKnowledgeBaseHealthTone(kb);
  const label = t(`frontstage.workbench.knowledgeUniverse.workspace.libraryRuntime.${tone}`);
  const conflictCount = kb.conflictCount ?? 0;
  const title =
    tone === "conflict" && conflictCount > 0
      ? t("frontstage.workbench.knowledgeUniverse.workspace.libraryRuntime.openConflicts", {
          count: conflictCount,
        })
      : label;
  return html`<span
    class="ku-cockpit__tree-health ku-cockpit__tree-health--${tone}"
    data-testid="ku-cockpit-tree-health"
    data-health=${tone}
    role="img"
    title=${title}
    aria-label=${label}
  ></span>`;
}

function renderTreeLeaf(
  surface: WorkbenchKnowledgeSurface,
  kb: KnowledgeBaseSummary,
  onSelectLeaf: (kbId: string) => void,
) {
  const active = surface.selectedKnowledgeBaseId === kb.id;
  const expanded = (surface.expandedKnowledgeBaseIds ?? []).includes(kb.id);
  const isRenaming = surface.libraryWorkspaceInlineRenameKbId === kb.id;
  const pinnedIds = surface.pinnedKnowledgeBaseIds ?? [];
  const favoriteIds = surface.favoriteKnowledgeBaseIds ?? [];
  const isPinned = pinnedIds.includes(kb.id);
  const isFavorite = favoriteIds.includes(kb.id);
  const row = isRenaming
    ? html`
        <div
          class="ku-cockpit__tree-leaf-row ku-cockpit__tree-leaf-row--rename"
          data-testid="ku-cockpit-tree-folder-rename"
        >
          ${renderKnowledgeTreeInlineRename(surface)}
        </div>
      `
    : html`
        <div class="ku-cockpit__tree-leaf-row">
          <div class="ku-cockpit__tree-leaf ${active ? "is-active" : ""}">
            <button
              type="button"
              class="ku-cockpit__tree-leaf-caret-btn"
              data-testid="ku-cockpit-tree-folder-caret"
              data-kb-id=${kb.id}
              aria-label=${t("frontstage.workbench.knowledgeUniverse.libraryWorkspace.toggleFolder")}
              aria-expanded=${expanded ? "true" : "false"}
              @click=${(event: Event) => {
                event.preventDefault();
                event.stopPropagation();
                surface.onToggleKnowledgeBaseExpanded?.(kb.id);
              }}
            >
              <span class="ku-cockpit__tree-leaf-caret" aria-hidden="true"></span>
            </button>
            <button
              type="button"
              class="ku-cockpit__tree-leaf-main"
              data-testid="ku-cockpit-tree-folder"
              data-kb-id=${kb.id}
              aria-current=${active ? "true" : "false"}
              aria-expanded=${expanded ? "true" : "false"}
              @click=${() => onSelectLeaf(kb.id)}
            >
              <span class="ku-cockpit__tree-leaf-icon" aria-hidden="true"
                >${kuIconFolder("ku-cockpit__tree-leaf-icon-svg")}</span
              >
              <span class="ku-cockpit__tree-leaf-title" title=${kb.title}>${kb.title}</span>
            </button>
            ${renderTreeLeafHealthDot(kb)}
          </div>
          <div class="ku-cockpit__tree-leaf-actions">
            ${renderKnowledgeTreeFolderMenu(surface, kb, isPinned, isFavorite)}
          </div>
        </div>
      `;
  return html`
    <div class="ku-cockpit__tree-leaf-wrap ${expanded ? "is-open" : ""}">
      ${row}
      ${
        expanded && !isRenaming
          ? html`<div class="ku-cockpit__tree-docs" role="group" data-testid="ku-cockpit-tree-docs">
              ${renderTreeLeafDocuments(surface, kb)}
            </div>`
          : nothing
      }
    </div>
  `;
}

function renderFavoriteFunnel(
  surface: WorkbenchKnowledgeSurface,
  libraries: KnowledgeBaseSummary[],
) {
  if (libraries.length === 0) {
    return html`<p class="ku-cockpit__tree-empty" data-testid="ku-cockpit-tree-favorites-empty">
      ${t("frontstage.workbench.knowledgeUniverse.libraryWorkspace.favoritesEmpty")}
    </p>`;
  }
  const entries = listFavoriteFunnelEntries(surface);
  const loading = libraries.some((kb) => Boolean(surface.treeDocumentsLoadingByKbId?.[kb.id]));
  if (loading && entries.length === 0) {
    return html`<p class="ku-cockpit__tree-empty">
      ${t("frontstage.workbench.knowledgeUniverse.home.knowledgeCabin.documentsLoading")}
    </p>`;
  }
  if (entries.length === 0) {
    return html`<p class="ku-cockpit__tree-empty" data-testid="ku-cockpit-tree-favorites-empty">
      ${t("frontstage.workbench.knowledgeUniverse.libraryWorkspace.favoritesEmptyFiles")}
    </p>`;
  }
  return html`${entries.map((entry) => renderDocumentLeaf(surface, entry.kb, entry.doc))}`;
}

function renderTreeGroup(
  surface: WorkbenchKnowledgeSurface,
  params: {
    label: string;
    icon: TemplateResult;
    libraries: KnowledgeBaseSummary[];
    onSelectLeaf: (kbId: string) => void;
    /** Always render the group node even when empty (top-level space buckets). */
    persistent?: boolean;
    open?: boolean;
    /** File funnel: list documents from the given spaces instead of folder rows. */
    funnel?: boolean;
    count?: number;
    createVisibility?: KnowledgeBaseSummary["visibility"];
    onCreateFolderInSection?: (
      visibility: KnowledgeBaseSummary["visibility"],
    ) => void | Promise<void>;
  },
) {
  if (params.libraries.length === 0 && !params.persistent) {
    return nothing;
  }
  const open = params.open ?? params.libraries.length > 0;
  const createVisibility = params.createVisibility;
  const canCreate =
    Boolean(createVisibility) &&
    typeof params.onCreateFolderInSection === "function" &&
    Boolean(
      createVisibility &&
      canCreateKnowledgeFolderInSection(surface.knowledgeBases, createVisibility),
    );
  return html`
    <details
      class="ku-cockpit__tree-group${params.persistent ? " ku-cockpit__tree-group--section" : ""}"
      ?open=${open}
    >
      <summary class="ku-cockpit__tree-group-summary">
        <span class="ku-cockpit__tree-chevron" aria-hidden="true"></span>
        <span class="ku-cockpit__tree-group-icon" aria-hidden="true">${params.icon}</span>
        <span class="ku-cockpit__tree-group-label">${params.label}</span>
        ${
          canCreate && createVisibility
            ? html`
                <button
                  type="button"
                  class="ku-cockpit__tree-add"
                  data-testid=${`ku-cockpit-tree-add-${createVisibility}`}
                  aria-label=${t(
                    "frontstage.workbench.knowledgeUniverse.libraryWorkspace.createFolderInSection",
                    { section: params.label },
                  )}
                  title=${t(
                    "frontstage.workbench.knowledgeUniverse.libraryWorkspace.createFolderInSection",
                    { section: params.label },
                  )}
                  ?disabled=${surface.workspaceBusy}
                  @click=${(event: Event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    void params.onCreateFolderInSection?.(createVisibility);
                  }}
                >
                  +
                </button>
              `
            : nothing
        }
        <span class="ku-cockpit__tree-group-count">${params.count ?? params.libraries.length}</span>
      </summary>
      <div class="ku-cockpit__tree-children" role="group">
        ${
          params.funnel
            ? renderFavoriteFunnel(surface, params.libraries)
            : params.libraries.length > 0
              ? params.libraries.map((kb) => renderTreeLeaf(surface, kb, params.onSelectLeaf))
              : html`<p class="ku-cockpit__tree-empty">
                  ${t("frontstage.workbench.knowledgeUniverse.workspace.emptyLibraries")}
                </p>`
        }
      </div>
    </details>
  `;
}

function renderTree(
  surface: WorkbenchKnowledgeSurface,
  onSelectLeaf: (kbId: string) => void,
  onCreateFolderInSection?: (
    visibility: KnowledgeBaseSummary["visibility"],
  ) => void | Promise<void>,
) {
  const grouped = partitionKnowledgeBasesForSidebar(surface);
  return html`
    <div class="ku-cockpit__tree" role="tree" aria-label=${t(
      "frontstage.workbench.knowledgeUniverse.workspace.librariesHeading",
    )}>
      ${renderTreeGroup(surface, {
        label: t("frontstage.workbench.knowledgeUniverse.libraryWorkspace.pinnedHeading"),
        icon: kuIconPin("ku-cockpit__tree-group-icon-svg"),
        libraries: grouped.pinned,
        onSelectLeaf,
      })}
      ${renderTreeGroup(surface, {
        label: t("frontstage.workbench.knowledgeUniverse.libraryWorkspace.favoritesHeading"),
        icon: kuIconBookmark("ku-cockpit__tree-group-icon-svg"),
        libraries: grouped.favorites,
        onSelectLeaf,
        persistent: true,
        funnel: true,
        open: grouped.favorites.length > 0,
        count: listFavoriteFunnelEntries(surface).length,
      })}
      ${renderTreeGroup(surface, {
        label: t("frontstage.workbench.knowledgeUniverse.libraryWorkspace.treeSectionPersonal"),
        icon: kuIconUser("ku-cockpit__tree-group-icon-svg"),
        libraries: grouped.privateSpaces,
        onSelectLeaf,
        persistent: true,
        createVisibility: "private",
        onCreateFolderInSection,
        open: true,
      })}
      ${renderTreeGroup(surface, {
        label: t("frontstage.workbench.knowledgeUniverse.libraryWorkspace.treeSectionTeam"),
        icon: kuIconFolder("ku-cockpit__tree-group-icon-svg"),
        libraries: grouped.teamSpaces,
        onSelectLeaf,
        persistent: true,
        createVisibility: "team",
        onCreateFolderInSection,
        open: true,
      })}
      ${renderTreeGroup(surface, {
        label: t("frontstage.workbench.knowledgeUniverse.libraryWorkspace.treeSectionEnterprise"),
        icon: kuIconBuilding("ku-cockpit__tree-group-icon-svg"),
        libraries: grouped.enterpriseSpaces,
        onSelectLeaf,
        persistent: true,
        createVisibility: "enterprise",
        onCreateFolderInSection,
        open: true,
      })}
    </div>
  `;
}

/**
 * Left rail of the productivity cockpit: a clean, collapsible directory tree of knowledge
 * spaces grouped by 置顶 / 收藏 / 个人 / 团队 / 企业. Selecting a leaf selects the library and
 * drives the right-side linkage (relations graph + governance). Keeps the `#ku-workspace`
 * anchor and `.knowledge-universe__library-column` / `.ku-cockpit__tree-leaf` hooks for
 * anchor-nav + archive-target lookup. Nodes are plain text rows (no card frame / badges).
 */
export function renderKnowledgeUniverseCockpitTree(
  surface: WorkbenchKnowledgeSurface,
  options?: KnowledgeUniverseCockpitTreeOptions,
) {
  const hasSelection = Boolean(surface.selectedKnowledgeBaseId);
  const onSelectLeaf = (kbId: string) => {
    if (options?.onSelectLeaf) {
      options.onSelectLeaf(kbId);
      return;
    }
    surface.onSelectKnowledgeBase(kbId);
  };

  return html`
    <aside
      id=${KNOWLEDGE_UNIVERSE_ANCHORS.workspace}
      class="knowledge-universe__stage-card knowledge-universe__library-column ku-cockpit__rail ${
        hasSelection ? "is-selected" : ""
      }"
      aria-label=${t("frontstage.workbench.knowledgeUniverse.workspace.librariesHeading")}
    >
      <div class="knowledge-universe__stage-card-head knowledge-universe__stage-card-head--library ku-cockpit__rail-head">
        <div class="ku-cockpit__rail-head-row">
          <span class="knowledge-universe__panel-title">
            ${t("frontstage.workbench.knowledgeUniverse.home.knowledgeCabin.title")}
          </span>
        </div>
      </div>
      <div class="knowledge-universe__stage-card-body ku-cockpit__rail-body">
        ${renderTree(surface, onSelectLeaf, options?.onCreateFolderInSection)}
      </div>
    </aside>
  `;
}
