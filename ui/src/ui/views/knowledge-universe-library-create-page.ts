import { html, nothing } from "lit";
import { t } from "../../i18n/index.ts";
import type { KnowledgeBaseSummary } from "../capability/knowledge-universe/workspace-endpoints.ts";
import type { WorkbenchKnowledgeSurface } from "../ports/employee/views/home-page-contracts.ts";
import { kuIconShield } from "./knowledge-universe-icons.ts";

type LibraryVisibility = KnowledgeBaseSummary["visibility"];

const VISIBILITY_OPTIONS: LibraryVisibility[] = ["private", "team", "enterprise"];

function spaceTypeTitle(visibility: LibraryVisibility): string {
  return t(`frontstage.workbench.knowledgeUniverse.libraryCreate.spaceType.${visibility}.title`);
}

function spaceTypeConsume(visibility: LibraryVisibility): string {
  return t(`frontstage.workbench.knowledgeUniverse.libraryCreate.spaceType.${visibility}.consume`);
}

function spaceTypeDesc(visibility: LibraryVisibility): string {
  return t(`frontstage.workbench.knowledgeUniverse.libraryCreate.spaceType.${visibility}.desc`);
}

export function renderKnowledgeUniverseLibraryCreatePage(surface: WorkbenchKnowledgeSurface) {
  const selectedVisibility = surface.newKnowledgeBaseVisibility ?? "private";

  return html`
    <div class="ku-library-create">
      <section class="ku-library-create__form-card">
        <header class="ku-library-create__head">
          <span class="ku-library-create__icon" aria-hidden="true"
            >${kuIconShield("ku-library-create__icon-svg")}</span
          >
          <div>
            <h3 class="ku-library-create__title">
              ${t("frontstage.workbench.knowledgeUniverse.libraryCreate.formTitle")}
            </h3>
            <p class="ku-library-create__subtitle">
              ${t("frontstage.workbench.knowledgeUniverse.libraryCreate.formSub")}
            </p>
          </div>
        </header>

        ${
          surface.workspaceError
            ? html`<div class="ku-library-create__error" role="alert">${surface.workspaceError}</div>`
            : nothing
        }
        ${
          surface.workspaceHint
            ? html`<div class="ku-library-create__hint" role="status">${surface.workspaceHint}</div>`
            : nothing
        }

        <form
          class="ku-library-create__form"
          @submit=${(event: Event) => {
            event.preventDefault();
            void surface.onCreateKnowledgeBase();
          }}
        >
          <label class="ku-library-create__field">
            <span class="ku-library-create__label"
              >${t("frontstage.workbench.knowledgeUniverse.libraryCreate.nameLabel")}</span
            >
            <input
              class="ku-library-create__input"
              type="text"
              .value=${surface.newKnowledgeBaseTitle}
              placeholder=${t("frontstage.workbench.knowledgeUniverse.workspace.createPlaceholder")}
              ?disabled=${surface.workspaceBusy}
              @input=${(event: Event) =>
                surface.onNewKnowledgeBaseTitleChange((event.target as HTMLInputElement).value)}
            />
          </label>

          <label class="ku-library-create__field">
            <span class="ku-library-create__label"
              >${t("frontstage.workbench.knowledgeUniverse.libraryCreate.descriptionLabel")}</span
            >
            <textarea
              class="ku-library-create__textarea"
              rows="3"
              .value=${surface.newKnowledgeBaseDescription}
              placeholder=${t("frontstage.workbench.knowledgeUniverse.libraryCreate.descriptionPlaceholder")}
              ?disabled=${surface.workspaceBusy}
              @input=${(event: Event) =>
                surface.onNewKnowledgeBaseDescriptionChange(
                  (event.target as HTMLTextAreaElement).value,
                )}
            ></textarea>
          </label>

          <fieldset class="ku-library-create__visibility">
            <legend class="ku-library-create__label">
              ${t("frontstage.workbench.knowledgeUniverse.libraryCreate.spaceType.label")}
            </legend>
            <p class="ku-library-create__visibility-note">
              ${t("frontstage.workbench.knowledgeUniverse.libraryCreate.spaceType.note")}
            </p>
            <div class="ku-library-create__visibility-options">
              ${VISIBILITY_OPTIONS.map(
                (visibility) => html`
                  <label class="ku-library-create__visibility-option">
                    <input
                      type="radio"
                      name="ku-library-create-visibility"
                      .value=${visibility}
                      ?checked=${selectedVisibility === visibility}
                      ?disabled=${surface.workspaceBusy}
                      @change=${() => surface.onNewKnowledgeBaseVisibilityChange(visibility)}
                    />
                    <span class="ku-library-create__visibility-body">
                      <span class="ku-library-create__visibility-head">
                        <span class="ku-library-create__visibility-title"
                          >${spaceTypeTitle(visibility)}</span
                        >
                        <span
                          class="ku-library-create__visibility-consume"
                          data-testid="ku-space-consume"
                          data-scope=${visibility}
                          >${spaceTypeConsume(visibility)}</span
                        >
                      </span>
                      <span class="ku-library-create__visibility-desc"
                        >${spaceTypeDesc(visibility)}</span
                      >
                    </span>
                  </label>
                `,
              )}
            </div>
            <p class="ku-library-create__runtime-note" data-testid="ku-space-runtime-note">
              ${t("frontstage.workbench.knowledgeUniverse.libraryCreate.spaceType.runtimeNote")}
            </p>
          </fieldset>

          <div class="ku-library-create__actions">
            <button
              type="button"
              class="btn btn--sm"
              ?disabled=${surface.workspaceBusy}
              @click=${() => surface.onPageTabChange("workbench")}
            >
              ${t("frontstage.workbench.knowledgeUniverse.libraryCreate.cancelAction")}
            </button>
            <button type="submit" class="btn btn--sm btn--primary" ?disabled=${surface.workspaceBusy}>
              ${t("frontstage.workbench.knowledgeUniverse.libraryCreate.submitAction")}
            </button>
          </div>
        </form>
      </section>

      <aside class="ku-library-create__aside">
        <h4 class="ku-library-create__aside-title">
          ${t("frontstage.workbench.knowledgeUniverse.libraryCreate.tipsHeading")}
        </h4>
        <ul class="ku-library-create__tips">
          <li>${t("frontstage.workbench.knowledgeUniverse.libraryCreate.tipStructure")}</li>
          <li>${t("frontstage.workbench.knowledgeUniverse.libraryCreate.tipGovernance")}</li>
          <li>${t("frontstage.workbench.knowledgeUniverse.libraryCreate.tipRag")}</li>
        </ul>
      </aside>
    </div>
  `;
}
