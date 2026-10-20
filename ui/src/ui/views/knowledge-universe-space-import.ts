import { html, nothing } from "lit";
import { t } from "../../i18n/index.ts";
import type { KnowledgeSourceBindRequest } from "../capability/knowledge-universe/endpoints.ts";
import type { KnowledgeBaseSummary } from "../capability/knowledge-universe/workspace-endpoints.ts";
import type { WorkbenchKnowledgeSurface } from "../ports/employee/views/home-page-contracts.ts";
import { openKnowledgeSpaceCreatePage } from "./knowledge-universe-create-entry.ts";
import {
  filterKnowledgeBasesByVisibility,
  type KnowledgeBaseVisibilityGroup,
} from "./knowledge-universe-library-grouping.ts";
import { knowledgeBaseAllowsWrite } from "./knowledge-universe-reserved-folders.ts";

export type {
  ActiveSourceBindKind,
  SpaceImportKind,
} from "../ports/employee/views/home-page-contracts.ts";
import type {
  ActiveSourceBindKind,
  SpaceImportKind,
} from "../ports/employee/views/home-page-contracts.ts";
import { renderActiveSourceBindPanel } from "./knowledge-universe-space-connector-bind.ts";
import { renderLocalFolderImportForm } from "./knowledge-universe-space-import-local-folder.ts";
import {
  renderNoteImportForm,
  noteImportFormPropsFromSurface,
} from "./knowledge-universe-space-import-note.ts";
import {
  renderSpaceImportAlert,
  renderSpaceImportProgress,
} from "./knowledge-universe-space-import-ui.ts";
import { renderWebUrlImportForm } from "./knowledge-universe-space-import-url.ts";

/**
 * Source-channel tabs on the space-import page (final IA, 2026-07-23):
 * 本地文件夹 / 网页 / 笔记 / 主动源.
 * Vault is NOT a tab and is NOT reachable from 本地文件夹 (entry TBD).
 * 本地文件夹 is fixed to managed_push — no sync-method selector.
 */
const SPACE_IMPORT_TAB_KINDS: SpaceImportKind[] = ["localFolder", "url", "note", "active"];

export function resolveSelectedKb(surface: WorkbenchKnowledgeSurface): KnowledgeBaseSummary | null {
  return surface.knowledgeBases.find((item) => item.id === surface.selectedKnowledgeBaseId) ?? null;
}

export function resolveSelectedKnowledgeSpaceCanWrite(
  surface: Pick<
    WorkbenchKnowledgeSurface,
    | "selectedKnowledgeBaseId"
    | "knowledgeBases"
    | "libraryWorkspaceMembers"
    | "libraryWorkspaceMembersLoading"
  >,
  actorEmail?: string | null,
): boolean {
  if (!surface.selectedKnowledgeBaseId) {
    return false;
  }
  const kb = surface.knowledgeBases.find((item) => item.id === surface.selectedKnowledgeBaseId);
  if (!kb) {
    return false;
  }
  if (kb.canWrite === true) {
    return true;
  }
  if (kb.canWrite === false) {
    return false;
  }
  // Enterprise spaces stay read-only until gateway marks the actor as a writer.
  if (kb.visibility === "enterprise") {
    return false;
  }
  if (kb.visibility === "private") {
    return true;
  }
  if (surface.libraryWorkspaceMembersLoading) {
    return true;
  }
  const normalizedEmail = actorEmail?.trim().toLowerCase();
  if (!normalizedEmail || surface.libraryWorkspaceMembers.length === 0) {
    return true;
  }
  const selfMember = surface.libraryWorkspaceMembers.find(
    (member) => member.status === "active" && member.email.trim().toLowerCase() === normalizedEmail,
  );
  if (!selfMember) {
    return true;
  }
  return selfMember.role !== "viewer";
}

export function buildActiveSourceBindRequest(params: {
  knowledgeBaseId: string;
  kind: ActiveSourceBindKind;
  title: string;
  endpoint: string;
}): KnowledgeSourceBindRequest {
  const endpoint = params.endpoint.trim();
  const title = params.title.trim() || endpoint;
  return {
    kind: params.kind,
    title,
    endpoint,
    knowledgeBaseId: params.knowledgeBaseId,
  };
}

export type SpaceImportEntryOptions = {
  /** Space-detail entry locks target; home entry shows selector (U9). */
  lockSpace?: boolean;
  /**
   * Select this space before opening (e.g. tree folder click). Required when the
   * render-model surface is a snapshot — selection must not rely on stale selected id.
   */
  knowledgeBaseId?: string;
};

export function openSpaceImportEntry(
  surface: WorkbenchKnowledgeSurface,
  options?: SpaceImportEntryOptions,
) {
  const lockSpace = options?.lockSpace ?? true;
  const kbId = options?.knowledgeBaseId ?? surface.selectedKnowledgeBaseId;

  if (surface.knowledgeBases.length === 0) {
    openKnowledgeSpaceCreatePage(surface);
    return;
  }
  if (!kbId) {
    openKnowledgeSpaceCreatePage(surface);
    return;
  }
  if (options?.knowledgeBaseId && options.knowledgeBaseId !== surface.selectedKnowledgeBaseId) {
    surface.onSelectKnowledgeBase(options.knowledgeBaseId);
  }
  const writeSurface = {
    ...surface,
    selectedKnowledgeBaseId: kbId,
  };
  if (!resolveSelectedKnowledgeSpaceCanWrite(writeSurface, surface.actorEmail)) {
    surface.onLibraryWorkspaceImportReadOnly?.();
    return;
  }
  if (surface.pageTab !== "spaceImport") {
    surface.onPageTabChange("spaceImport");
  }
  surface.onLibraryWorkspaceImportOpenChange(true, { lockSpace });
}

/**
 * Home "录入知识" entry: open the four-channel import page under a private space.
 * Never silently materialize 「我的收录」— without a private target, route to create space.
 */
export function openPersonalSpaceImportEntry(surface: WorkbenchKnowledgeSurface) {
  const privateKbs = filterKnowledgeBasesByVisibility(surface.knowledgeBases, "private");
  const personalTarget =
    privateKbs.find((kb) => kb.id === surface.selectedKnowledgeBaseId) ?? privateKbs[0];
  if (personalTarget) {
    openSpaceImportEntry(surface, { lockSpace: true, knowledgeBaseId: personalTarget.id });
    return;
  }
  openKnowledgeSpaceCreatePage(surface);
}

function importKindLabel(kind: SpaceImportKind): string {
  return t(`frontstage.workbench.knowledgeUniverse.importToSpace.kind.${kind}`);
}

function visibilityGroupLabel(visibility: KnowledgeBaseVisibilityGroup): string {
  if (visibility === "private") {
    return t("frontstage.workbench.knowledgeUniverse.libraryWorkspace.treeSectionPersonal");
  }
  if (visibility === "team") {
    return t("frontstage.workbench.knowledgeUniverse.libraryWorkspace.treeSectionTeam");
  }
  return t("frontstage.workbench.knowledgeUniverse.libraryWorkspace.treeSectionEnterprise");
}

function renderImportTargetLocked(spaceTitle: string) {
  return html`
    <div class="ku-space-import__toolbar ku-space-import__toolbar--locked" data-testid="ku-space-import-target-locked">
      <span class="ku-space-import__field-label">${t("frontstage.workbench.knowledgeUniverse.importToSpace.targetSelectorLabel")}</span>
      <span class="ku-space-import__target-chip">${spaceTitle}</span>
    </div>
  `;
}

function renderImportTargetSelector(surface: WorkbenchKnowledgeSurface) {
  const groups: KnowledgeBaseVisibilityGroup[] = ["private", "team", "enterprise"];
  const selectedId = surface.selectedKnowledgeBaseId ?? "";
  return html`
    <div class="ku-space-import__toolbar" data-testid="ku-space-import-target-selector">
      <label class="ku-space-import__field ku-space-import__target-field">
        <span class="ku-space-import__field-label">${t("frontstage.workbench.knowledgeUniverse.importToSpace.targetSelectorLabel")}</span>
        <div class="ku-space-import__field-control ku-space-import__target-control">
          <select
            class="ku-space-import__target-select ku-space-import__input"
            data-testid="ku-space-import-target-select"
            .value=${selectedId}
            @change=${(event: Event) => {
              const kbId = (event.target as HTMLSelectElement).value.trim();
              if (kbId) {
                surface.onSelectKnowledgeBase(kbId);
              }
            }}
          >
            ${groups.flatMap((visibility) => {
              const items = filterKnowledgeBasesByVisibility(
                surface.knowledgeBases,
                visibility,
              ).filter(knowledgeBaseAllowsWrite);
              if (items.length === 0) {
                return [];
              }
              return html`
                <optgroup label=${visibilityGroupLabel(visibility)}>
                  ${items.map(
                    (kb) => html`
                      <option value=${kb.id} ?selected=${kb.id === selectedId}>${kb.title}</option>
                    `,
                  )}
                </optgroup>
              `;
            })}
          </select>
          <button
            type="button"
            class="btn btn--sm ku-space-import__create-space"
            data-testid="ku-space-import-create-space"
            @click=${() => {
              surface.onLibraryWorkspaceImportOpenChange(false);
              openKnowledgeSpaceCreatePage(surface);
            }}
          >
            ${t("frontstage.workbench.knowledgeUniverse.importToSpace.createSpace")}
          </button>
        </div>
      </label>
    </div>
  `;
}

function renderImportTarget(surface: WorkbenchKnowledgeSurface, spaceTitle: string) {
  if (surface.libraryWorkspaceImportLockSpace) {
    return renderImportTargetLocked(spaceTitle);
  }
  return renderImportTargetSelector(surface);
}

function renderImportChannelTabs(surface: WorkbenchKnowledgeSurface, activeTab: SpaceImportKind) {
  return html`
    <div
      class="ku-space-import__tabs ku-space-import__tabs--seg"
      role="tablist"
      aria-label=${t("frontstage.workbench.knowledgeUniverse.importToSpace.drawerTitle")}
    >
      ${SPACE_IMPORT_TAB_KINDS.map((kind) => {
        const active = kind === activeTab;
        return html`
          <button
            type="button"
            role="tab"
            aria-selected=${active ? "true" : "false"}
            class="ku-space-import__tab ${active ? "is-active" : ""}"
            data-testid="ku-space-import-tab-${kind}"
            @click=${() => {
              if (kind === activeTab) {
                return;
              }
              surface.onLibraryWorkspaceImportKindChange(kind);
            }}
          >
            ${importKindLabel(kind)}
          </button>
        `;
      })}
    </div>
  `;
}

function renderNoteForm(surface: WorkbenchKnowledgeSurface) {
  return renderNoteImportForm(noteImportFormPropsFromSurface(surface));
}

function renderUrlForm(surface: WorkbenchKnowledgeSurface) {
  return renderWebUrlImportForm(surface);
}

/**
 * 本地文件夹 panel: managed_push only. No sync-method selector; Vault is not surfaced here.
 */
function renderLocalFolderForm(surface: WorkbenchKnowledgeSurface) {
  return renderLocalFolderImportForm(surface);
}

function renderImportForm(surface: WorkbenchKnowledgeSurface, kind: SpaceImportKind) {
  switch (kind) {
    case "note":
      return renderNoteForm(surface);
    case "url":
      return renderUrlForm(surface);
    case "localFolder":
      return renderLocalFolderForm(surface);
    case "active":
      return renderActiveSourceBindPanel(surface);
    default:
      return nothing;
  }
}

/** Page title for the space-import secondary page. Stable — the active channel is shown via tabs. */
export function resolveSpaceImportPageTitle(): string {
  return t("frontstage.workbench.knowledgeUniverse.importToSpace.drawerTitle");
}

/**
 * Space-import secondary page: four tabs (本地文件夹 / 网页 / 笔记 / 主动源).
 * 本地文件夹 is managed_push only — no sync-method selector, no Vault form.
 */
export function renderKnowledgeUniverseSpaceImportPage(surface: WorkbenchKnowledgeSurface) {
  const kb = resolveSelectedKb(surface);
  // When locked without a concrete space (personal 录入知识 before any space exists), read as 个人空间
  // rather than the "select a space" placeholder.
  const spaceTitle =
    kb?.title ??
    (surface.libraryWorkspaceImportLockSpace
      ? t("frontstage.workbench.knowledgeUniverse.libraryWorkspace.treeSectionPersonal")
      : t("frontstage.workbench.knowledgeUniverse.libraryWorkspace.defaultTitle"));
  const activeTab = surface.libraryWorkspaceImportKind ?? SPACE_IMPORT_TAB_KINDS[0];

  return html`
    <div class="ku-space-import__page" data-testid="ku-space-import-page">
      ${renderImportTarget(surface, spaceTitle)}
      ${renderImportChannelTabs(surface, activeTab)}
      ${renderSpaceImportProgress(surface.importProgress ?? null)}
      ${renderSpaceImportAlert("notice", surface.personalActionNotice ?? "", "ku-space-import-notice")}
      ${renderSpaceImportAlert("error", surface.personalActionError ?? "", "ku-space-import-error")}
      <div
        class="ku-space-import__panel ku-space-import__panel-card"
        role="tabpanel"
        data-testid="ku-space-import-panel"
      >
        ${renderImportForm(surface, activeTab)}
      </div>
    </div>
  `;
}
