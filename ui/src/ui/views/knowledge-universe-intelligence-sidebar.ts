import { html } from "lit";
import { t } from "../../i18n/index.ts";
import type { WorkbenchKnowledgeSurface } from "../ports/employee/views/home-page-contracts.ts";

export function renderWorkOutputInsightSidebar(surface: WorkbenchKnowledgeSurface) {
  const deliverables = surface.workspaceDeliverables;
  const agentCount = deliverables.filter(
    (item) => item.source === "agent" || item.sourceType === "agent",
  ).length;
  const humanCount = deliverables.filter(
    (item) => item.source === "chat" || item.sourceType === "personal",
  ).length;
  const teamCount = deliverables.filter(
    (item) => item.source === "group" || item.sourceType === "collaboration",
  ).length;
  const archiveCandidates = deliverables
    .filter((item) => !item.relatedKnowledgeBaseId && item.status === "done")
    .slice(0, 4);

  const agentGroups = new Map<string, number>();
  for (const item of deliverables) {
    const key = item.primaryCreatorName ?? item.creators[0] ?? "unknown";
    agentGroups.set(key, (agentGroups.get(key) ?? 0) + 1);
  }
  const hotAgents = [...agentGroups.entries()].toSorted((a, b) => b[1] - a[1]).slice(0, 4);

  return html`
    <aside class="ku-intel-sidebar" aria-label=${t("frontstage.workbench.knowledgeUniverse.workOutputCenter.insightHeading")}>
      <section class="ku-intel-sidebar__card">
        <header class="ku-intel-sidebar__head">
          <h3 class="ku-intel-sidebar__title">
            ${t("frontstage.workbench.knowledgeUniverse.workOutputCenter.overviewHeading")}
          </h3>
        </header>
        <div class="ku-intel-sidebar__metrics">
          <div class="ku-intel-sidebar__metric">
            <span class="ku-intel-sidebar__metric-value">${deliverables.length}</span>
            <span class="ku-intel-sidebar__metric-label"
              >${t("frontstage.workbench.knowledgeUniverse.workOutputCenter.metricAll")}</span
            >
          </div>
          <div class="ku-intel-sidebar__metric">
            <span class="ku-intel-sidebar__metric-value">${agentCount}</span>
            <span class="ku-intel-sidebar__metric-label"
              >${t("frontstage.workbench.knowledgeUniverse.workOutputCenter.metricAgent")}</span
            >
          </div>
          <div class="ku-intel-sidebar__metric">
            <span class="ku-intel-sidebar__metric-value">${humanCount}</span>
            <span class="ku-intel-sidebar__metric-label"
              >${t("frontstage.workbench.knowledgeUniverse.workOutputCenter.metricHuman")}</span
            >
          </div>
          <div class="ku-intel-sidebar__metric">
            <span class="ku-intel-sidebar__metric-value">${teamCount}</span>
            <span class="ku-intel-sidebar__metric-label"
              >${t("frontstage.workbench.knowledgeUniverse.workOutputCenter.metricTeam")}</span
            >
          </div>
        </div>
      </section>

      <section class="ku-intel-sidebar__card">
        <header class="ku-intel-sidebar__head">
          <h3 class="ku-intel-sidebar__title">
            ${t("frontstage.workbench.knowledgeUniverse.workOutputCenter.hotAgentsHeading")}
          </h3>
        </header>
        <div class="ku-intel-sidebar__body">
          ${
            hotAgents.length === 0
              ? html`<p class="ku-intel-sidebar__empty">
                  ${t("frontstage.workbench.knowledgeUniverse.workOutputCenter.hotAgentsEmpty")}
                </p>`
              : html`<ul class="ku-intel-sidebar__rank-list">
                  ${hotAgents.map(
                    ([name, count]) => html`
                      <li class="ku-intel-sidebar__rank-item">
                        <span class="ku-intel-sidebar__rank-name">${name}</span>
                        <span class="ku-intel-sidebar__rank-bar" style=${`--ku-rank-pct: ${Math.min(100, (count / deliverables.length) * 100)}%`}></span>
                        <span class="ku-intel-sidebar__rank-count">${count}</span>
                      </li>
                    `,
                  )}
                </ul>`
          }
        </div>
      </section>

      <section class="ku-intel-sidebar__card ku-intel-sidebar__card--accent">
        <header class="ku-intel-sidebar__head">
          <h3 class="ku-intel-sidebar__title">
            ${t("frontstage.workbench.knowledgeUniverse.workOutputCenter.archiveSuggestHeading")}
          </h3>
        </header>
        <div class="ku-intel-sidebar__body">
          ${
            archiveCandidates.length === 0
              ? html`<p class="ku-intel-sidebar__empty">
                  ${t("frontstage.workbench.knowledgeUniverse.workOutputCenter.archiveSuggestEmpty")}
                </p>`
              : html`<ul class="ku-intel-sidebar__suggestions">
                  ${archiveCandidates.map(
                    (item) => html`
                      <li class="ku-intel-sidebar__suggestion">
                        <span class="ku-intel-sidebar__suggestion-title">${item.title}</span>
                        <button
                          type="button"
                          class="ku-intel-sidebar__suggestion-action"
                          @click=${() => void surface.onArchiveDeliverable(item.deliverableId)}
                        >
                          ${t("frontstage.workbench.knowledgeUniverse.workspace.archiveActionShort")}
                        </button>
                      </li>
                    `,
                  )}
                </ul>`
          }
        </div>
      </section>
    </aside>
  `;
}
