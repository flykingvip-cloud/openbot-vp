import { html, nothing } from "lit";
import { t } from "../../i18n/index.ts";
import type { KnowledgeActionSuggestion } from "../capability/knowledge-universe/types.ts";

export type KnowledgeInsightTrustLevel = "high" | "medium" | "low";

export type KnowledgeInsightCardDiscovery = {
  id: string;
  tone: "ok" | "warn" | "info";
  headline: string;
  bullets: string[];
  trustLevel: KnowledgeInsightTrustLevel;
  trustScore?: number;
  evidence: string[];
  action?: {
    label: string;
    suggestion: KnowledgeActionSuggestion;
    executable: boolean;
  };
};

export function trustLevelLabel(level: KnowledgeInsightTrustLevel): string {
  return t(`frontstage.workbench.knowledgeUniverse.detail.insights.trust.${level}`);
}

export function renderKnowledgeInsightCard(params: {
  discovery: KnowledgeInsightCardDiscovery;
  index: number;
  variant?: "detail" | "compact";
  onExecuteKnowledgeAction?: (action: KnowledgeActionSuggestion) => void;
}) {
  const { discovery } = params;
  const compact = params.variant === "compact";
  return html`
    <article
      class=${`ku-insight-card ku-insight-card--${discovery.tone}${
        compact ? " ku-insight-card--compact" : ""
      }`}
      data-testid="ku-insight-card"
      data-insight-id=${discovery.id}
    >
      <header class="ku-insight-card__head">
        ${
          compact
            ? nothing
            : html`<span class="ku-insight-card__index"
                >${t("frontstage.workbench.knowledgeUniverse.detail.insights.discoveryIndex", {
                  index: params.index + 1,
                })}</span
              >`
        }
        <h5 class="ku-insight-card__headline">${discovery.headline}</h5>
      </header>
      ${
        discovery.bullets.length
          ? html`<ul class="ku-insight-card__bullets">
              ${discovery.bullets.map((bullet) => html`<li>${bullet}</li>`)}
            </ul>`
          : nothing
      }
      <details class="ku-insight-card__why">
        <summary>
          ${t("frontstage.workbench.knowledgeUniverse.detail.insights.whyToggle")}
        </summary>
        <div class="ku-insight-card__why-body">
          <p class="ku-insight-card__trust">
            ${t("frontstage.workbench.knowledgeUniverse.detail.insights.trustPrefix")}
            <strong>${trustLevelLabel(discovery.trustLevel)}</strong>
            ${
              discovery.trustScore != null
                ? html`<span class="ku-insight-card__trust-score"
                    >${t(
                      "frontstage.workbench.knowledgeUniverse.detail.insights.trustScoreHidden",
                      { percent: Math.round(discovery.trustScore) },
                    )}</span
                  >`
                : nothing
            }
          </p>
          <p class="ku-insight-card__evidence-title">
            ${t("frontstage.workbench.knowledgeUniverse.detail.insights.evidenceHeading")}
          </p>
          <ul class="ku-insight-card__evidence">
            ${discovery.evidence.map((item) => html`<li>${item}</li>`)}
          </ul>
        </div>
      </details>
      ${
        discovery.action
          ? html`<footer class="ku-insight-card__foot">
              ${
                discovery.action.executable && params.onExecuteKnowledgeAction
                  ? html`<button
                      type="button"
                      class="btn btn--sm ku-insight-card__btn"
                      data-testid="ku-insight-action"
                      @click=${() =>
                        params.onExecuteKnowledgeAction?.(discovery.action!.suggestion)}
                    >
                      ${discovery.action.label}
                    </button>`
                  : html`<span class="ku-insight-card__suggestion">${discovery.action.label}</span>`
              }
            </footer>`
          : nothing
      }
    </article>
  `;
}
