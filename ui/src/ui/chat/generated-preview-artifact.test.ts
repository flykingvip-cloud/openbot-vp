import { describe, expect, it } from "vitest";
import {
  isDeliverableResultArtifact,
  resolvePreviewArtifactRecord,
  resolvePreviewArtifactRecords,
  sanitizeArtifactPreviewText,
} from "./generated-preview-artifact.ts";

describe("sanitizeArtifactPreviewText", () => {
  it("strips nickname status narration before bold section headers", () => {
    const body = [
      "## 中医诊断学知识导图",
      "",
      "**📦 八大分支** (可点击展开) ：",
      "",
      "1. 👁️ **望诊** — 望神/望色/望舌/望形态",
      "2. 👂 **闻诊** — 听声音/嗅气味",
      "3. 💬 **问诊** — 十问体系 (寒热/汗/疼痛/二便/经带)".repeat(3),
    ].join("\n");
    const raw = [
      "老大，知识导图已经生成好了！",
      "",
      "🎉 这是一个可交互的 HTML 页面，内容包含：",
      "",
      body,
    ].join("\n");

    expect(sanitizeArtifactPreviewText(raw)).toBe(body);
    expect(sanitizeArtifactPreviewText(raw)).not.toContain("老大");
    expect(sanitizeArtifactPreviewText(raw)).not.toContain("HTML 页面");
  });

  it("keeps formal report openings that start with a markdown title", () => {
    const body = ["# 中医诊断学知识导图", "", "1. 阴阳五行", "2. 四诊合参".repeat(3)].join("\n");
    const raw = ["好的，报告如下：", "", body].join("\n");
    expect(sanitizeArtifactPreviewText(raw)).toBe(body);
  });

  it("strips trailing file-location hints after the body", () => {
    const body = ["## 学习简报", "", "1. 先掌握望诊要点。".repeat(4)].join("\n");
    const raw = [
      body,
      "",
      "文件位置：`~/workspace/report.html`",
      "您可以直接用浏览器打开查看。",
    ].join("\n");
    expect(sanitizeArtifactPreviewText(raw)).toBe(body);
  });

  it("does not collapse a long article to an incidental 「」 quote", () => {
    const article = [
      "# 做模型还是做产品？一个创始人的生死选择题",
      "",
      "## 一、一个残酷的现实",
      "",
      "AI 行业正在走向寡头化，模型逐渐基础设施化，同质化加剧，价格战不可避免。".repeat(4),
      "",
      "## 二、模型即产品，但产品才是王者",
      "",
      "有人问我：「你和 OpenAI / Anthropic 有什么本质区别？」这是个好问题。",
      "",
      "**模型即产品，产品是王者。** 没有产品，模型只是裸 API，只能打价格战。".repeat(4),
    ].join("\n");
    const result = sanitizeArtifactPreviewText(article);
    expect(result).toContain("做模型还是做产品");
    expect(result).toContain("模型即产品，产品是王者");
    expect(result.length).toBeGreaterThan(200);
    expect(result).not.toBe("你和 OpenAI / Anthropic 有什么本质区别？");
  });
});

describe("resolvePreviewArtifactRecord (quoted-envelope regression)", () => {
  it("previews the full inline article, not an incidental 「」 quote", () => {
    const article = [
      "好，全文给你列出来：",
      "",
      "# 做模型还是做产品？一个创始人的生死选择题",
      "",
      "## 一、一个残酷的现实",
      "",
      "AI 行业正在走向寡头化，模型逐渐基础设施化，同质化加剧，价格战不可避免。".repeat(4),
      "",
      "## 二、模型即产品，但产品才是王者",
      "",
      "有人问我：「你和 OpenAI / Anthropic 有什么本质区别？」这是个好问题。",
      "",
      "**模型即产品，产品是王者。** 没有产品，模型只是裸 API，只能打价格战。".repeat(4),
      "",
      "## 三、结语",
      "",
      "谁先完成变形，谁就能在寡头时代占据一席之地。".repeat(3),
      "",
      "老大，全文如上。几点请你确认：需要调整语气吗？署名用哪个品牌？",
    ].join("\n");
    const artifact = resolvePreviewArtifactRecord({
      role: "assistant",
      timestamp: "2026-07-08T00:00:00.000Z",
      content: [{ type: "text", text: article }],
    }) as { sourceMessage?: string } | null;
    const sourceMessage = String(artifact?.sourceMessage ?? "");
    expect(sourceMessage).toContain("做模型还是做产品");
    expect(sourceMessage).toContain("模型即产品，产品是王者");
    expect(sourceMessage.length).toBeGreaterThan(200);
    // The bug collapsed the whole article to this single quoted sentence.
    expect(sourceMessage).not.toBe("你和 OpenAI / Anthropic 有什么本质区别？");
  });
});

describe("resolvePreviewArtifactRecord (declared location)", () => {
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
    }) as { providerMetadata?: Record<string, unknown>; title?: string } | null;
    const meta = artifact?.providerMetadata ?? {};
    expect(artifact?.title).toBe("Alice简历");
    expect(meta.workspaceFilename).toBe("Alice_爱丽_瑜伽老师简历.docx");
    expect(meta.previewKind).toBe("file");
    expect(meta.declared).toBe(true);
    expect(meta.deliverableEnvelope).toBe(true);
    expect(isDeliverableResultArtifact(artifact)).toBe(true);
    expect(meta.deliverableTarget).toEqual({
      kind: "file",
      workspaceFilename: "Alice_爱丽_瑜伽老师简历.docx",
      mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      title: "Alice简历",
    });
  });

  it("uses the declared file extension for mime, never the display title", () => {
    const text = [
      "预览已生成。",
      '<<DELIVERABLE title="PDF" file="OpenBot_高质量投资介绍.html">>',
      "网页版投资介绍。",
      "<</DELIVERABLE>>",
    ].join("\n");
    const artifact = resolvePreviewArtifactRecord({
      role: "assistant",
      timestamp: "2026-08-17T00:00:00.000Z",
      content: [{ type: "text", text }],
    }) as { mimeType?: string; title?: string; providerMetadata?: Record<string, unknown> } | null;
    const target = artifact?.providerMetadata?.deliverableTarget as
      | Record<string, unknown>
      | undefined;
    expect(artifact?.title).toBe("PDF");
    expect(artifact?.mimeType).toBe("text/html");
    expect(artifact?.providerMetadata?.workspaceFilename).toBe("OpenBot_高质量投资介绍.html");
    expect(target?.mimeType).toBe("text/html");
    expect(target?.workspaceFilename).toBe("OpenBot_高质量投资介绍.html");
  });

  it("marks an unwritten file declaration so the chip is not previewable", () => {
    const text = [
      '<<DELIVERABLE title="底稿" file="analysis/model-framework-v0.md" unwritten="1">>',
      "正文还在聊天里，磁盘上没有这个文件。",
      "<</DELIVERABLE>>",
    ].join("\n");
    const artifact = resolvePreviewArtifactRecord({
      role: "assistant",
      timestamp: "2026-10-17T00:00:00.000Z",
      content: [{ type: "text", text }],
    });
    const meta = artifact?.providerMetadata as
      | { workspaceUnwritten?: boolean; previewUnavailable?: boolean; workspaceFilename?: string }
      | undefined;
    expect(meta?.workspaceUnwritten).toBe(true);
    expect(meta?.previewUnavailable).toBe(true);
    expect(meta?.workspaceFilename).toBe("analysis/model-framework-v0.md");
  });

  it("does not leave a retryable or conflicting declaration looking previewable", () => {
    const retryable = resolvePreviewArtifactRecord({
      role: "assistant",
      timestamp: "2026-10-17T00:00:00.000Z",
      content: [
        {
          type: "text",
          text: '<<DELIVERABLE title="底稿" file="analysis/model.md" settle="retryable">>\n正文\n<</DELIVERABLE>>',
        },
      ],
    }) as { providerMetadata?: Record<string, unknown> } | null;
    expect(retryable?.providerMetadata?.previewUnavailable).toBe(true);
    expect(retryable?.providerMetadata?.deliveryUndelivered).toBe(true);
    const conflict = resolvePreviewArtifactRecord({
      role: "assistant",
      timestamp: "2026-10-17T00:00:00.000Z",
      content: [
        {
          type: "text",
          text: '<<DELIVERABLE title="底稿" file="analysis/model.md" settle="conflict">>\n正文\n<</DELIVERABLE>>',
        },
      ],
    }) as { providerMetadata?: Record<string, unknown> } | null;
    expect(conflict?.providerMetadata?.previewUnavailable).toBe(true);
    expect(conflict?.providerMetadata?.settleConflict).toBe(true);
  });

  it("exposes one artifact record per located envelope", () => {
    const text = [
      "两份成果都在工作区。",
      '<<DELIVERABLE title="投资介绍 PDF" file="OpenBot_高质量投资介绍.pdf">>',
      "PDF 版。",
      "<</DELIVERABLE>>",
      '<<DELIVERABLE title="投资介绍网页" file="OpenBot_高质量投资介绍.html">>',
      "HTML 版。",
      "<</DELIVERABLE>>",
    ].join("\n");
    const artifacts = resolvePreviewArtifactRecords({
      role: "assistant",
      timestamp: "2026-08-17T00:00:00.000Z",
      content: [{ type: "text", text }],
    });
    expect(artifacts).toHaveLength(2);
    expect(artifacts[0]?.artifactId).not.toBe(artifacts[1]?.artifactId);
    expect(artifacts.map((entry) => entry.providerMetadata)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ workspaceFilename: "OpenBot_高质量投资介绍.pdf" }),
        expect.objectContaining({ workspaceFilename: "OpenBot_高质量投资介绍.html" }),
      ]),
    );
    expect(artifacts[0]?.mimeType).toBe("application/pdf");
    expect(artifacts[1]?.mimeType).toBe("text/html");
  });

  it("carries a declared image relative path as a first-class file artifact", () => {
    const text = [
      "图片已生成。",
      '<<DELIVERABLE title="未来城市日落" type="image" file=".openbot/generated-images/未来城市日落.png">>',
      "夕阳下的未来城市天际线。",
      "<</DELIVERABLE>>",
    ].join("\n");
    const artifact = resolvePreviewArtifactRecord({
      role: "assistant",
      timestamp: "2026-08-12T00:00:00.000Z",
      content: [{ type: "text", text }],
    }) as {
      artifactType?: string;
      mimeType?: string;
      title?: string;
      providerMetadata?: Record<string, unknown>;
    } | null;
    const meta = artifact?.providerMetadata ?? {};
    expect(artifact?.title).toBe("未来城市日落");
    expect(artifact?.artifactType).toBe("image");
    expect(artifact?.mimeType).toBe("image/png");
    expect(meta.workspaceFilename).toBe(".openbot/generated-images/未来城市日落.png");
    expect(meta.previewKind).toBe("file");
    expect(meta.declaredType).toBe("image");
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
    }) as { openUrl?: string; providerMetadata?: Record<string, unknown> } | null;
    expect(artifact?.openUrl).toBe("https://mp.weixin.qq.com/s/abc");
    expect(artifact?.providerMetadata?.previewKind).toBe("published");
    expect(artifact?.providerMetadata?.declared).toBe(true);
  });

  it("keeps a nested absolute pptxPath instead of the basename", () => {
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
    }) as { providerMetadata?: Record<string, unknown> } | null;
    expect(artifact?.providerMetadata?.workspaceFilename).toBe(nested);
    expect(artifact?.providerMetadata?.workspaceFilename).not.toBe("deck.pptx");
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
    }) as { title?: string; providerMetadata?: Record<string, unknown> } | null;
    expect(artifact?.providerMetadata?.workspaceFilename).toBe(
      "articles/know-how-to-be-what-pub.html",
    );
    expect(artifact?.title).toBe("know-how-to-be-what-pub.html");
    expect(artifact?.providerMetadata?.previewKind).toBe("file");
  });

  it("keeps a backtick-quoted spaced Chinese publication name", () => {
    const artifact = resolvePreviewArtifactRecord({
      role: "assistant",
      timestamp: "2026-09-14T00:00:00.000Z",
      content: [
        {
          type: "text",
          text: "已生成 `从 Know How 到 Be What（V7 · 出版版）.pdf`，在工作区根目录。",
        },
      ],
    }) as { providerMetadata?: Record<string, unknown> } | null;
    expect(artifact?.providerMetadata?.workspaceFilename).toBe(
      "从 Know How 到 Be What（V7 · 出版版）.pdf",
    );
  });

  it("does not collapse an unquoted spaced Chinese name to the suffix after the last space", () => {
    const artifact = resolvePreviewArtifactRecord({
      role: "assistant",
      timestamp: "2026-09-14T00:00:00.000Z",
      content: [
        {
          type: "text",
          text: "已生成 从 Know How 到 Be What（V7 · 出版版）.pdf，可在工作区打开。",
        },
      ],
    }) as { providerMetadata?: Record<string, unknown> } | null;
    expect(artifact?.providerMetadata?.workspaceFilename).toBe(
      "从 Know How 到 Be What（V7 · 出版版）.pdf",
    );
  });

  it("carries a prose-announced openbot.love html page as openUrl", () => {
    const text = [
      "版面预览已发布：",
      "https://www.openbot.love/128-layout-preview.html",
      "可用浏览器打开查看。",
    ].join("\n");
    const artifact = resolvePreviewArtifactRecord({
      role: "assistant",
      timestamp: "2026-07-08T00:00:00.000Z",
      content: [{ type: "text", text }],
    }) as { openUrl?: string; title?: string; providerMetadata?: Record<string, unknown> } | null;
    expect(artifact?.openUrl).toBe("https://www.openbot.love/128-layout-preview.html");
    expect(artifact?.title).toBe("128-layout-preview.html");
    expect(artifact?.providerMetadata?.previewKind).toBe("published");
    expect(isDeliverableResultArtifact(artifact)).toBe(false);
  });

  it("does not classify prose-announced files as 打开成果 targets", () => {
    const artifact = resolvePreviewArtifactRecord({
      role: "assistant",
      timestamp: "2026-09-14T00:00:00.000Z",
      content: [
        {
          type: "text",
          text: "已生成 articles/know-how-to-be-what-pub.html，可在右侧打开。",
        },
      ],
    }) as { providerMetadata?: Record<string, unknown> } | null;
    expect(artifact?.providerMetadata?.inferredFile).toBe(true);
    expect(isDeliverableResultArtifact(artifact)).toBe(false);
  });

  it("does not classify a planning mention of SKILL.md as 打开成果", () => {
    const artifact = resolvePreviewArtifactRecord({
      role: "assistant",
      timestamp: "2026-09-17T00:00:00.000Z",
      content: [
        {
          type: "text",
          text: [
            "我可以把选题、撰写、排版、配图这条链固化成一份 SKILL.md。",
            "这是能力授权给数字人的载体，还没有写到工作区。",
          ].join("\n"),
        },
      ],
    });
    expect(isDeliverableResultArtifact(artifact)).toBe(false);
  });
});
