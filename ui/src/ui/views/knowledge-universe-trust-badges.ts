import { html, nothing } from "lit";
import { t } from "../../i18n/index.ts";
import type {
  KnowledgeBaseSummary,
  KnowledgeEvidenceDto,
} from "../capability/knowledge-universe/workspace-endpoints.ts";
import type { WorkspaceSearchHit } from "../capability/knowledge-universe/workspace-endpoints.ts";
import {
  artifactGovernanceStatusClass,
  labelArtifactGovernanceStatus,
  titleArtifactGovernanceStatus,
  type ArtifactGovernanceStatus,
} from "./knowledge-universe-artifact-taxonomy.ts";

export function renderArtifactGovernanceTrustBadge(
  status: ArtifactGovernanceStatus,
  options?: { testId?: string },
) {
  const label = labelArtifactGovernanceStatus(status);
  return html`
    <span
      class="knowledge-universe__artifact-governance-badge knowledge-universe__artifact-governance-badge--${status}"
      data-testid=${options?.testId ?? "ku-governance-trust-badge"}
      data-governance=${status}
      title=${titleArtifactGovernanceStatus(status)}
    >
      <span class=${artifactGovernanceStatusClass(status)} aria-hidden="true"></span>
      <span class="knowledge-universe__artifact-governance-label">${label}</span>
    </span>
  `;
}

export function resolveEvidenceDtoTrustStatus(
  evidence: Pick<
    KnowledgeEvidenceDto,
    "governanceStatus" | "governanceConflict" | "governanceClaimConflict"
  >,
): ArtifactGovernanceStatus | undefined {
  if (evidence.governanceClaimConflict || evidence.governanceConflict) {
    return "conflict";
  }
  if (evidence.governanceStatus === "pending" || evidence.governanceStatus === "suppressed") {
    return "pending";
  }
  if (
    evidence.governanceStatus === "confirmed" ||
    evidence.governanceStatus === "merged" ||
    evidence.governanceStatus === "archived"
  ) {
    return "verified";
  }
  return undefined;
}

export function renderSearchHitTrustBadges(hit: WorkspaceSearchHit) {
  const badges = [];
  if (hit.governanceStatus) {
    badges.push(renderArtifactGovernanceTrustBadge(hit.governanceStatus));
  }
  if (typeof hit.score === "number" && Number.isFinite(hit.score)) {
    badges.push(html`
      <span class="knowledge-universe__search-hit-score" data-testid="ku-search-hit-score">
        ${t("frontstage.workbench.knowledgeUniverse.search.relevanceScore", {
          score: Math.round(hit.score * 100),
        })}
      </span>
    `);
  }
  if (badges.length === 0) {
    return nothing;
  }
  return html`<span class="knowledge-universe__search-hit-badges">${badges}</span>`;
}

export function renderEvidenceTrustBadges(evidence: KnowledgeEvidenceDto) {
  const status = resolveEvidenceDtoTrustStatus(evidence);
  const badges = [];
  if (status) {
    badges.push(
      renderArtifactGovernanceTrustBadge(status, { testId: "ku-evidence-governance-badge" }),
    );
  }
  if (Number.isFinite(evidence.score)) {
    badges.push(html`
      <span class="knowledge-universe__evidence-score" data-testid="ku-evidence-score">
        ${t("frontstage.workbench.knowledgeUniverse.search.relevanceScore", {
          score: Math.round(evidence.score * 100),
        })}
      </span>
    `);
  }
  if (badges.length === 0) {
    return nothing;
  }
  return html`<span class="knowledge-universe__evidence-badges">${badges}</span>`;
}

export function renderOptionalArtifactGovernanceTrustBadge(
  status: ArtifactGovernanceStatus | undefined,
  options?: { testId?: string },
) {
  if (!status) {
    return nothing;
  }
  return renderArtifactGovernanceTrustBadge(status, options);
}

function labelKnowledgeBaseRuntimeStatus(
  status: NonNullable<KnowledgeBaseSummary["governanceStatus"]>,
): string {
  return t(`frontstage.workbench.knowledgeUniverse.workspace.libraryRuntime.${status}`);
}

export function renderKnowledgeBaseRuntimeBadges(kb: KnowledgeBaseSummary) {
  const status = kb.governanceStatus ?? "healthy";
  const conflictCount = kb.conflictCount ?? 0;
  const healthScore = kb.healthScore ?? 100;
  return html`
    <span class="knowledge-universe__library-runtime-badges" data-testid="ku-library-runtime-badges">
      <span
        class="knowledge-universe__library-runtime-badge knowledge-universe__library-runtime-badge--${status}"
        data-testid="ku-library-runtime-status"
        data-runtime-status=${status}
      >
        ${labelKnowledgeBaseRuntimeStatus(status)}
      </span>
      ${
        conflictCount > 0
          ? html`
              <span
                class="knowledge-universe__library-runtime-badge knowledge-universe__library-runtime-badge--conflict-count"
                data-testid="ku-library-runtime-conflicts"
              >
                ${t(
                  "frontstage.workbench.knowledgeUniverse.workspace.libraryRuntime.openConflicts",
                  {
                    count: conflictCount,
                  },
                )}
              </span>
            `
          : nothing
      }
      <span
        class="knowledge-universe__library-runtime-badge knowledge-universe__library-runtime-badge--health"
        data-testid="ku-library-runtime-health"
      >
        ${t("frontstage.workbench.knowledgeUniverse.workspace.libraryRuntime.healthScore", {
          score: healthScore,
        })}
      </span>
    </span>
  `;
}
