import { describe, expect, it } from "vitest";
import { resolvePreviewArtifactRecord } from "./resolve-preview-artifact.ts";

function metaOf(artifact: unknown): Record<string, unknown> {
  const record = artifact as { providerMetadata?: Record<string, unknown> } | null;
  return record?.providerMetadata ?? {};
}

describe("resolvePreviewArtifactRecord declared location (shared)", () => {
  it("carries a declared workspace file as a first-class file artifact", () => {
    const text = [
      "已经生成好了！优化后的 Word 文档已在工作区。",
      '<<DELIVERABLE title="Alice简历" type="doc" file="Alice_爱丽_瑜伽老师简历.docx">>',
      "已优化头部设计、结构重组为五大板块、深蓝主色调排版。",
      "<</DELIVERABLE>>",
    ].join("\n");
    const artifact = resolvePreviewArtifactRecord({
      role: "assistant",
      timestamp: "2026-07-08T00:00:00.000Z",
      content: [{ type: "text", text }],
    }) as { title?: string } | null;
    const meta = metaOf(artifact);
    expect(artifact?.title).toBe("Alice简历");
    expect(meta.workspaceFilename).toBe("Alice_爱丽_瑜伽老师简历.docx");
    expect(meta.previewKind).toBe("file");
    expect(meta.declared).toBe(true);
  });

  it("carries a declared published url as an openUrl", () => {
    const text = [
      "文章已发到公众号草稿箱。",
      '<<DELIVERABLE title="公众号文章" type="article" url="https://mp.weixin.qq.com/s/abc">>',
      "# 做模型还是做产品\n\n完整正文……".repeat(3),
      "<</DELIVERABLE>>",
    ].join("\n");
    const artifact = resolvePreviewArtifactRecord({
      role: "assistant",
      timestamp: "2026-07-08T00:00:00.000Z",
      content: [{ type: "text", text }],
    }) as { openUrl?: string } | null;
    expect(artifact?.openUrl).toBe("https://mp.weixin.qq.com/s/abc");
    expect(metaOf(artifact).previewKind).toBe("published");
  });

  it("still carries a prose-announced file (no envelope) as an inferred low-tier file signal", () => {
    const text = [
      "已经生成好了！优化后的 Word 文档已在工作区。",
      "",
      "# 优化后的简历要点",
      "",
      "文件：Alice_爱丽_瑜伽老师简历.docx",
      "",
      "主要优化点：",
      "1. 头部设计：左侧姓名+头衔，右侧嵌入照片（1.8寸）。",
      "2. 结构重组为五大板块，逻辑清晰、层次分明、可读性大增。",
      "3. 视觉风格：深蓝主色调，干净排版，统一字体，整体专业。",
    ].join("\n");
    const artifact = resolvePreviewArtifactRecord({
      role: "assistant",
      timestamp: "2026-07-08T00:00:00.000Z",
      content: [{ type: "text", text }],
    });
    const meta = metaOf(artifact);
    expect(meta.workspaceFilename).toBe("Alice_爱丽_瑜伽老师简历.docx");
    expect(meta.previewKind).toBe("file");
    expect(meta.inferredFile).toBe(true);
    // Not a declaration: must stay in the inferred (low deposit) tier.
    expect(meta.declared).toBeUndefined();
    expect(meta.depositTier).toBe("low");
  });

  it("keeps a nested pptxPath instead of storing only the basename", () => {
    const nested =
      "/state/tenants/001/users/elle/OpenBot/agents/bot/workspace/campaigns/october/deck.pptx";
    const artifact = resolvePreviewArtifactRecord({
      type: "artifact",
      artifact: {
        id: "art-pptx-nested",
        artifact_type: "ppt",
        title: "十月方案",
        content: JSON.stringify({ pptxPath: nested }),
      },
    });
    const meta = metaOf(artifact);
    expect(meta.pptxPath).toBe(nested);
    expect(meta.workspaceFilename).toBe(nested);
    expect(meta.workspaceFilename).not.toBe("deck.pptx");
  });

  it("drops a traversing pptxPath instead of sanitizing it to another file", () => {
    const artifact = resolvePreviewArtifactRecord({
      type: "artifact",
      artifact: {
        id: "art-pptx-traversal",
        artifact_type: "ppt",
        title: "secret.pptx",
        content: JSON.stringify({ pptxPath: "campaigns/../../secret.pptx" }),
      },
    });
    expect(metaOf(artifact).workspaceFilename).toBeUndefined();
  });

  it("keeps an articles/ prefix from a generated-file announcement", () => {
    const artifact = resolvePreviewArtifactRecord({
      role: "assistant",
      timestamp: "2026-09-14T00:00:00.000Z",
      content: [
        {
          type: "text",
          text: "已生成 articles/know-how-to-be-what-pub.html，可在右侧打开。",
        },
      ],
    });
    expect(metaOf(artifact).workspaceFilename).toBe("articles/know-how-to-be-what-pub.html");
  });

  it("does not collapse a spaced Chinese publication name to the suffix after the last space", () => {
    const artifact = resolvePreviewArtifactRecord({
      role: "assistant",
      timestamp: "2026-09-14T00:00:00.000Z",
      content: [
        {
          type: "text",
          text: "已生成 从 Know How 到 Be What（V7 · 出版版）.pdf，可在工作区打开。",
        },
      ],
    });
    expect(metaOf(artifact).workspaceFilename).toBe("从 Know How 到 Be What（V7 · 出版版）.pdf");
  });
});
