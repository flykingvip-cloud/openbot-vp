import { html } from "lit";
import { t } from "../../i18n/index.ts";
import type { KnowledgeSourceSummary } from "../capability/knowledge-universe/types.ts";

export function renderKnowledgeUniverseEnterpriseSnapshot(params: {
  sourceSummary: KnowledgeSourceSummary | null;
  accessibleCount: number;
  restrictedCount: number;
  onBrowse?: () => void;
}) {
  const summary = params.sourceSummary;
  const accessible = summary?.enterprise.accessibleCount ?? params.accessibleCount;
  const libraries = summary?.enterprise.libraryCount ?? 0;
  const restricted = params.restrictedCount;

  return html`
    <section class="knowledge-universe__enterprise-snapshot">
      <div class="knowledge-universe__enterprise-snapshot-label">
        ${t("frontstage.workbench.knowledgeUniverse.workspace.enterpriseSnapshot.label")}
      </div>
      <div class="knowledge-universe__enterprise-snapshot-metrics">
        <span class="knowledge-universe__enterprise-snapshot-metric">
          <strong>${accessible}</strong>
          ${t("frontstage.workbench.knowledgeUniverse.workspace.enterpriseSnapshot.accessible")}
        </span>
        <span class="knowledge-universe__enterprise-snapshot-metric">
          <strong>${libraries}</strong>
          ${t("frontstage.workbench.knowledgeUniverse.workspace.enterpriseSnapshot.libraries")}
        </span>
        ${
          restricted > 0
            ? html`<span class="knowledge-universe__enterprise-snapshot-metric">
                <strong>${restricted}</strong>
                ${t("frontstage.workbench.knowledgeUniverse.workspace.enterpriseSnapshot.restricted")}
              </span>`
            : null
        }
      </div>
      <button
        type="button"
        class="knowledge-universe__enterprise-snapshot-action"
        @click=${() => params.onBrowse?.()}
      >
        ${t("frontstage.workbench.knowledgeUniverse.workspace.enterpriseSnapshot.action")}
      </button>
    </section>
  `;
}
