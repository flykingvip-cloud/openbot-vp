import { html, nothing } from "lit";
import type { WorkbenchKnowledgeSurface } from "../ports/employee/views/home-page-contracts.ts";
import { renderKnowledgeUniverseCockpitTree } from "./knowledge-universe-cockpit-tree.ts";
import { renderKnowledgeUniverseHomeCommandBar } from "./knowledge-universe-home-command-bar.ts";
import { renderKnowledgeUniverseHomeRelationsCockpit } from "./knowledge-universe-home-relations-cockpit.ts";

export type KnowledgeUniverseHomeCockpitOptions = {
  onUploadKnowledge: () => void;
  onOpenDataCapability: () => void;
  onOpenMyAssets: () => void;
  onOpenGovernance: () => void;
  onOpenLibraryCreate: () => void;
  onCreateFolderInSection?: (
    visibility: import("../capability/knowledge-universe/workspace-endpoints.ts").KnowledgeBaseSummary["visibility"],
  ) => void | Promise<void>;
  onExpandRelations: () => void;
};

/**
 * Knowledge workbench home cockpit. Assembles the rebuilt homepage:
 *   顶部指挥条
 *   ┌ 左 25% ────────────┬ 右 75% ───────────────┐
 *   │ 我的知识库 (树+文档叶子) │ 关系洞察主战舱 (拓扑为主)   │
 *   └────────────────────┴──────────────────────┘
 * Every click on the left cabins moves the unified homeFocus, which the right cockpit reads to
 * re-center the topology and governance band — one linked command surface, not independent cards.
 */
export function renderKnowledgeUniverseHomeCockpit(
  surface: WorkbenchKnowledgeSurface,
  options: KnowledgeUniverseHomeCockpitOptions,
) {
  return html`
    <div
      class="knowledge-universe knowledge-universe--workspace-home knowledge-universe--refined knowledge-universe--cockpit ku-home"
      data-testid="ku-home"
    >
      ${renderKnowledgeUniverseHomeCommandBar(surface, {
        onUploadKnowledge: options.onUploadKnowledge,
        onOpenDataCapability: options.onOpenDataCapability,
        onOpenMyAssets: options.onOpenMyAssets,
        onOpenGovernance: options.onOpenGovernance,
      })}

      ${
        surface.error
          ? html`<div class="knowledge-universe__error" role="alert">${surface.error}</div>`
          : nothing
      }

      <div class="ku-home__grid" data-testid="ku-home-grid">
        <div class="ku-home__col ku-home__col--rail">
          ${renderKnowledgeUniverseCockpitTree(surface, {
            onOpenLibraryCreate: options.onOpenLibraryCreate,
            onCreateFolderInSection:
              options.onCreateFolderInSection ?? surface.onCreateFolderInSection,
          })}
        </div>
        <div class="ku-home__col ku-home__col--main">
          ${renderKnowledgeUniverseHomeRelationsCockpit(surface, {
            onExpandRelations: options.onExpandRelations,
            onOpenGovernance: options.onOpenGovernance,
          })}
        </div>
      </div>
    </div>
  `;
}
