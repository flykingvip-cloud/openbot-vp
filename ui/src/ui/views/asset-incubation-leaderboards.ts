import { html, type TemplateResult } from "lit";

export type AssetLeaderboardEntityType = "employee" | "enterprise";

export type AssetLeaderboardMetricVM = {
  label: string;
  value: string;
};

export type AssetLeaderboardEntryVM = {
  id: string;
  entityType: AssetLeaderboardEntityType;
  rank?: number | null;
  name: string;
  subtitle: string;
  description: string;
  badge?: string | null;
  highlights: string[];
  primaryMetric: AssetLeaderboardMetricVM;
  secondaryMetric: AssetLeaderboardMetricVM;
};

export type AssetLeaderboardSectionVM = {
  title: string;
  description: string;
  entries: AssetLeaderboardEntryVM[];
  emptyTitle: string;
  emptyDescription: string;
};

function renderMetric(metric: AssetLeaderboardMetricVM): TemplateResult {
  return html`
    <div class="asset-leaderboard__metric">
      <span class="asset-leaderboard__metric-label">${metric.label}</span>
      <strong class="asset-leaderboard__metric-value">${metric.value}</strong>
    </div>
  `;
}

function renderEntry(entry: AssetLeaderboardEntryVM): TemplateResult {
  return html`
    <article class="asset-leaderboard__entry asset-leaderboard__entry--${entry.entityType}">
      <div class="asset-leaderboard__entry-head">
        <div class="asset-leaderboard__identity">
          <div class="asset-leaderboard__avatar" aria-hidden="true">
            ${entry.entityType === "employee" ? "创" : "企"}
          </div>
          <div class="asset-leaderboard__identity-copy">
            <div class="asset-leaderboard__title-row">
              <strong class="asset-leaderboard__name">${entry.name}</strong>
              ${
                entry.rank
                  ? html`<span class="asset-leaderboard__rank">第 ${entry.rank} 名</span>`
                  : ""
              }
              ${entry.badge ? html`<span class="asset-leaderboard__badge">${entry.badge}</span>` : ""}
            </div>
            <div class="asset-leaderboard__subtitle">${entry.subtitle}</div>
            <div class="asset-leaderboard__description">${entry.description}</div>
          </div>
        </div>
      </div>
      <div class="asset-leaderboard__highlights">
        ${entry.highlights
          .slice(0, 3)
          .map((item) => html`<span class="asset-leaderboard__highlight">${item}</span>`)}
      </div>
      <div class="asset-leaderboard__metrics">
        ${renderMetric(entry.primaryMetric)}
        ${renderMetric(entry.secondaryMetric)}
      </div>
    </article>
  `;
}

export function renderAssetLeaderboardSection(section: AssetLeaderboardSectionVM): TemplateResult {
  return html`
    <section class="asset-leaderboard">
      <div class="asset-leaderboard__section-head">
        <div>
          <h3 class="asset-leaderboard__section-title">${section.title}</h3>
          <p class="asset-leaderboard__section-description">${section.description}</p>
        </div>
      </div>
      ${
        section.entries.length > 0
          ? html`
              <div class="asset-leaderboard__grid">
                ${section.entries.map((entry) => renderEntry(entry))}
              </div>
            `
          : html`
              <div class="asset-leaderboard__empty">
                <strong>${section.emptyTitle}</strong>
                <span>${section.emptyDescription}</span>
              </div>
            `
      }
    </section>
  `;
}
