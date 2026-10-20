import type {
  KnowledgeUniversePersonalDrawerMode,
  WorkbenchKnowledgeSurface,
} from "../ports/employee/views/home-page-contracts.ts";
import { openKnowledgeSpaceCreatePage } from "./knowledge-universe-create-entry.ts";
import { openSpaceImportEntry } from "./knowledge-universe-space-import.ts";

export function hasSelectedKnowledgeSpace(surface: WorkbenchKnowledgeSurface): boolean {
  return Boolean(surface.selectedKnowledgeBaseId);
}

export function openLibraryCreateForIngest(surface: WorkbenchKnowledgeSurface) {
  openKnowledgeSpaceCreatePage(surface);
}

/**
 * Legacy personal-drawer entry → unified space import.
 * No selected space ⇒ create page only (never silent personal-inbox fallback).
 */
export function openPersonalIngestFlow(
  surface: WorkbenchKnowledgeSurface,
  _mode: KnowledgeUniversePersonalDrawerMode,
) {
  if (!hasSelectedKnowledgeSpace(surface)) {
    openLibraryCreateForIngest(surface);
    return;
  }
  openSpaceImportEntry(surface, { lockSpace: true });
}
