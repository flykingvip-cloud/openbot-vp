// Retired route: knowledge-universe-page maps `deliverables` back to home.
// This renderer stays for table/governance unit tests only.
import { html, nothing } from "lit";
import { t } from "../../i18n/index.ts";
import type { WorkspaceDeliverableDto } from "../capability/knowledge-universe/workspace-endpoints.ts";
import type { WorkbenchKnowledgeSurface } from "../ports/employee/views/home-page-contracts.ts";
import { renderWorkOutputInsightSidebar } from "./knowledge-universe-intelligence-sidebar.ts";
import { renderKnowledgeUniverseDeliverablesTableEmbedded } from "./knowledge-universe-workspace-panels.ts";

type OutputNavFilter = "all" | "mine" | "agent" | "team" | "recent";

const OUTPUT_FILTERS: OutputNavFilter[] = ["all", "mine", "agent", "team", "recent"];

function filterLabel(filter: OutputNavFilter): string {
  return t(`frontstage.workbench.knowledgeUniverse.workOutputCenter.filters.${filter}`);
}

function resolveOwnerLabel(item: WorkspaceDeliverableDto): string {
  return item.primaryCreatorName ?? item.creators[0] ?? item.groupTitle ?? "—";
}

function groupDeliverablesByOwner(
  items: WorkspaceDeliverableDto[],
): Array<[string, WorkspaceDeliverableDto[]]> {
  const groups = new Map<string, WorkspaceDeliverableDto[]>();
  for (const item of items) {
    const key = resolveOwnerLabel(item);
    const bucket = groups.get(key) ?? [];
    bucket.push(item);
    groups.set(key, bucket);
  }
  return [...groups.entries()].toSorted((a, b) => b[1].length - a[1].length);
}

function renderOutputNav(surface: WorkbenchKnowledgeSurface) {
  const counts = {
    all: surface.workspaceDeliverables.length,
    agent: surface.workspaceDeliverables.filter(
      (item) => item.source === "agent" || item.sourceType === "agent",
    ).length,
    team: surface.workspaceDeliverables.filter(
      (item) => item.source === "group" || item.sourceType === "collaboration",
    ).length,
  };

  return html`
    <nav class="ku-output-center__nav" aria-label=${t("frontstage.workbench.knowledgeUniverse.workOutputCenter.navHeading")}>
      <h3 class="ku-output-center__nav-title">
        ${t("frontstage.workbench.knowledgeUniverse.workOutputCenter.navTitle")}
      </h3>
      <ul class="ku-output-center__nav-list">
        ${OUTPUT_FILTERS.map((filter) => {
          const count =
            filter === "all"
              ? counts.all
              : filter === "agent"
                ? counts.agent
                : filter === "team"
                  ? counts.team
                  : null;
          return html`
            <li>
              <button
                type="button"
                class="ku-output-center__nav-item ${filter === "all" ? "is-active" : ""}"
                @click=${() => {
                  if (filter !== "all") {
                    surface.onDeliverableStatusFilterChange("all");
                  }
                }}
              >
                <span>${filterLabel(filter)}</span>
                ${count === null ? nothing : html`<span class="ku-output-center__nav-count">${count}</span>`}
              </button>
            </li>
          `;
        })}
      </ul>
    </nav>
  `;
}

function renderWorkflowStream(surface: WorkbenchKnowledgeSurface) {
  const groups = groupDeliverablesByOwner(surface.workspaceDeliverables).slice(0, 4);
  if (groups.length === 0) {
    return nothing;
  }

  return html`
    <section class="ku-output-center__stream" aria-label=${t("frontstage.workbench.knowledgeUniverse.workOutputCenter.streamHeading")}>
      <header class="ku-output-center__stream-head">
        <h3 class="ku-output-center__stream-title">
          ${t("frontstage.workbench.knowledgeUniverse.workOutputCenter.streamHeading")}
        </h3>
        <p class="ku-output-center__stream-sub">
          ${t("frontstage.workbench.knowledgeUniverse.workOutputCenter.streamSub")}
        </p>
      </header>
      <div class="ku-output-center__stream-groups">
        ${groups.map(
          ([owner, items]) => html`
            <article class="ku-output-center__stream-group">
              <header class="ku-output-center__stream-group-head">
                <span class="ku-output-center__stream-group-owner">${owner}</span>
                <span class="ku-output-center__stream-group-count">${items.length}</span>
              </header>
              <ul class="ku-output-center__stream-items">
                ${items.slice(0, 3).map(
                  (item) => html`
                    <li>
                      <button
                        type="button"
                        class="ku-output-center__stream-item"
                        @click=${() => surface.onViewDeliverable(item.deliverableId)}
                      >
                        <span class="ku-output-center__stream-item-title">${item.title}</span>
                        <span class="ku-output-center__stream-item-meta">${item.status}</span>
                      </button>
                    </li>
                  `,
                )}
              </ul>
            </article>
          `,
        )}
      </div>
    </section>
  `;
}

export function renderKnowledgeUniverseWorkOutputCenterPage(surface: WorkbenchKnowledgeSurface) {
  return html`
    <div class="ku-output-center">
      ${renderOutputNav(surface)}
      <main class="ku-output-center__main">
        <header class="ku-output-center__hero">
          <div>
            <h2 class="ku-output-center__hero-title">
              ${t("frontstage.workbench.knowledgeUniverse.workOutputCenter.pageTitle")}
            </h2>
            <p class="ku-output-center__hero-desc">
              ${t("frontstage.workbench.knowledgeUniverse.workOutputCenter.pageDescription")}
            </p>
          </div>
        </header>
        ${renderWorkflowStream(surface)}
        ${renderKnowledgeUniverseDeliverablesTableEmbedded(surface)}
      </main>
      ${renderWorkOutputInsightSidebar(surface)}
    </div>
  `;
}
