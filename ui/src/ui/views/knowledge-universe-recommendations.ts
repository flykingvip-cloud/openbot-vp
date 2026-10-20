import { html, nothing } from "lit";
import { t } from "../../i18n/index.ts";
import type { KnowledgeRecommendationItem } from "../capability/knowledge-universe/types.ts";

export function renderKnowledgeUniverseRecommendations(params: {
  recommendations: KnowledgeRecommendationItem[];
  onSelectObject: (objectId: string) => void;
}) {
  if (!params.recommendations.length) {
    return nothing;
  }
  return html`
    <section class="knowledge-universe__recommendations">
      <div class="knowledge-universe__recommendations-heading">
        ${t("frontstage.workbench.knowledgeUniverse.recommendations.heading")}
      </div>
      <ul class="knowledge-universe__recommendations-list">
        ${params.recommendations.map(
          (item) => html`
            <li>
              <button
                type="button"
                class="knowledge-universe__recommendations-item"
                @click=${() => params.onSelectObject(item.object.id)}
              >
                <span class="knowledge-universe__recommendations-title">${item.object.title}</span>
                <span class="knowledge-universe__recommendations-reason">${item.reason}</span>
              </button>
            </li>
          `,
        )}
      </ul>
    </section>
  `;
}
