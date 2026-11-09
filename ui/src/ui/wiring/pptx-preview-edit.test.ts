import { describe, expect, it, vi } from "vitest";
import { persistWorkspacePptxSlideDraft } from "./pptx-preview-edit.ts";

describe("persistWorkspacePptxSlideDraft", () => {
  it.each([undefined, "g1"])(
    "preserves a version conflict for the UI instead of swallowing it: %s",
    async (groupId) => {
      const request = vi.fn(async () => {
        throw new Error("ARTIFACT_VERSION_CONFLICT");
      });
      await expect(
        persistWorkspacePptxSlideDraft({
          client: { request } as never,
          filename: "deck.pptx",
          draft: "# 第 1 页\n草稿",
          expectedContentHash: "old",
          groupId,
        }),
      ).rejects.toThrow(/ARTIFACT_VERSION_CONFLICT/);
    },
  );
  it("sends parsed slide text to the steward patch RPC", async () => {
    const request = vi.fn(async () => ({
      filename: "通州方案.pptx",
      relativePath: "pages/通州方案.pptx",
      mimeType: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      byteLength: 12,
      textLike: false,
      renderKind: "html",
      html: "<html></html>",
      officeSlides: [{ index: 1, lines: ["通州后勤方案"] }],
    }));
    const file = await persistWorkspacePptxSlideDraft({
      client: { request } as never,
      filename: "pages/通州方案.pptx",
      draft: "# 第 1 页\n通州后勤方案",
      sessionKey: "agent:main:s1",
      expectedContentHash: "hash-v1",
    });
    expect(request).toHaveBeenCalledWith("workbench.steward-file.patch-pptx", {
      filename: "pages/通州方案.pptx",
      slides: [{ index: 1, lines: ["通州后勤方案"] }],
      sessionKey: "agent:main:s1",
      expectedContentHash: "hash-v1",
    });
    expect(file?.officeSlides).toEqual([{ index: 1, lines: ["通州后勤方案"] }]);
  });

  it("uses the group patch RPC when a groupId is present", async () => {
    const request = vi.fn(async () => ({
      filename: "deck.pptx",
      relativePath: "deck.pptx",
      mimeType: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      byteLength: 8,
      textLike: false,
      renderKind: "html",
      html: "<html></html>",
    }));
    await persistWorkspacePptxSlideDraft({
      client: { request } as never,
      filename: "deck.pptx",
      draft: "# 第 2 页\n编制说明",
      groupId: "g1",
      expectedContentHash: "hash-v2",
    });
    expect(request).toHaveBeenCalledWith("workbench.group-file.patch-pptx", {
      groupId: "g1",
      expectedContentHash: "hash-v2",
      filename: "deck.pptx",
      slides: [{ index: 2, lines: ["编制说明"] }],
    });
  });
});
