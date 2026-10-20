// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { resolvePreviewArtifactRecord } from "../chat/generated-preview-artifact.ts";
import type { ArtifactWorkspaceSidebar } from "../types.ts";
import {
  declaredWorkspaceRelPath,
  resolveStewardWorkspaceFilename,
} from "../wiring/steward-workspace-file.ts";
import {
  decodeStewardFileText,
  downloadStewardWorkspaceFile,
  readStewardWorkspaceFile,
} from "./steward-workspace-file.ts";

describe("steward workspace file controller", () => {
  it("decodes base64 payloads as UTF-8 text", () => {
    const base64 = Buffer.from("# 标题\n正文内容", "utf-8").toString("base64");
    expect(decodeStewardFileText(base64)).toBe("# 标题\n正文内容");
  });

  it("returns null without a client or filename and never calls the RPC", async () => {
    expect(await readStewardWorkspaceFile(null, "x.docx")).toBeNull();
    const client = { request: vi.fn() };
    expect(await readStewardWorkspaceFile(client as never, "   ")).toBeNull();
    expect(client.request).not.toHaveBeenCalled();
  });

  it("requests the trimmed filename and returns the payload", async () => {
    const payload = {
      filename: "notes.md",
      mimeType: "text/markdown",
      byteLength: 3,
      textLike: true,
      base64: "YWJj",
    };
    const client = { request: vi.fn(async () => payload) };
    const res = await readStewardWorkspaceFile(client as never, "  notes.md  ");
    expect(client.request).toHaveBeenCalledWith("workbench.steward-file.read", {
      filename: "notes.md",
    });
    expect(res).toEqual(payload);
  });

  it("returns null for a zero-byte payload so preview stays a miss", async () => {
    const client = {
      request: vi.fn(async () => ({
        filename: "article-final.md",
        mimeType: "text/markdown",
        byteLength: 0,
        textLike: true,
        base64: "",
      })),
    };
    expect(await readStewardWorkspaceFile(client as never, "article-final.md")).toBeNull();
  });

  it("returns null when the RPC rejects", async () => {
    const client = {
      request: vi.fn(async () => {
        throw new Error("nope");
      }),
    };
    expect(await readStewardWorkspaceFile(client as never, "notes.md")).toBeNull();
  });

  it("safely no-ops download when there is no DOM", () => {
    expect(() =>
      downloadStewardWorkspaceFile({
        filename: "resume.docx",
        mimeType: "application/octet-stream",
        byteLength: 1,
        textLike: false,
        base64: "AQ==",
      }),
    ).not.toThrow();
  });
});

describe("resolvePreviewArtifactRecord workspace filename", () => {
  it("attaches the generated workspace filename for a steward file summary", () => {
    const artifact = resolvePreviewArtifactRecord({
      role: "assistant",
      timestamp: "2026-07-07T00:00:00.000Z",
      content: [
        {
          type: "text",
          text: [
            "# 瑜伽老师简历优化说明",
            "",
            "已经生成好了！优化后的 Word 文档已在工作区。",
            "",
            "文件：Alice_爱丽_瑜伽老师简历.docx",
            "",
            "## 主要优化点",
            "",
            "头部设计：左侧姓名与头衔，右侧嵌入照片，专业清晰。",
            "",
            "结构重组为五大板块，条理清晰，可读性大幅提升。",
            "",
            "视觉风格：深蓝主色，干净排版，统一字体。",
          ].join("\n"),
        },
      ],
    });
    const providerMetadata = (artifact?.providerMetadata ?? {}) as Record<string, unknown>;
    expect(providerMetadata.workspaceFilename).toBe("Alice_爱丽_瑜伽老师简历.docx");
  });

  it("does not attach a workspace filename when no file is referenced", () => {
    const artifact = resolvePreviewArtifactRecord({
      role: "assistant",
      timestamp: "2026-07-07T00:00:00.000Z",
      content: [
        {
          type: "text",
          text: [
            "# 项目周报",
            "",
            "本周完成了需求梳理与设计评审，下周进入开发阶段。",
            "",
            "## 风险",
            "",
            "排期偏紧，需要提前对齐资源。",
          ].join("\n"),
        },
      ],
    });
    const providerMetadata = (artifact?.providerMetadata ?? {}) as Record<string, unknown>;
    expect(providerMetadata.workspaceFilename).toBeUndefined();
  });
});

describe("resolveStewardWorkspaceFilename", () => {
  it("keeps nested relative paths and does not basename an absolute path", () => {
    expect(declaredWorkspaceRelPath("campaigns/october/article.html")).toBe(
      "campaigns/october/article.html",
    );
    expect(declaredWorkspaceRelPath("output/pptx/客户演示版.pptx")).toBe(
      "output/pptx/客户演示版.pptx",
    );
    expect(declaredWorkspaceRelPath("/tmp/客户演示版.pptx")).toBeNull();
    expect(
      declaredWorkspaceRelPath("/data/ws/campaigns/october/article.html", {
        trustedRoots: ["/data/ws"],
      }),
    ).toBe("campaigns/october/article.html");
    expect(declaredWorkspaceRelPath("campaigns/october/../../secret.html")).toBeNull();
  });

  it("sends an unmappable absolute path to the gateway instead of a title basename", () => {
    const workspace = {
      artifact: {
        title: "通州方案_客户演示版.pptx",
        providerMetadata: {
          pptxPath: "/tmp/通州方案_客户演示版.pptx",
        },
      },
    } as unknown as ArtifactWorkspaceSidebar;
    expect(resolveStewardWorkspaceFilename(workspace)).toBe("/tmp/通州方案_客户演示版.pptx");
  });

  it("prefers a nested declaration over a truncated basename", () => {
    const workspace = {
      artifact: {
        title: "article.html",
        providerMetadata: {
          workspaceFilename: "article.html",
          filePath: "campaigns/october/article.html",
        },
      },
    } as unknown as ArtifactWorkspaceSidebar;
    expect(resolveStewardWorkspaceFilename(workspace)).toBe("campaigns/october/article.html");
  });

  it("does not fall through to the title when a declared path is rejected", () => {
    const workspace = {
      artifact: {
        title: "secret.html",
        providerMetadata: {
          filePath: "campaigns/../../secret.html",
        },
      },
    } as unknown as ArtifactWorkspaceSidebar;
    expect(resolveStewardWorkspaceFilename(workspace)).toBeNull();
  });
});
