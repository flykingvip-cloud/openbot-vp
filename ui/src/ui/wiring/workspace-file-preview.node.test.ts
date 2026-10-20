import { describe, expect, it } from "vitest";
import type { ArtifactWorkspaceSidebar } from "../types.ts";
import type { StewardArtifactSidebarHost } from "./steward-workspace-file.ts";
import {
  applyWorkspaceFilePreview,
  classifyWorkspaceFilePreview,
  isFullHtmlDocument,
  isTextLikePreviewFilename,
  resolveBrowsableHtmlPreviewUrl,
  applyPublishedHtmlUrlPreview,
  applyUnavailableFilePreview,
  clearArtifactPreviewMiss,
  isArtifactPreviewMiss,
  noteArtifactPreviewMiss,
  resolveInlinePdfPreviewUrl,
} from "./workspace-file-preview.ts";

function encodeUtf8Base64(text: string): string {
  return Buffer.from(text, "utf8").toString("base64");
}

function expectText(value: unknown): string {
  expect(typeof value).toBe("string");
  return value as string;
}

function createHost(): StewardArtifactSidebarHost {
  return {
    sidebarOpen: false,
    sidebarPreviewMode: "markdown",
    sidebarContent: null,
    sidebarError: null,
    sidebarArtifactWorkspace: null,
    artifactPreviewMissIds: [],
  };
}

function buildWorkspace(filename: string): ArtifactWorkspaceSidebar {
  return {
    artifact: {
      artifactId: "assistant-doc:html-1",
      artifactType: "doc",
      title: filename,
      provider: "assistant-message",
      storageClass: "inline-media",
      createdBy: { type: "bot", id: "main" },
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
      lifecycleState: "stored",
      mimeType: "text/html",
      providerMetadata: {
        workspaceFilename: filename,
        previewKind: "file",
      },
    },
    versions: [],
    deliveries: [],
    grants: [],
    intents: [],
  };
}

describe("classifyWorkspaceFilePreview format matrix", () => {
  it("keeps office HTML, web pages, pdf, images, text, and canvas previewable", () => {
    expect(
      classifyWorkspaceFilePreview({
        filename: "form.docx",
        mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        textLike: false,
        renderKind: "html",
        html: "<table><tr><td>姓名</td></tr></table>",
      }).lane,
    ).toBe("html");
    expect(
      classifyWorkspaceFilePreview({
        filename: "deck.pptx",
        mimeType: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
        textLike: false,
        renderKind: "html",
        html: "<div>slide</div>",
      }).lane,
    ).toBe("html");
    expect(
      classifyWorkspaceFilePreview({
        filename: "sheet.xlsx",
        mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        textLike: false,
        renderKind: "html",
        html: "<table><tr><td>1</td></tr></table>",
      }).lane,
    ).toBe("html");
    expect(
      classifyWorkspaceFilePreview({
        filename: "page.html",
        mimeType: "text/html",
        textLike: true,
        base64: encodeUtf8Base64("<html><body>ok</body></html>"),
      }).lane,
    ).toBe("html");
    expect(
      classifyWorkspaceFilePreview({
        filename: "讲座.pdf",
        mimeType: "application/pdf",
        textLike: false,
        base64: encodeUtf8Base64("%PDF-1.4"),
      }).lane,
    ).toBe("pdf");
    expect(
      classifyWorkspaceFilePreview({
        filename: "cover.png",
        mimeType: "image/png",
        textLike: false,
        base64: "AAAA",
      }).lane,
    ).toBe("image");
    expect(
      classifyWorkspaceFilePreview({
        filename: "mark.svg",
        mimeType: "image/svg+xml",
        textLike: false,
        base64: encodeUtf8Base64("<svg xmlns='http://www.w3.org/2000/svg'></svg>"),
      }).lane,
    ).toBe("image");
    expect(
      classifyWorkspaceFilePreview({
        filename: "scan.bmp",
        mimeType: "image/bmp",
        textLike: false,
        base64: "AAAA",
      }).lane,
    ).toBe("image");
    expect(
      classifyWorkspaceFilePreview({
        filename: "notes.md",
        mimeType: "text/markdown",
        textLike: true,
        base64: encodeUtf8Base64("# hi"),
      }).lane,
    ).toBe("text");
    expect(
      classifyWorkspaceFilePreview({
        filename: "rows.csv",
        mimeType: "text/csv",
        textLike: true,
        base64: encodeUtf8Base64("a,b"),
      }).lane,
    ).toBe("text");
    expect(
      classifyWorkspaceFilePreview({
        filename: "map.canvas",
        mimeType: "application/x-openbot-canvas",
        textLike: true,
        base64: encodeUtf8Base64(JSON.stringify({ nodes: [{ id: "n1", label: "节点" }] })),
      }).lane,
    ).toBe("canvas");
  });

  it("keeps legacy office and other binaries download-only", () => {
    expect(
      classifyWorkspaceFilePreview({
        filename: "old.doc",
        mimeType: "application/msword",
        textLike: false,
        base64: encodeUtf8Base64("ole"),
      }).lane,
    ).toBe("binary");
    expect(
      classifyWorkspaceFilePreview({
        filename: "old.ppt",
        mimeType: "application/vnd.ms-powerpoint",
        textLike: false,
        base64: encodeUtf8Base64("ole"),
      }).lane,
    ).toBe("binary");
    expect(
      classifyWorkspaceFilePreview({
        filename: "old.xls",
        mimeType: "application/vnd.ms-excel",
        textLike: false,
        base64: encodeUtf8Base64("ole"),
      }).lane,
    ).toBe("binary");
    expect(
      classifyWorkspaceFilePreview({
        filename: "pack.zip",
        mimeType: "application/zip",
        textLike: false,
        base64: encodeUtf8Base64("pk"),
      }).lane,
    ).toBe("binary");
  });
});

describe("isTextLikePreviewFilename", () => {
  it("treats markdown as inline-previewable", () => {
    expect(isTextLikePreviewFilename("公众号文章_思维链的窗口正在关上.md")).toBe(true);
    expect(isTextLikePreviewFilename("notes.txt", "text/plain")).toBe(true);
    expect(isTextLikePreviewFilename("deck.pptx")).toBe(false);
    expect(isTextLikePreviewFilename("page.html", "text/html")).toBe(false);
  });
});

describe("applyWorkspaceFilePreview html lane", () => {
  it("detects full HTML documents", () => {
    expect(isFullHtmlDocument("<!DOCTYPE html><html><body>hi</body></html>")).toBe(true);
    expect(isFullHtmlDocument("<div><style>.a{}</style><h1>x</h1></div>")).toBe(true);
    expect(isFullHtmlDocument("<p>Hello <strong>world</strong></p>")).toBe(false);
  });

  it("opens .html deliverables in an iframe srcdoc lane, not text/source", () => {
    const host = createHost();
    const html = `<!DOCTYPE html><html><head><style>.cover{color:red}</style></head>
<body><div class="cover"><h1>组织新未来</h1></div></body></html>`;
    const lane = applyWorkspaceFilePreview({
      host,
      workspace: buildWorkspace("report_design.html"),
      filename: "report_design.html",
      file: {
        filename: "report_design.html",
        relativePath: "report_design.html",
        mimeType: "text/html",
        textLike: true,
        base64: encodeUtf8Base64(html),
      },
    });

    expect(lane).toBe("html");
    const meta = host.sidebarArtifactWorkspace?.artifact.providerMetadata ?? {};
    expect(meta.previewKind).toBe("html");
    expect(expectText(meta.htmlSrcdoc)).toContain("组织新未来");
    expect(expectText(meta.htmlSrcdoc)).toContain('class="cover"');
    // Browser/jsdom exposes Blob/URL — prefer blob: preview URL for CSP frame-src.
    if (typeof URL !== "undefined" && typeof Blob !== "undefined") {
      expect(expectText(meta.htmlPreviewUrl)).toMatch(/^blob:/);
    }
    expect(meta.renderedHtml).toBeUndefined();
    expect(meta.previewText).toBeUndefined();
    expect(host.sidebarContent).toBeNull();
  });

  it("keeps PPTX slide text as an editable draft on the HTML preview", () => {
    const host = createHost();
    const html = `<!doctype html><html><body><h1>组织新未来</h1></body></html>`;
    const lane = applyWorkspaceFilePreview({
      host,
      workspace: buildWorkspace("通州方案.pptx"),
      filename: "通州方案.pptx",
      file: {
        filename: "通州方案.pptx",
        relativePath: "pages/通州方案.pptx",
        mimeType: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
        textLike: false,
        renderKind: "html",
        html,
        base64: encodeUtf8Base64("pptx-bytes"),
        officeSlides: [{ index: 1, lines: ["组织新未来", "数字人同事"] }],
      },
    });

    expect(lane).toBe("html");
    const meta = host.sidebarArtifactWorkspace?.artifact.providerMetadata ?? {};
    expect(meta.previewKind).toBe("html");
    expect(meta.officeSlides).toEqual([{ index: 1, lines: ["组织新未来", "数字人同事"] }]);
    expect(expectText(meta.previewText)).toContain("# 第 1 页");
    expect(expectText(meta.previewText)).toContain("组织新未来");
  });

  it("opens PDF deliverables via blob: preview URL instead of only data:", () => {
    const host = createHost();
    const pdfBase64 = Buffer.from("%PDF-1.4 mock").toString("base64");
    const lane = applyWorkspaceFilePreview({
      host,
      workspace: buildWorkspace("讲座报告.pdf"),
      filename: "讲座报告.pdf",
      file: {
        filename: "讲座报告.pdf",
        relativePath: "讲座报告.pdf",
        mimeType: "application/pdf",
        textLike: false,
        base64: pdfBase64,
      },
    });

    expect(lane).toBe("pdf");
    const meta = host.sidebarArtifactWorkspace?.artifact.providerMetadata ?? {};
    expect(meta.previewKind).toBe("pdf");
    if (typeof URL !== "undefined" && typeof Blob !== "undefined") {
      expect(expectText(meta.pdfPreviewUrl)).toMatch(/^blob:/);
      expect(host.sidebarArtifactWorkspace?.artifact.previewUrl).toMatch(/^blob:/);
    }
  });

  it("renders canvas graph JSON as an HTML node preview", () => {
    const host = createHost();
    const graph = JSON.stringify({
      nodes: [
        { id: "root", type: "group", label: "趋势总览" },
        { id: "n1", type: "text", label: "核心判断\n量产元年" },
      ],
    });
    const lane = applyWorkspaceFilePreview({
      host,
      workspace: buildWorkspace("trends.canvas"),
      filename: "trends.canvas",
      file: {
        filename: "trends.canvas",
        mimeType: "application/x-openbot-canvas",
        textLike: true,
        base64: Buffer.from(graph, "utf8").toString("base64"),
      },
    });
    expect(lane).toBe("canvas");
    const meta = host.sidebarArtifactWorkspace?.artifact.providerMetadata ?? {};
    expect(meta.previewKind).toBe("canvas");
    expect(expectText(meta.htmlSrcdoc)).toContain("趋势总览");
    expect(expectText(meta.htmlSrcdoc)).toContain("核心判断");
  });

  it("keeps mammoth-style HTML fragments on the inline renderedHtml path", () => {
    const host = createHost();
    const fragment = "<p>From <strong>docx</strong></p>";
    const lane = applyWorkspaceFilePreview({
      host,
      workspace: buildWorkspace("notes.docx"),
      filename: "notes.docx",
      file: {
        filename: "notes.docx",
        mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        textLike: false,
        renderKind: "html",
        html: fragment,
      },
    });

    expect(lane).toBe("html");
    const meta = host.sidebarArtifactWorkspace?.artifact.providerMetadata ?? {};
    expect(meta.renderedHtml).toBe(fragment);
    expect(meta.htmlSrcdoc).toBeUndefined();
    expect(meta.fileBase64).toBeUndefined();
  });

  it("keeps original pptx bytes on the HTML preview lane for save", () => {
    const host = createHost();
    const pptxBase64 = Buffer.from("PK\u0003\u0004-pptx").toString("base64");
    const html =
      "<!doctype html><html><body><h1>讲座.pptx</h1><section>第 1 页</section></body></html>";
    const lane = applyWorkspaceFilePreview({
      host,
      workspace: buildWorkspace("讲座.pptx"),
      filename: "讲座.pptx",
      file: {
        filename: "讲座.pptx",
        relativePath: "reports/讲座.pptx",
        mimeType: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
        textLike: false,
        renderKind: "html",
        html,
        base64: pptxBase64,
      },
    });
    expect(lane).toBe("html");
    const meta = host.sidebarArtifactWorkspace?.artifact.providerMetadata ?? {};
    expect(meta.previewKind).toBe("html");
    expect(expectText(meta.htmlSrcdoc)).toContain("第 1 页");
    expect(meta.fileBase64).toBe(pptxBase64);
    expect(meta.workspaceFilename).toBe("reports/讲座.pptx");
  });
});

describe("applyWorkspaceFilePreview image lane", () => {
  it("opens workspace png bytes as an image preview, not binary download", () => {
    const host = createHost();
    const pngBase64 =
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
    const lane = applyWorkspaceFilePreview({
      host,
      workspace: buildWorkspace("cover.png"),
      filename: "cover.png",
      file: {
        filename: "cover.png",
        relativePath: "cover.png",
        mimeType: "image/png",
        textLike: false,
        base64: pngBase64,
      },
    });

    expect(lane).toBe("image");
    const artifact = host.sidebarArtifactWorkspace?.artifact;
    const meta = artifact?.providerMetadata ?? {};
    expect(artifact?.artifactType).toBe("image");
    expect(artifact?.mimeType).toBe("image/png");
    expect(meta.previewKind).toBe("image");
    expect(String(artifact?.previewUrl ?? "")).toMatch(/^(?:blob:|data:image\/png)/);
  });
});

describe("published HTML URL preview", () => {
  it("resolves openbot.love html pages as browsable preview urls", () => {
    expect(
      resolveBrowsableHtmlPreviewUrl({
        openUrl: "https://www.openbot.love/128-layout-preview.html",
        mimeType: "text/html",
      }),
    ).toBe("https://www.openbot.love/128-layout-preview.html");
    expect(
      resolveBrowsableHtmlPreviewUrl({
        openUrl: "/128-layout-preview.html",
      }),
    ).toBe("/128-layout-preview.html");
    expect(
      resolveBrowsableHtmlPreviewUrl({
        openUrl: "https://example.com/report.pdf",
      }),
    ).toBeNull();
    expect(
      resolveBrowsableHtmlPreviewUrl({
        openUrl: "blob:https://www.openbot.love/preview-pdf",
        previewUrl: "blob:https://www.openbot.love/preview-pdf",
        mimeType: "application/pdf",
        title: "OpenBot 高质量投资介绍 PDF",
        workspaceFilename: "OpenBot_高质量投资介绍.pdf",
      }),
    ).toBeNull();
    expect(
      resolveBrowsableHtmlPreviewUrl({
        previewUrl: "blob:https://www.openbot.love/html-1",
        mimeType: "text/html",
        title: "report.html",
      }),
    ).toBe("blob:https://www.openbot.love/html-1");
  });

  it("prefers blob/https PDF URLs and never inlines data:application/pdf", () => {
    expect(
      resolveInlinePdfPreviewUrl({
        pdfPreviewUrl: "blob:https://www.openbot.love/pdf-1",
        previewUrl: "data:application/pdf;base64,AAA",
      }),
    ).toBe("blob:https://www.openbot.love/pdf-1");
    expect(
      resolveInlinePdfPreviewUrl({
        previewUrl: "data:application/pdf;base64,AAA",
        openUrl: "https://www.openbot.love/report.pdf",
      }),
    ).toBe("https://www.openbot.love/report.pdf");
    expect(
      resolveInlinePdfPreviewUrl({
        previewUrl: "data:application/pdf;base64,AAA",
        openUrl: "data:application/pdf;base64,BBB",
      }),
    ).toBe("");
  });

  it("opens a non-empty declared markdown file as text instead of a miss", () => {
    const host = createHost();
    host.artifactPreviewMissIds = ["assistant-doc:html-1"];
    const body = "# 终稿\n\n正文已经落盘。\n";
    const workspace = buildWorkspace("article-final.md");
    workspace.artifact.mimeType = "text/markdown";
    const lane = applyWorkspaceFilePreview({
      host,
      workspace,
      filename: "article-final.md",
      file: {
        filename: "article-final.md",
        relativePath: "article-final.md",
        mimeType: "text/markdown",
        textLike: true,
        base64: encodeUtf8Base64(body),
      },
    });
    expect(lane).toBe("text");
    expect(host.sidebarArtifactWorkspace?.artifact.providerMetadata?.workspaceFileLoaded).toBe(
      true,
    );
    expect(host.sidebarArtifactWorkspace?.artifact.providerMetadata?.previewUnavailable).not.toBe(
      true,
    );
    expect(host.sidebarArtifactWorkspace?.artifact.providerMetadata?.previewText).toBe(body);
    expect(host.artifactPreviewMissIds).toEqual([]);
  });

  it("applies published html url into the html iframe lane", () => {
    const host = createHost();
    const lane = applyPublishedHtmlUrlPreview({
      host,
      workspace: buildWorkspace("128-layout-preview.html"),
      htmlUrl: "https://www.openbot.love/128-layout-preview.html",
    });
    expect(lane).toBe("html");
    const meta = host.sidebarArtifactWorkspace?.artifact.providerMetadata ?? {};
    expect(meta.previewKind).toBe("html");
    expect(meta.htmlPreviewUrl).toBe("https://www.openbot.love/128-layout-preview.html");
    expect(meta.publishedUrlPreview).toBe(true);
  });

  it("keeps artifact chrome when marking a file preview unavailable", () => {
    const host = createHost();
    applyUnavailableFilePreview({
      host,
      workspace: buildWorkspace("OpenBot_高质量投资介绍.pdf"),
      message: "chat.stewardFileUnavailable",
    });
    expect(host.sidebarPreviewMode).toBe("artifact");
    expect(host.sidebarOpen).toBe(true);
    expect(host.sidebarContent).toBeNull();
    const meta = host.sidebarArtifactWorkspace?.artifact.providerMetadata ?? {};
    expect(meta.previewKind).toBe("file");
    expect(meta.previewUnavailable).toBe(true);
    expect(meta.previewText).toBe("chat.stewardFileUnavailable");
    expect(host.artifactPreviewMissIds).toContain(
      host.sidebarArtifactWorkspace?.artifact.artifactId,
    );
    expect(
      isArtifactPreviewMiss(
        host.artifactPreviewMissIds,
        host.sidebarArtifactWorkspace?.artifact.artifactId ?? "",
      ),
    ).toBe(true);
  });

  it("dedupes noteArtifactPreviewMiss ids", () => {
    const host = createHost();
    noteArtifactPreviewMiss(host, "a1");
    noteArtifactPreviewMiss(host, "a1");
    noteArtifactPreviewMiss(host, "  ");
    expect(host.artifactPreviewMissIds).toEqual(["a1"]);
  });

  it("clearArtifactPreviewMiss drops a sticky id so chips can retry", () => {
    const host = createHost();
    noteArtifactPreviewMiss(host, "a1");
    noteArtifactPreviewMiss(host, "a2");
    clearArtifactPreviewMiss(host, "a1");
    clearArtifactPreviewMiss(host, "missing");
    expect(host.artifactPreviewMissIds).toEqual(["a2"]);
  });

  it("applyWorkspaceFilePreview clears a prior miss for that artifact", () => {
    const host = createHost();
    const workspace = buildWorkspace("brief.html");
    noteArtifactPreviewMiss(host, workspace.artifact.artifactId);
    const html = "<!doctype html><html><body><h1>ok</h1></body></html>";
    const lane = applyWorkspaceFilePreview({
      host,
      workspace,
      filename: "output/html/brief.html",
      file: {
        filename: "brief.html",
        relativePath: "output/html/brief.html",
        mimeType: "text/html",
        textLike: true,
        base64: encodeUtf8Base64(html),
      },
    });
    expect(lane).toBe("html");
    expect(host.artifactPreviewMissIds ?? []).not.toContain(workspace.artifact.artifactId);
  });
});
