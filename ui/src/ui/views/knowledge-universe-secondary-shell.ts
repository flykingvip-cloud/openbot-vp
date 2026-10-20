import { html, nothing, type TemplateResult } from "lit";
import { t } from "../../i18n/index.ts";

export function renderKnowledgeUniverseSecondaryShell(params: {
  title?: string;
  subtitle?: string;
  onBack: () => void;
  body: TemplateResult | typeof nothing;
  /** Back link only — omit page title/subtitle (e.g. library workspace operating view). */
  compact?: boolean;
}) {
  const showHeadText = !params.compact && Boolean(params.title?.trim() || params.subtitle?.trim());
  return html`
    <section
      class="employee-workbench__module-page employee-workbench__module-page--knowledge knowledge-universe knowledge-universe--secondary-page knowledge-universe--refined ${
        params.compact ? "knowledge-universe--secondary-compact" : ""
      }"
    >
      <header class="knowledge-universe__secondary-head">
        <button
          type="button"
          class="knowledge-universe__secondary-back"
          @click=${params.onBack}
        >
          ${t("frontstage.workbench.knowledgeUniverse.layout.backToWorkbench")}
        </button>
        ${
          showHeadText
            ? html`<div class="knowledge-universe__secondary-head-text">
                ${
                  params.title?.trim()
                    ? html`<h2 class="knowledge-universe__secondary-title">${params.title}</h2>`
                    : nothing
                }
                ${
                  params.subtitle
                    ? html`<p class="knowledge-universe__secondary-subtitle">${params.subtitle}</p>`
                    : nothing
                }
              </div>`
            : nothing
        }
      </header>
      <div class="knowledge-universe__secondary-body">${params.body}</div>
    </section>
  `;
}
