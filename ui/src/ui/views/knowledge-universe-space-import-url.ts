import { html, nothing } from "lit";
import { t } from "../../i18n/index.ts";
import type { WorkbenchKnowledgeSurface } from "../ports/employee/views/home-page-contracts.ts";
import {
  countWebImportUrlLines,
  WEB_URL_IMPORT_MAX_LINKS,
  type WebUrlImportMode,
  type WebUrlSyncSchedule,
} from "./knowledge-universe-url-import.ts";

function renderImportModeOption(params: {
  mode: WebUrlImportMode;
  active: WebUrlImportMode;
  disabled: boolean;
  onSelect: (mode: WebUrlImportMode) => void;
}) {
  const id = `ku-url-import-mode-${params.mode}`;
  const isActive = params.active === params.mode;
  return html`
    <button
      id=${id}
      type="button"
      role="radio"
      aria-checked=${isActive ? "true" : "false"}
      class="ku-space-import__seg ${isActive ? "is-active" : ""}"
      ?disabled=${params.disabled}
      @click=${() => params.onSelect(params.mode)}
    >
      ${t(`frontstage.workbench.knowledgeUniverse.importToSpace.url.mode.${params.mode}`)}
    </button>
  `;
}

function renderSyncScheduleOption(params: {
  schedule: WebUrlSyncSchedule;
  active: WebUrlSyncSchedule;
  disabled: boolean;
  onSelect: (schedule: WebUrlSyncSchedule) => void;
}) {
  const id = `ku-url-sync-${params.schedule}`;
  const isActive = params.active === params.schedule;
  return html`
    <button
      id=${id}
      type="button"
      role="radio"
      aria-checked=${isActive ? "true" : "false"}
      class="ku-space-import__seg ${isActive ? "is-active" : ""}"
      ?disabled=${params.disabled}
      @click=${() => params.onSelect(params.schedule)}
    >
      ${t(`frontstage.workbench.knowledgeUniverse.importToSpace.url.sync.${params.schedule}`)}
    </button>
  `;
}

function canStartWebImport(surface: WorkbenchKnowledgeSurface): boolean {
  if (surface.personalActionBusy) {
    return false;
  }
  if (surface.libraryWorkspaceUrlImportMode !== "batch") {
    return false;
  }
  return countWebImportUrlLines(surface.libraryWorkspaceUrlImportText ?? "") > 0;
}

export function renderWebUrlImportForm(surface: WorkbenchKnowledgeSurface) {
  const mode = surface.libraryWorkspaceUrlImportMode ?? "batch";
  const linkCount = countWebImportUrlLines(surface.libraryWorkspaceUrlImportText ?? "");
  const batchMode = mode === "batch";

  return html`
    <div class="ku-space-import__form ku-space-import__form--url" data-testid="ku-space-import-form-url">
      <div class="ku-space-import__section">
        <h3 class="ku-space-import__section-title">${t("frontstage.workbench.knowledgeUniverse.importToSpace.url.modeLabel")}</h3>
        <div class="ku-space-import__seg-group" role="radiogroup" data-testid="ku-space-import-url-mode">
          ${renderImportModeOption({
            mode: "batch",
            active: mode,
            disabled: surface.personalActionBusy,
            onSelect: (value) => surface.onLibraryWorkspaceUrlImportModeChange?.(value),
          })}
          ${renderImportModeOption({
            mode: "sitemap",
            active: mode,
            disabled: surface.personalActionBusy,
            onSelect: (value) => surface.onLibraryWorkspaceUrlImportModeChange?.(value),
          })}
          ${renderImportModeOption({
            mode: "crawl",
            active: mode,
            disabled: surface.personalActionBusy,
            onSelect: (value) => surface.onLibraryWorkspaceUrlImportModeChange?.(value),
          })}
        </div>
        ${
          !batchMode
            ? html`<p class="ku-space-import__alert ku-space-import__alert--hint" data-testid="ku-space-import-url-mode-hint">
                ${t("frontstage.workbench.knowledgeUniverse.importToSpace.url.modeComingSoon")}
              </p>`
            : nothing
        }
      </div>

      <label class="knowledge-universe__field ku-space-import__field">
        <span>
          ${
            batchMode
              ? t("frontstage.workbench.knowledgeUniverse.importToSpace.url.linksLabel")
              : mode === "sitemap"
                ? t("frontstage.workbench.knowledgeUniverse.importToSpace.url.sitemapLabel")
                : t("frontstage.workbench.knowledgeUniverse.importToSpace.url.crawlLabel")
          }
        </span>
        ${
          batchMode
            ? html`
                <div class="ku-space-import__url-textarea-wrap">
                  <textarea
                    rows="6"
                    data-testid="ku-space-import-url-textarea"
                    .value=${surface.libraryWorkspaceUrlImportText ?? ""}
                    placeholder=${t(
                      "frontstage.workbench.knowledgeUniverse.importToSpace.url.linksPlaceholder",
                    )}
                    ?disabled=${surface.personalActionBusy}
                    @input=${(event: Event) =>
                      surface.onLibraryWorkspaceUrlImportTextChange?.(
                        (event.target as HTMLTextAreaElement).value,
                      )}
                  ></textarea>
                  <span class="ku-space-import__url-counter" data-testid="ku-space-import-url-counter">
                    ${t("frontstage.workbench.knowledgeUniverse.importToSpace.url.linkCounter", {
                      count: Math.min(linkCount, WEB_URL_IMPORT_MAX_LINKS),
                      max: WEB_URL_IMPORT_MAX_LINKS,
                    })}
                  </span>
                </div>
              `
            : html`
                <input
                  type="url"
                  inputmode="url"
                  data-testid="ku-space-import-url-seed"
                  .value=${surface.libraryWorkspaceUrlImportText ?? ""}
                  placeholder=${t(
                    mode === "sitemap"
                      ? "frontstage.workbench.knowledgeUniverse.importToSpace.url.sitemapPlaceholder"
                      : "frontstage.workbench.knowledgeUniverse.importToSpace.url.crawlPlaceholder",
                  )}
                  ?disabled=${true}
                />
              `
        }
      </label>

      <details
        class="ku-space-import__fold ku-space-import__url-advanced"
        data-testid="ku-space-import-url-advanced"
        ?open=${surface.libraryWorkspaceUrlImportAdvancedOpen}
        @toggle=${(event: Event) => {
          const details = event.target as HTMLDetailsElement;
          surface.onLibraryWorkspaceUrlImportAdvancedOpenChange?.(details.open);
        }}
      >
        <summary>${t("frontstage.workbench.knowledgeUniverse.importToSpace.url.advancedTitle")}</summary>
        <div class="ku-space-import__section">
          <h3 class="ku-space-import__section-title">${t("frontstage.workbench.knowledgeUniverse.importToSpace.url.syncLabel")}</h3>
          <div class="ku-space-import__seg-group" role="radiogroup">
            ${renderSyncScheduleOption({
              schedule: "once",
              active: surface.libraryWorkspaceUrlSyncSchedule ?? "once",
              disabled: surface.personalActionBusy,
              onSelect: (value) => surface.onLibraryWorkspaceUrlSyncScheduleChange?.(value),
            })}
            ${renderSyncScheduleOption({
              schedule: "daily",
              active: surface.libraryWorkspaceUrlSyncSchedule ?? "once",
              disabled: surface.personalActionBusy,
              onSelect: (value) => surface.onLibraryWorkspaceUrlSyncScheduleChange?.(value),
            })}
            ${renderSyncScheduleOption({
              schedule: "weekly",
              active: surface.libraryWorkspaceUrlSyncSchedule ?? "once",
              disabled: surface.personalActionBusy,
              onSelect: (value) => surface.onLibraryWorkspaceUrlSyncScheduleChange?.(value),
            })}
          </div>
        </div>
        <div class="ku-space-import__section">
          <h3 class="ku-space-import__section-title">${t("frontstage.workbench.knowledgeUniverse.importToSpace.url.cleaningLabel")}</h3>
          <div class="ku-space-import__url-cleaning-group">
            <label class="ku-space-import__url-checkbox">
              <input
                type="checkbox"
                .checked=${surface.libraryWorkspaceUrlStripNavAds ?? true}
                ?disabled=${surface.personalActionBusy}
                @change=${(event: Event) =>
                  surface.onLibraryWorkspaceUrlStripNavAdsChange?.(
                    (event.target as HTMLInputElement).checked,
                  )}
              />
              <span>${t("frontstage.workbench.knowledgeUniverse.importToSpace.url.stripNavAds")}</span>
            </label>
            <label class="ku-space-import__url-checkbox">
              <input
                type="checkbox"
                .checked=${Boolean(surface.libraryWorkspaceUrlMainContentOnly)}
                ?disabled=${surface.personalActionBusy}
                @change=${(event: Event) =>
                  surface.onLibraryWorkspaceUrlMainContentOnlyChange?.(
                    (event.target as HTMLInputElement).checked,
                  )}
              />
              <span>${t("frontstage.workbench.knowledgeUniverse.importToSpace.url.mainContentOnly")}</span>
            </label>
          </div>
        </div>
      </details>

      <div class="ku-space-import__actions ku-space-import__actions--url">
        <button
          type="button"
          class="btn btn--primary"
          data-testid="ku-space-import-url-submit"
          ?disabled=${!canStartWebImport(surface)}
          @click=${() => void surface.onImportWebUrlsToSpace?.()}
        >
          ${
            surface.personalActionBusy
              ? t("frontstage.workbench.knowledgeUniverse.importToSpace.url.importBusy")
              : t("frontstage.workbench.knowledgeUniverse.importToSpace.url.importAction")
          }
        </button>
      </div>
    </div>
  `;
}
