import { html, nothing } from "lit";
import { t } from "../../i18n/index.ts";
import { localizeLocalFolderBindingError } from "../controllers/knowledge-universe-local-folder.ts";
import type { WorkbenchKnowledgeSurface } from "../ports/employee/views/home-page-contracts.ts";

function formatScanTime(ms?: number): string {
  if (!ms) {
    return "—";
  }
  try {
    return new Date(ms).toLocaleString();
  } catch {
    return "—";
  }
}

export function renderLocalFolderImportForm(surface: WorkbenchKnowledgeSurface) {
  const path = surface.libraryWorkspaceLocalFolderPath ?? "";
  const label = surface.libraryWorkspaceLocalFolderLabel ?? "";
  const deletePolicy = surface.libraryWorkspaceLocalFolderDeletePolicy ?? "snapshot";
  const statusItems = surface.libraryWorkspaceLocalFolderStatusItems ?? [];
  const canConnect = !surface.personalActionBusy && Boolean(path.trim());

  return html`
    <div class="ku-space-import__form ku-space-import__local-folder" data-testid="ku-space-import-form-localFolder">
      ${
        statusItems.length > 0
          ? html`
              <div
                class="ku-space-import__local-folder-status"
                data-testid="ku-space-import-local-folder-status-list"
              >
                <p class="ku-space-import__field-label">
                  ${t(
                    "frontstage.workbench.knowledgeUniverse.importToSpace.localFolder.connectedTitle",
                  )}
                </p>
                <ul class="ku-space-import__local-folder-status-list">
                  ${statusItems.map((item) => {
                    const bindingError = localizeLocalFolderBindingError(item.lastError);
                    return html`
                      <li
                        class="ku-space-import__local-folder-status-item"
                        data-testid="ku-space-import-local-folder-status-item"
                        data-binding-id=${item.bindingId}
                      >
                        <div class="ku-space-import__local-folder-status-copy">
                          <strong>${item.rootLabel}</strong>
                          <span class="ku-space-import__hint">
                            ${t(
                              "frontstage.workbench.knowledgeUniverse.importToSpace.localFolder.statusLine",
                              {
                                status: item.status,
                                files: String(item.activeDocumentCount ?? 0),
                                watch: item.watcherRunning
                                  ? t(
                                      "frontstage.workbench.knowledgeUniverse.importToSpace.localFolder.watchOn",
                                    )
                                  : t(
                                      "frontstage.workbench.knowledgeUniverse.importToSpace.localFolder.watchOff",
                                    ),
                                lastScan: formatScanTime(item.lastScanAt),
                              },
                            )}
                          </span>
                          ${
                            bindingError
                              ? html`<span class="ku-space-import__error">${bindingError}</span>`
                              : nothing
                          }
                        </div>
                      </li>
                    `;
                  })}
                </ul>
              </div>
            `
          : nothing
      }

      <label class="ku-space-import__field">
        <span class="ku-space-import__field-label">${t("frontstage.workbench.knowledgeUniverse.importToSpace.localFolder.pathLabel")}</span>
        <div class="ku-space-import__field-control">
          <div class="ku-space-import__field-row">
            <input
              type="text"
              class="ku-space-import__input"
              data-testid="ku-space-import-local-folder-path"
              .value=${path}
              readonly
              ?disabled=${surface.personalActionBusy}
              placeholder=${t(
                "frontstage.workbench.knowledgeUniverse.importToSpace.localFolder.pathPlaceholder",
              )}
            />
            <button
              type="button"
              class="btn btn--sm ku-space-import__input-affix"
              data-testid="ku-space-import-local-folder-pick"
              ?disabled=${surface.personalActionBusy}
              @click=${() => void surface.onPickLocalFolderPath?.()}
            >
              ${t("frontstage.workbench.knowledgeUniverse.importToSpace.localFolder.pickAction")}
            </button>
          </div>
          <p class="ku-space-import__hint" data-testid="ku-space-import-local-folder-path-hint">
            ${t("frontstage.workbench.knowledgeUniverse.importToSpace.localFolder.pathHint")}
          </p>
        </div>
      </label>

      <label class="ku-space-import__field">
        <span class="ku-space-import__field-label">${t("frontstage.workbench.knowledgeUniverse.importToSpace.localFolder.labelLabel")}</span>
        <div class="ku-space-import__field-control">
          <input
            type="text"
            class="ku-space-import__input"
            data-testid="ku-space-import-local-folder-label"
            .value=${label}
            ?disabled=${surface.personalActionBusy}
            placeholder=${t(
              "frontstage.workbench.knowledgeUniverse.importToSpace.localFolder.labelPlaceholder",
            )}
            @input=${(event: Event) => {
              surface.onLibraryWorkspaceLocalFolderLabelChange?.(
                (event.target as HTMLInputElement).value,
              );
            }}
          />
        </div>
      </label>

      <details class="ku-space-import__fold" data-testid="ku-space-import-local-folder-advanced">
        <summary>
          ${t("frontstage.workbench.knowledgeUniverse.importToSpace.localFolder.advancedTitle")}
        </summary>
        <div class="ku-space-import__field" data-testid="ku-space-import-local-folder-delete-policy">
          <span class="ku-space-import__field-label">
            ${t("frontstage.workbench.knowledgeUniverse.importToSpace.localFolder.deletePolicyLabel")}
          </span>
          <div class="ku-space-import__field-control">
            <div class="ku-space-import__file-radio-group" role="radiogroup">
              <label class="ku-space-import__file-radio">
                <input
                  type="radio"
                  name="ku-local-folder-delete-policy"
                  .checked=${deletePolicy === "snapshot"}
                  ?disabled=${surface.personalActionBusy}
                  @change=${() => surface.onLibraryWorkspaceLocalFolderDeletePolicyChange?.("snapshot")}
                />
                <span
                  >${t(
                    "frontstage.workbench.knowledgeUniverse.importToSpace.localFolder.deletePolicy.snapshot",
                  )}</span
                >
              </label>
              <label class="ku-space-import__file-radio">
                <input
                  type="radio"
                  name="ku-local-folder-delete-policy"
                  .checked=${deletePolicy === "sync"}
                  ?disabled=${surface.personalActionBusy}
                  @change=${() => surface.onLibraryWorkspaceLocalFolderDeletePolicyChange?.("sync")}
                />
                <span
                  >${t(
                    "frontstage.workbench.knowledgeUniverse.importToSpace.localFolder.deletePolicy.sync",
                  )}</span
                >
              </label>
            </div>
          </div>
        </div>
      </details>

      <div class="ku-space-import__actions">
        <button
          type="button"
          class="btn btn--primary"
          data-testid="ku-space-import-local-folder-connect"
          ?disabled=${!canConnect}
          @click=${() => void surface.onBindLocalFolder?.()}
        >
          ${
            surface.personalActionBusy
              ? surface.importProgress?.label ||
                t("frontstage.workbench.knowledgeUniverse.importToSpace.localFolder.connectBusy")
              : t("frontstage.workbench.knowledgeUniverse.importToSpace.localFolder.connectAction")
          }
        </button>
      </div>
    </div>
  `;
}
