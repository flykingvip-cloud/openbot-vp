import { html, nothing } from "lit";
import { t } from "../../i18n/index.ts";
import type { KnowledgeBaseSummary } from "../capability/knowledge-universe/workspace-endpoints.ts";
import type { WorkbenchKnowledgeSurface } from "../ports/employee/views/home-page-contracts.ts";
import { openKnowledgeSpaceCreateWithVisibility } from "./knowledge-universe-create-entry.ts";
import { kuIconFolder } from "./knowledge-universe-icons.ts";
import {
  filterKnowledgeBasesByVisibility,
  type KnowledgeBaseVisibilityGroup,
} from "./knowledge-universe-library-grouping.ts";
import { renderKnowledgeBaseRuntimeBadges } from "./knowledge-universe-trust-badges.ts";

function formatUpdatedAt(updatedAtMs: number): string {
  return new Date(updatedAtMs).toLocaleDateString();
}

function visibilityEmptyCopy(visibility: KnowledgeBaseVisibilityGroup): string {
  return t(`frontstage.workbench.knowledgeUniverse.supplySpaces.empty.${visibility}`);
}

function renderSpaceCard(surface: WorkbenchKnowledgeSurface, kb: KnowledgeBaseSummary) {
  return html`
    <button
      type="button"
      class="knowledge-universe__workspace-item knowledge-universe__workspace-item--row ${
        surface.selectedKnowledgeBaseId === kb.id ? "is-active" : ""
      }"
      @click=${() => {
        surface.onSelectKnowledgeBase(kb.id);
        surface.onPageTabChange("workbench");
      }}
    >
      <span class="knowledge-universe__workspace-item-icon" aria-hidden="true"
        >${kuIconFolder("knowledge-universe__workspace-item-icon-svg")}</span
      >
      <span class="knowledge-universe__workspace-item-body">
        <span class="knowledge-universe__workspace-item-title">${kb.title}</span>
        <span class="knowledge-universe__workspace-item-meta">
          ${t("frontstage.workbench.knowledgeUniverse.workspace.lastUpdated", {
            when: formatUpdatedAt(kb.updatedAtMs),
          })}
        </span>
      </span>
      <span class="knowledge-universe__workspace-item-count">
        ${renderKnowledgeBaseRuntimeBadges(kb)}
      </span>
    </button>
  `;
}

export function renderKnowledgeUniverseSupplySpaceSection(
  surface: WorkbenchKnowledgeSurface,
  visibility: KnowledgeBaseVisibilityGroup,
) {
  const spaces = filterKnowledgeBasesByVisibility(surface.knowledgeBases, visibility);
  if (spaces.length === 0) {
    return html`
      <div class="knowledge-universe__empty-copy" data-testid="ku-supply-spaces-empty-${visibility}">
        ${visibilityEmptyCopy(visibility)}
      </div>
      <button
        type="button"
        class="btn btn--sm btn--primary"
        @click=${() => openKnowledgeSpaceCreateWithVisibility(surface, visibility)}
      >
        ${t("frontstage.workbench.knowledgeUniverse.supplySpaces.createAction")}
      </button>
    `;
  }
  return html`
    <div class="knowledge-universe__workspace-list knowledge-universe__workspace-list--cards">
      ${spaces.map((kb) => renderSpaceCard(surface, kb))}
    </div>
  `;
}

export function renderKnowledgeUniverseEnterpriseSupplySpaces(surface: WorkbenchKnowledgeSurface) {
  const teamSpaces = filterKnowledgeBasesByVisibility(surface.knowledgeBases, "team");
  const enterpriseSpaces = filterKnowledgeBasesByVisibility(surface.knowledgeBases, "enterprise");
  if (teamSpaces.length === 0 && enterpriseSpaces.length === 0) {
    return renderKnowledgeUniverseSupplySpaceSection(surface, "enterprise");
  }
  return html`
    ${
      teamSpaces.length > 0
        ? html`<div class="knowledge-universe__supply-space-group">
            <h4 class="knowledge-universe__supply-space-group-title">
              ${t("frontstage.workbench.knowledgeUniverse.libraryWorkspace.treeSectionTeam")}
            </h4>
            <div class="knowledge-universe__workspace-list knowledge-universe__workspace-list--cards">
              ${teamSpaces.map((kb) => renderSpaceCard(surface, kb))}
            </div>
          </div>`
        : nothing
    }
    ${
      enterpriseSpaces.length > 0
        ? html`<div class="knowledge-universe__supply-space-group">
            <h4 class="knowledge-universe__supply-space-group-title">
              ${t("frontstage.workbench.knowledgeUniverse.libraryWorkspace.treeSectionEnterprise")}
            </h4>
            <div class="knowledge-universe__workspace-list knowledge-universe__workspace-list--cards">
              ${enterpriseSpaces.map((kb) => renderSpaceCard(surface, kb))}
            </div>
          </div>`
        : nothing
    }
  `;
}
