import { describe, expect, it } from "vitest";
import type { KnowledgeBaseSummary } from "../capability/knowledge-universe/workspace-endpoints.ts";
import {
  canCreateKnowledgeFolderInSection,
  canManageKnowledgeTreeFolder,
  findReservedDeliverableKnowledgeBase,
  isReservedDeliverableKnowledgeBase,
  knowledgeBaseAllowsWrite,
  withReservedDeliverableFoldersFirst,
} from "./knowledge-universe-reserved-folders.ts";

function kb(
  id: string,
  title: string,
  extras: Partial<KnowledgeBaseSummary> = {},
): KnowledgeBaseSummary {
  return {
    id,
    title,
    description: "",
    documentCount: 0,
    visibility: "private",
    updatedAtMs: 1,
    ...extras,
  };
}

describe("knowledge-universe-reserved-folders", () => {
  it("recognizes reserved folders by kind, tag, or title", () => {
    expect(
      isReservedDeliverableKnowledgeBase(
        kb("a", "个人成果", { reservedKind: "personal_deliverables" }),
      ),
    ).toBe(true);
    expect(
      isReservedDeliverableKnowledgeBase(kb("b", "其他", { tags: ["openbot:team-deliverables"] })),
    ).toBe(true);
    expect(isReservedDeliverableKnowledgeBase(kb("c", "个人资料"))).toBe(false);
  });

  it("sorts reserved folders to the front of a section", () => {
    const ordered = withReservedDeliverableFoldersFirst([
      kb("notes", "个人资料"),
      kb("out", "个人成果", { reservedKind: "personal_deliverables" }),
    ]);
    expect(ordered.map((item) => item.id)).toEqual(["out", "notes"]);
    expect(findReservedDeliverableKnowledgeBase(ordered, "personal_deliverables")?.id).toBe("out");
  });

  it("treats enterprise spaces as read-only unless gateway granted write", () => {
    expect(knowledgeBaseAllowsWrite(kb("ent", "制度", { visibility: "enterprise" }))).toBe(false);
    expect(
      knowledgeBaseAllowsWrite(kb("ent-w", "制度", { visibility: "enterprise", canWrite: true })),
    ).toBe(true);
    expect(knowledgeBaseAllowsWrite(kb("notes", "个人资料"))).toBe(true);
  });

  it("hides enterprise + unless an existing enterprise space is writable", () => {
    expect(canCreateKnowledgeFolderInSection([], "private")).toBe(true);
    expect(canCreateKnowledgeFolderInSection([], "team")).toBe(true);
    expect(canCreateKnowledgeFolderInSection([], "enterprise")).toBe(false);
    expect(
      canCreateKnowledgeFolderInSection(
        [kb("ent", "制度", { visibility: "enterprise", canWrite: false })],
        "enterprise",
      ),
    ).toBe(false);
    expect(
      canCreateKnowledgeFolderInSection(
        [kb("ent", "制度", { visibility: "enterprise", canWrite: true })],
        "enterprise",
      ),
    ).toBe(true);
  });

  it("blocks rename/delete on reserved folders and read-only enterprise spaces", () => {
    expect(
      canManageKnowledgeTreeFolder(
        kb("out", "个人成果", { reservedKind: "personal_deliverables" }),
      ),
    ).toBe(false);
    expect(canManageKnowledgeTreeFolder(kb("ent", "制度", { visibility: "enterprise" }))).toBe(
      false,
    );
    expect(
      canManageKnowledgeTreeFolder(
        kb("ent-admin", "制度", { visibility: "enterprise", canAdmin: true }),
      ),
    ).toBe(true);
    expect(canManageKnowledgeTreeFolder(kb("notes", "个人资料"))).toBe(true);
  });
});
