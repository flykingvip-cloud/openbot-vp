import { html, nothing } from "lit";
import { t } from "../../i18n/index.ts";
import type { KnowledgeGovernanceSummary } from "../capability/knowledge-universe/endpoints.ts";
import type { WorkbenchKnowledgeSurface } from "../ports/employee/views/home-page-contracts.ts";
import { EMPTY_GOVERNANCE_SUMMARY } from "./knowledge-universe-governance-page.ts";

type DiscoveryStatTone = "conflict" | "duplicate" | "stale" | "orphan";

type DiscoveryStat = {
  key: DiscoveryStatTone;
  count: number;
};

function buildStats(summary: KnowledgeGovernanceSummary): DiscoveryStat[] {
  return [
    { key: "conflict", count: summary.openConflictCount + summary.openClaimConflictCount },
    { key: "duplicate", count: summary.openDuplicateCount },
    { key: "stale", count: summary.openStaleCount },
    { key: "orphan", count: summary.openOrphanCount },
  ];
}

/**
 * Heuristic knowledge-health index from the open governance signals. 100 = clean; each open issue
 * subtracts a weighted penalty (conflicts weigh most, orphans least), floored so the number stays
 * readable. This is a coarse signal for the strip, not a precise quality metric (object-level
 * quality scoring is not yet instrumented in the backend).
 */
function deriveHealthScore(summary: KnowledgeGovernanceSummary): number {
  const penalty =
    (summary.openConflictCount + summary.openClaimConflictCount) * 8 +
    summary.openDuplicateCount * 5 +
    summary.openStaleCount * 3 +
    summary.openOrphanCount * 2;
  if (penalty === 0) {
    return 100;
  }
  return Math.max(40, 100 - Math.min(60, penalty));
}

function healthScoreTone(score: number): "good" | "fair" | "poor" {
  if (score >= 85) {
    return "good";
  }
  if (score >= 65) {
    return "fair";
  }
  return "poor";
}

/**
 * Relations page top strip (Phase 1 §3 + governance-copilot increment C): a dynamic governance
 * entry, not just a passive discovery banner. Shows a derived health score, and when the runtime
 * has open signals (conflicts / duplicates / stale / orphans) it lists the counts and offers a
 * one-click "govern now" jump into the governance workspace. Only rendered on the standalone
 * relations page (not the home intelligence band).
 */
export function renderKnowledgeUniverseRelationsDiscovery(surface: WorkbenchKnowledgeSurface) {
  const summary = surface.governanceSummary ?? EMPTY_GOVERNANCE_SUMMARY;
  const stats = buildStats(summary);
  const total = stats.reduce((sum, stat) => sum + stat.count, 0);
  const score = deriveHealthScore(summary);
  const tone = healthScoreTone(score);
  return html`
    <section
      class="ku-relations-discovery"
      data-testid="ku-relations-discovery"
      aria-label=${t("frontstage.workbench.knowledgeUniverse.relationsDiscovery.heading")}
    >
      <span class="ku-relations-discovery__heading">
        ${t("frontstage.workbench.knowledgeUniverse.relationsDiscovery.heading")}
      </span>
      <span
        class=${`ku-relations-discovery__score ku-relations-discovery__score--${tone}`}
        data-testid="ku-relations-discovery-score"
        data-tone=${tone}
      >
        ${t("frontstage.workbench.knowledgeUniverse.relationsDiscovery.healthScore", { score })}
      </span>
      ${
        total === 0
          ? html`<span
              class="ku-relations-discovery__healthy"
              data-testid="ku-relations-discovery-healthy"
            >
              ${t("frontstage.workbench.knowledgeUniverse.relationsDiscovery.healthy")}
            </span>`
          : html`
              <div class="ku-relations-discovery__stats" role="list">
                ${stats.map((stat) =>
                  stat.count > 0
                    ? html`<span
                        class="ku-relations-discovery__stat ku-relations-discovery__stat--${stat.key}"
                        role="listitem"
                        data-stat=${stat.key}
                      >
                        <span class="ku-relations-discovery__count">${stat.count}</span>
                        <span class="ku-relations-discovery__label"
                          >${t(
                            `frontstage.workbench.knowledgeUniverse.relationsDiscovery.${stat.key}`,
                          )}</span
                        >
                      </span>`
                    : nothing,
                )}
              </div>
              <button
                type="button"
                class="ku-relations-discovery__govern"
                data-testid="ku-relations-discovery-govern"
                @click=${() => surface.onPageTabChange("governance")}
              >
                ${t("frontstage.workbench.knowledgeUniverse.relationsDiscovery.governCta")}
              </button>
            `
      }
    </section>
  `;
}
