// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  formatDeliverableArchivedLibraryLabel,
  resolveKnowledgeBaseDisplayTitle,
} from "./knowledge-universe-deliverable-display.ts";

describe("knowledge-universe-deliverable-display", () => {
  const libraries = [
    {
      id: "kb-1",
      title: "销售体系",
      description: "",
      documentCount: 1,
      visibility: "private" as const,
      updatedAtMs: 0,
    },
  ];

  it("resolves knowledge base title by id", () => {
    expect(resolveKnowledgeBaseDisplayTitle(libraries, "kb-1")).toBe("销售体系");
    expect(resolveKnowledgeBaseDisplayTitle(libraries, "kb_328e58923fd3415b")).toBeNull();
  });

  it("never surfaces internal kb ids in archive labels", () => {
    const label = formatDeliverableArchivedLibraryLabel(libraries, "kb_328e58923fd3415b");
    expect(label).not.toContain("kb_328e58923fd3415b");
    expect(label.length).toBeGreaterThan(0);
  });
});
