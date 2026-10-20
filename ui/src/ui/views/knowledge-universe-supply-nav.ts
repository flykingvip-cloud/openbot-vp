import type { WorkbenchKnowledgeSurface } from "../ports/employee/views/home-page-contracts.ts";
import {
  expandKnowledgeUniverseSupplySection,
  navigateKnowledgeUniverseAnchor,
} from "./knowledge-universe-anchor-nav.ts";

export function activateKnowledgeUniverseSupplyPanel(
  surface: WorkbenchKnowledgeSurface,
  section: import("../ports/employee/views/home-page-contracts.ts").KnowledgeUniverseBrowseSubTab,
  anchorId: string,
) {
  surface.onPageTabChange("supply");
  surface.onBrowseSubTabChange(section);
  expandKnowledgeUniverseSupplySection(section);
  navigateKnowledgeUniverseAnchor(anchorId);
}
