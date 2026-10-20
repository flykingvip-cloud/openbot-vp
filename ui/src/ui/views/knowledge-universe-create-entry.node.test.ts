// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import type { WorkbenchKnowledgeSurface } from "../ports/employee/views/home-page-contracts.ts";
import {
  KNOWLEDGE_SPACE_CREATE_PAGE_TAB,
  openKnowledgeSpaceCreatePage,
  openKnowledgeSpaceCreateWithVisibility,
} from "./knowledge-universe-create-entry.ts";

function surface(): WorkbenchKnowledgeSurface {
  return {
    onPageTabChange: vi.fn(),
    onNewKnowledgeBaseVisibilityChange: vi.fn(),
  } as unknown as WorkbenchKnowledgeSurface;
}

describe("knowledge-universe-create-entry", () => {
  it("uses libraryCreate as the sole formal create page tab", () => {
    expect(KNOWLEDGE_SPACE_CREATE_PAGE_TAB).toBe("libraryCreate");
  });

  it("routes formal create through the libraryCreate page tab", () => {
    const mock = surface();
    openKnowledgeSpaceCreatePage(mock);
    expect(mock.onPageTabChange).toHaveBeenCalledWith("libraryCreate");
    expect(mock.onPageTabChange).toHaveBeenCalledTimes(1);
  });

  it("prefills visibility before opening the create page", () => {
    const mock = surface();
    openKnowledgeSpaceCreateWithVisibility(mock, "team");
    expect(mock.onNewKnowledgeBaseVisibilityChange).toHaveBeenCalledWith("team");
    expect(mock.onPageTabChange).toHaveBeenCalledWith("libraryCreate");
  });
});
