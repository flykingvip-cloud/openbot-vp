import type { WorkbenchKnowledgeSurface } from "../ports/employee/views/home-page-contracts.ts";
import { navigateKnowledgeUniverseAnchor } from "./knowledge-universe-anchor-nav.ts";
import { KNOWLEDGE_UNIVERSE_ANCHORS } from "./knowledge-universe-anchors.ts";
import { openSpaceImportEntry } from "./knowledge-universe-space-import.ts";

/** Open unified space import from workspace home (U4/U5). */
export function openKnowledgeUniversePersonalIngest(surface: WorkbenchKnowledgeSurface) {
  openSpaceImportEntry(surface);
}

export function focusKnowledgeUniverseDeliverables(surface: WorkbenchKnowledgeSurface) {
  navigateKnowledgeUniverseAnchor(KNOWLEDGE_UNIVERSE_ANCHORS.deliverables, { block: "start" });
  surface.onWorkspaceDeliverablesExpandedChange(true);
}

/**
 * Open the governance center page. Empty-index guidance stays on the governance page
 * and the home card ingest CTA — do not hijack the header link into space import.
 */
export function enterKnowledgeUniverseGovernance(
  _surface: WorkbenchKnowledgeSurface,
  onOpenGovernancePage: () => void,
) {
  onOpenGovernancePage();
}
