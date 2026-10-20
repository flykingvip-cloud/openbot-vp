// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import type { WorkbenchKnowledgeSurface } from "../ports/employee/views/home-page-contracts.ts";
import {
  hasSelectedKnowledgeSpace,
  openPersonalIngestFlow,
} from "./knowledge-universe-space-ingest.ts";

function surface(selectedKnowledgeBaseId: string | null): WorkbenchKnowledgeSurface {
  return {
    selectedKnowledgeBaseId,
    pageTab: "workbench",
    knowledgeBases: selectedKnowledgeBaseId
      ? [
          {
            id: selectedKnowledgeBaseId,
            title: "Test KB",
            description: "",
            documentCount: 0,
            visibility: "private",
            updatedAtMs: Date.now(),
          },
        ]
      : [],
    onPageTabChange: vi.fn(),
    onBrowseSubTabChange: vi.fn(),
    onPersonalCollectDrawerOpenChange: vi.fn(),
    onLibraryWorkspaceImportOpenChange: vi.fn(),
  } as unknown as WorkbenchKnowledgeSurface;
}

describe("knowledge-universe-space-ingest", () => {
  it("requires a selected knowledge space before opening ingest drawers", () => {
    expect(hasSelectedKnowledgeSpace(surface(null))).toBe(false);
    expect(hasSelectedKnowledgeSpace(surface("kb-1"))).toBe(true);
  });

  it("redirects to library create when ingest is opened without a selected space", () => {
    const mock = surface(null);
    openPersonalIngestFlow(mock, "upload");
    expect(mock.onPageTabChange).toHaveBeenCalledWith("libraryCreate");
    expect(mock.onPersonalCollectDrawerOpenChange).not.toHaveBeenCalled();
  });

  it("opens unified space import when a space is selected", () => {
    const mock = surface("kb-1");
    openPersonalIngestFlow(mock, "collect");
    expect(mock.onPageTabChange).toHaveBeenCalledWith("spaceImport");
    expect(mock.onLibraryWorkspaceImportOpenChange).toHaveBeenCalledWith(true, { lockSpace: true });
    expect(mock.onPersonalCollectDrawerOpenChange).not.toHaveBeenCalled();
  });
});
