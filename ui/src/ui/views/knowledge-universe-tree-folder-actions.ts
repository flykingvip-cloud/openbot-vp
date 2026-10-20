import { html, nothing } from "lit";
import { t } from "../../i18n/index.ts";
import type { KnowledgeBaseSummary } from "../capability/knowledge-universe/workspace-endpoints.ts";
import type { WorkbenchKnowledgeSurface } from "../ports/employee/views/home-page-contracts.ts";
import { kuIconMore } from "./knowledge-universe-icons.ts";
import { canManageKnowledgeTreeFolder } from "./knowledge-universe-reserved-folders.ts";

/**
 * Select a folder on the home cockpit. File reading stays on the home preview —
 * do not open the library workspace page.
 */
export function openLibraryCatalogEntry(
  surface: WorkbenchKnowledgeSurface,
  knowledgeBaseId: string,
) {
  if (knowledgeBaseId !== surface.selectedKnowledgeBaseId) {
    surface.onSelectKnowledgeBase(knowledgeBaseId);
  }
  if (surface.libraryWorkspaceImportOpen) {
    surface.onLibraryWorkspaceImportOpenChange(false);
  }
}

/** Shared close helper for the folder ⋯ <details> menu. */
export function closeKnowledgeTreeFolderMenu(menu: HTMLElement | null) {
  if (menu instanceof HTMLDetailsElement) {
    menu.open = false;
  }
}

export function requestDeleteKnowledgeTreeFolder(
  surface: WorkbenchKnowledgeSurface,
  kb: KnowledgeBaseSummary,
) {
  const confirmed = window.confirm(
    t("frontstage.workbench.knowledgeUniverse.libraryWorkspace.deleteConfirmPrompt", {
      title: kb.title,
    }),
  );
  if (!confirmed) {
    return;
  }
  void surface.onDeleteLibraryWorkspace(kb.id);
}

/** Inline rename strip shared by home cabin tree and library workspace tree. */
export function renderKnowledgeTreeInlineRename(surface: WorkbenchKnowledgeSurface) {
  return html`
    <div class="ku-library-ws__tree-rename" data-testid="ku-library-inline-rename">
      <input
        type="text"
        class="ku-library-ws__tree-rename-input"
        data-testid="ku-library-rename-input"
        .value=${surface.libraryWorkspaceSettingsTitle}
        placeholder=${t(
          "frontstage.workbench.knowledgeUniverse.libraryWorkspace.settingsNamePlaceholder",
        )}
        @input=${(event: Event) =>
          surface.onLibraryWorkspaceSettingsTitleChange((event.target as HTMLInputElement).value)}
        @keydown=${(event: KeyboardEvent) => {
          if (event.key === "Enter") {
            event.preventDefault();
            void surface.onSubmitLibraryWorkspaceRename();
          }
          if (event.key === "Escape") {
            event.preventDefault();
            surface.onCancelLibraryWorkspaceInlineRename();
          }
        }}
      />
      <div class="ku-library-ws__tree-rename-actions">
        <button
          type="button"
          class="btn btn--sm btn--primary"
          data-testid="ku-library-rename-save"
          ?disabled=${surface.workspaceBusy}
          @click=${() => void surface.onSubmitLibraryWorkspaceRename()}
        >
          ${t("frontstage.workbench.knowledgeUniverse.libraryWorkspace.renameSaveAction")}
        </button>
        <button
          type="button"
          class="btn btn--sm"
          data-testid="ku-library-rename-cancel"
          ?disabled=${surface.workspaceBusy}
          @click=${() => surface.onCancelLibraryWorkspaceInlineRename()}
        >
          ${t("frontstage.workbench.knowledgeUniverse.libraryWorkspace.renameCancelAction")}
        </button>
      </div>
    </div>
  `;
}

/** ⋯ menu: pin / favorite / rename / delete — same actions on home cabin and library workspace. */
export function renderKnowledgeTreeFolderMenu(
  surface: WorkbenchKnowledgeSurface,
  kb: KnowledgeBaseSummary,
  isPinned: boolean,
  isFavorite: boolean,
) {
  return html`
    <details class="ku-library-ws__tree-menu" data-testid="ku-library-tree-menu">
      <summary
        class="ku-library-ws__tree-menu-trigger"
        aria-label=${t("frontstage.workbench.knowledgeUniverse.libraryWorkspace.menuAction")}
        title=${t("frontstage.workbench.knowledgeUniverse.libraryWorkspace.menuAction")}
        @click=${(event: Event) => event.stopPropagation()}
      >
        ${kuIconMore("ku-library-ws__tree-menu-icon")}
      </summary>
      <div
        class="ku-library-ws__tree-menu-panel"
        role="menu"
        @click=${(event: Event) => event.stopPropagation()}
      >
        <button
          type="button"
          role="menuitem"
          class="ku-library-ws__tree-menu-item ${isPinned ? "is-on" : ""}"
          data-testid="ku-library-menu-pin"
          @click=${(event: Event) => {
            closeKnowledgeTreeFolderMenu((event.currentTarget as HTMLElement).closest("details"));
            surface.onToggleKnowledgeBasePin(kb.id);
          }}
        >
          ${t("frontstage.workbench.knowledgeUniverse.libraryWorkspace.pinAction")}
        </button>
        <button
          type="button"
          role="menuitem"
          class="ku-library-ws__tree-menu-item ${isFavorite ? "is-on" : ""}"
          data-testid="ku-library-menu-favorite"
          @click=${(event: Event) => {
            closeKnowledgeTreeFolderMenu((event.currentTarget as HTMLElement).closest("details"));
            surface.onToggleKnowledgeBaseFavorite(kb.id);
          }}
        >
          ${t("frontstage.workbench.knowledgeUniverse.libraryWorkspace.favoriteAction")}
        </button>
        ${
          !canManageKnowledgeTreeFolder(kb)
            ? nothing
            : html`
                <button
                  type="button"
                  role="menuitem"
                  class="ku-library-ws__tree-menu-item"
                  data-testid="ku-library-menu-rename"
                  @click=${(event: Event) => {
                    closeKnowledgeTreeFolderMenu(
                      (event.currentTarget as HTMLElement).closest("details"),
                    );
                    surface.onStartLibraryWorkspaceInlineRename(kb.id);
                  }}
                >
                  ${t("frontstage.workbench.knowledgeUniverse.libraryWorkspace.renameAction")}
                </button>
                <button
                  type="button"
                  role="menuitem"
                  class="ku-library-ws__tree-menu-item ku-library-ws__tree-menu-item--danger"
                  data-testid="ku-library-menu-delete"
                  @click=${(event: Event) => {
                    closeKnowledgeTreeFolderMenu(
                      (event.currentTarget as HTMLElement).closest("details"),
                    );
                    requestDeleteKnowledgeTreeFolder(surface, kb);
                  }}
                >
                  ${t("frontstage.workbench.knowledgeUniverse.libraryWorkspace.deleteAction")}
                </button>
              `
        }
      </div>
    </details>
  `;
}
