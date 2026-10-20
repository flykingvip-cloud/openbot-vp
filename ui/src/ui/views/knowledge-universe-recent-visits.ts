import { html, nothing } from "lit";
import { t } from "../../i18n/index.ts";
import { knowledgeSourceLabel } from "../capability/knowledge-universe/source-labels.ts";
import type { KnowledgeRecentVisit } from "../capability/knowledge-universe/types.ts";

export function renderKnowledgeUniverseRecentVisits(params: {
  visits: KnowledgeRecentVisit[];
  onSelectObject: (objectId: string) => void;
}) {
  if (!params.visits.length) {
    return nothing;
  }
  return html`
    <section class="knowledge-universe__recent">
      <div class="knowledge-universe__recent-heading">
        ${t("frontstage.workbench.knowledgeUniverse.recent.heading")}
      </div>
      <ul class="knowledge-universe__recent-list">
        ${params.visits.map(
          (visit) => html`
            <li>
              <button
                type="button"
                class="knowledge-universe__recent-item"
                @click=${() => params.onSelectObject(visit.objectId)}
              >
                <span class="knowledge-universe__recent-title">${visit.title}</span>
                <span class="knowledge-universe__recent-source">${knowledgeSourceLabel(visit.source)}</span>
              </button>
            </li>
          `,
        )}
      </ul>
    </section>
  `;
}
