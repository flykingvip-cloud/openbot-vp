// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import {
  applyKnowledgeUniverseUiPrefs,
  normalizeKnowledgeUniverseBrowseSubTab,
  normalizeKnowledgeUniversePageTab,
  readKnowledgeUniverseUiPrefs,
  writeKnowledgeUniverseUiPrefs,
} from "./knowledge-universe-ui-prefs.ts";

describe("knowledge-universe-ui-prefs", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("persists page tab and browse sub tab", () => {
    writeKnowledgeUniverseUiPrefs({ pageTab: "supply", browseSubTab: "enterprise" });
    expect(readKnowledgeUniverseUiPrefs()).toMatchObject({
      pageTab: "supply",
      browseSubTab: "enterprise",
      pinnedKnowledgeBaseIds: [],
      favoriteKnowledgeBaseIds: [],
      libraryWorkspaceContentTab: "documents",
    });
  });

  it("migrates legacy browse and more tabs", () => {
    expect(normalizeKnowledgeUniversePageTab("browse")).toBe("supply");
    expect(normalizeKnowledgeUniversePageTab("more")).toBe("governance");
  });

  it("migrates the retired library workspace tab to home", () => {
    expect(normalizeKnowledgeUniversePageTab("libraryWorkspace")).toBe("workbench");
    expect(normalizeKnowledgeUniversePageTab("spaceImport")).toBe("workbench");
    expect(normalizeKnowledgeUniversePageTab("deliverables")).toBe("workbench");
    expect(normalizeKnowledgeUniversePageTab("deliverableDetail")).toBe("workbench");
  });

  it("normalizes legacy personal browse facet to private", () => {
    expect(normalizeKnowledgeUniverseBrowseSubTab("personal")).toBe("private");
    writeKnowledgeUniverseUiPrefs({ pageTab: "supply", browseSubTab: "personal" });
    expect(readKnowledgeUniverseUiPrefs().browseSubTab).toBe("private");
  });

  it("preserves the standalone relations panorama tab", () => {
    expect(normalizeKnowledgeUniversePageTab("relations")).toBe("relations");
  });

  it("persists selected knowledge base id", () => {
    writeKnowledgeUniverseUiPrefs({ selectedKnowledgeBaseId: "kb-sales" });
    expect(readKnowledgeUniverseUiPrefs()).toMatchObject({
      selectedKnowledgeBaseId: "kb-sales",
      pinnedKnowledgeBaseIds: [],
      favoriteKnowledgeBaseIds: [],
      libraryWorkspaceContentTab: "documents",
    });
  });

  it("ignores invalid stored values", () => {
    localStorage.setItem(
      "openbot.knowledge-universe.ui.v1",
      JSON.stringify({ pageTab: "invalid", browseSubTab: "bad" }),
    );
    expect(readKnowledgeUniverseUiPrefs()).toMatchObject({
      pinnedKnowledgeBaseIds: [],
      favoriteKnowledgeBaseIds: [],
      libraryWorkspaceContentTab: "documents",
    });
  });

  it("applies stored prefs to app state with legacy migration", () => {
    writeKnowledgeUniverseUiPrefs({ pageTab: "more", browseSubTab: "capabilities" });
    const state = {
      knowledgeUniversePageTab: "workbench" as const,
      knowledgeUniverseBrowseSubTab: "private" as const,
    };
    applyKnowledgeUniverseUiPrefs(state);
    expect(state.knowledgeUniversePageTab).toBe("governance");
    expect(state.knowledgeUniverseBrowseSubTab).toBe("capabilities");
  });
});
