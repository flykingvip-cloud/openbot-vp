import type { KnowledgeBaseVisibility } from "../capability/knowledge-universe/workspace-endpoints.ts";
import type { WorkbenchKnowledgeSurface } from "../ports/employee/views/home-page-contracts.ts";

export const KNOWLEDGE_SPACE_CREATE_PAGE_TAB = "libraryCreate" as const;

export type KnowledgeSpaceCreateNavigationSurface = Pick<
  WorkbenchKnowledgeSurface,
  "onPageTabChange"
>;

export type KnowledgeSpaceCreateWithVisibilitySurface = Pick<
  WorkbenchKnowledgeSurface,
  "onPageTabChange" | "onNewKnowledgeBaseVisibilityChange"
>;

/** Single formal entry for creating a knowledge space (Runtime Scope selector page). */
export function openKnowledgeSpaceCreatePage(surface: KnowledgeSpaceCreateNavigationSurface): void {
  surface.onPageTabChange(KNOWLEDGE_SPACE_CREATE_PAGE_TAB);
}

export function openKnowledgeSpaceCreateWithVisibility(
  surface: KnowledgeSpaceCreateWithVisibilitySurface,
  visibility: KnowledgeBaseVisibility,
): void {
  surface.onNewKnowledgeBaseVisibilityChange(visibility);
  openKnowledgeSpaceCreatePage(surface);
}
