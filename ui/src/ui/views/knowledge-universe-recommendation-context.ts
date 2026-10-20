import type { WorkbenchKnowledgeSurface } from "../ports/employee/views/home-page-contracts.ts";

/** Related-knowledge UI only appears when the user has search or selection context. */
export function hasKnowledgeRecommendationContext(
  surface: Pick<
    WorkbenchKnowledgeSurface,
    "selectedNodeId" | "selectedObject" | "query" | "kbSearchQuery" | "selectedKnowledgeBaseId"
  >,
): boolean {
  if (surface.selectedNodeId || surface.selectedObject) {
    return true;
  }
  if (surface.query.trim()) {
    return true;
  }
  if (surface.selectedKnowledgeBaseId && surface.kbSearchQuery?.trim()) {
    return true;
  }
  return false;
}
