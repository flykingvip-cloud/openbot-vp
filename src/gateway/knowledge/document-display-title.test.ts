import { describe, expect, it } from "vitest";
import {
  firstHumanDocumentTitle,
  isSkillAssetDocumentId,
  isKnowledgeCabinInternalLabel,
  isSkillCatalogSourceRef,
  knowledgeDocumentIdFromSkillRef,
  looksLikeInternalDocumentId,
  sourceDisplayName,
} from "./document-display-title.js";

describe("document display title", () => {
  it("treats lfdoc and Ifdoc storage keys as internal", () => {
    expect(looksLikeInternalDocumentId("lfdoc-6ad9fbcbc7b63784231845b09b92")).toBe(true);
    expect(looksLikeInternalDocumentId("Ifdoc_4e33d4d520d6b50a5e2af1035276")).toBe(true);
    expect(looksLikeInternalDocumentId("skill_9b2c46eaedd4")).toBe(true);
    expect(looksLikeInternalDocumentId("中阿数字贸易平台可行性研究")).toBe(false);
    expect(looksLikeInternalDocumentId("Documentation Guide")).toBe(false);
    expect(looksLikeInternalDocumentId("doc-sales")).toBe(true);
    expect(looksLikeInternalDocumentId("kbdoc-0123456789abcdef01234567")).toBe(true);
    expect(looksLikeInternalDocumentId("5d56ea0c-e52f-40ba-a200-babb4f2ebe54")).toBe(true);
    expect(looksLikeInternalDocumentId("skill:skill_9b2c46eaedd4")).toBe(true);
    expect(isKnowledgeCabinInternalLabel("6556ac52-a3d7-2408-55a3-73abcdef1234")).toBe(true);
    expect(isKnowledgeCabinInternalLabel("6556ac52-a3d7-2408-55a3-73abcdef1234.md")).toBe(true);
    expect(isKnowledgeCabinInternalLabel("如何让数字人真正活着")).toBe(false);
  });

  it("treats skill catalog refs as cabin-tree leaks", () => {
    expect(isSkillCatalogSourceRef("skill_9b2c46eaedd4")).toBe(true);
    expect(isSkillCatalogSourceRef("skill:skill_9b2c46eaedd4")).toBe(true);
    expect(isSkillCatalogSourceRef("agent:dlv:skill:skill_9b2c46eaedd4")).toBe(true);
    expect(isSkillCatalogSourceRef("如何让数字人真正活着")).toBe(false);
  });

  it("does not treat skill assets as knowledge-base document ids", () => {
    expect(isSkillAssetDocumentId("skill_9b2c46eaedd4")).toBe(true);
    expect(isSkillAssetDocumentId("obj:personal:skill_9b2c46eaedd4")).toBe(true);
    expect(isSkillAssetDocumentId("kbdoc-0123456789abcdef01234567")).toBe(false);
    expect(isSkillAssetDocumentId("lfdoc-6ad9fbcbc7b63784231845b09b92")).toBe(false);
    expect(knowledgeDocumentIdFromSkillRef("kb_a", "skill_9b2c46eaedd4")).toMatch(
      /^kbdoc-[0-9a-f]{24}$/,
    );
  });

  it("prefers the local-folder filename over the lfdoc id", () => {
    expect(
      firstHumanDocumentTitle(
        "lfdoc-6ad9fbcbc7b63784231845b09b92",
        "中阿数字贸易平台可行性研究.pdf",
      ),
    ).toBe("中阿数字贸易平台可行性研究");
  });

  it("strips a single path segment and extension", () => {
    expect(sourceDisplayName("UPBEYOND/如何让“数字人”真正活着.pdf")).toBe("如何让“数字人”真正活着");
  });
});
