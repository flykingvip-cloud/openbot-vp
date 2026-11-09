// @vitest-environment jsdom
import { render } from "lit";
import { describe, expect, it, vi } from "vitest";
import { renderArtifactSidebar, renderArtifactSidebarHeaderActions } from "./artifact-sidebar.ts";

vi.mock("../../i18n/index.ts", () => ({
  t: (key: string) => key,
}));

function binaryWorkspace(opts?: { downloadUrl?: string; filename?: string; mimeType?: string }) {
  const downloadUrl = opts?.downloadUrl ?? "blob:https://www.openbot.love/sheet.xlsx";
  const filename = opts?.filename ?? "reports/weekly.xlsx";
  return {
    artifact: {
      artifactId: "bin-1",
      artifactType: "binary" as const,
      storageClass: "inline-media" as const,
      title: "周报",
      provider: "artifact-event",
      createdBy: { type: "bot" as const, id: "agent-1" },
      createdAt: "2026-08-13T00:00:00.000Z",
      updatedAt: "2026-08-13T00:00:00.000Z",
      lifecycleState: "created" as const,
      mimeType:
        opts?.mimeType ?? "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      downloadUrl,
      openUrl: downloadUrl,
      providerMetadata: {
        previewKind: "binary",
        downloadedBinary: true,
        binaryDownloadUrl: downloadUrl,
        workspaceFilename: filename,
        previewText: "chat.artifactPreviewNoInlineHint",
      },
    },
    versions: [],
    deliveries: [],
    grants: [],
    intents: [],
  };
}

describe("artifact sidebar download lane", () => {
  it("renders centered download CTAs for non-previewable office files", () => {
    const container = document.createElement("div");
    render(
      renderArtifactSidebar({
        workspace: binaryWorkspace(),
      }),
      container,
    );

    expect(container.querySelector('[data-testid="artifact-download-lane"]')).not.toBeNull();
    expect(container.querySelector(".artifact-preview-primary--download")).not.toBeNull();
    expect(container.textContent).toContain("chat.artifactPreviewNoInlineTitle");
    expect(container.querySelector(".artifact-preview-download__badge")?.textContent).toBe("XLSX");
    expect(container.querySelector(".artifact-preview-path__value")?.textContent).toBe(
      "weekly.xlsx",
    );

    const primary = container.querySelector<HTMLAnchorElement>(
      '[data-testid="artifact-download-primary"]',
    );
    expect(primary?.getAttribute("href")).toBe("blob:https://www.openbot.love/sheet.xlsx");
    expect(primary?.getAttribute("download")).toBe("weekly.xlsx");
    expect(primary?.textContent).toContain("chat.artifactPreviewDownloadFile");

    const openTab = container.querySelector<HTMLAnchorElement>(
      '[data-testid="artifact-download-open-tab"]',
    );
    expect(openTab?.getAttribute("target")).toBe("_blank");
    expect(openTab?.textContent).toContain("chat.artifactPreviewOpenInTab");

    const header = document.createElement("div");
    render(renderArtifactSidebarHeaderActions({ workspace: binaryWorkspace() }), header);
    expect(
      header.querySelector(
        'a.artifact-preview-action[aria-label="chat.artifactPreviewDownloadFile"]',
      ),
    ).not.toBeNull();
  });

  it("shows unavailable guidance when download bytes are missing", () => {
    const container = document.createElement("div");
    const workspace = binaryWorkspace({ downloadUrl: "" });
    delete (workspace.artifact.providerMetadata as { binaryDownloadUrl?: string })
      .binaryDownloadUrl;

    render(renderArtifactSidebar({ workspace }), container);

    expect(container.querySelector('[data-testid="artifact-download-lane"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="artifact-download-primary"]')).toBeNull();
    expect(
      container.querySelector('[data-testid="artifact-download-missing"]')?.textContent,
    ).toContain("chat.stewardFileUnavailable");
  });

  it("renders markdown articles instead of the office download lane", () => {
    const container = document.createElement("div");
    render(
      renderArtifactSidebar({
        workspace: {
          artifact: {
            artifactId: "md-1",
            artifactType: "doc",
            storageClass: "inline-media",
            title: "公众号文章_思维链的窗口正在关上.md",
            provider: "assistant-message",
            createdBy: { type: "bot", id: "agent-1" },
            createdAt: "2026-08-13T00:00:00.000Z",
            updatedAt: "2026-08-13T00:00:00.000Z",
            lifecycleState: "created",
            mimeType: "text/markdown",
            providerMetadata: {
              previewKind: "text",
              workspaceFilename: "公众号文章_思维链的窗口正在关上.md",
              workspaceFileLoaded: true,
              previewText: "# 思维链\n\n正文第一段。",
            },
          },
          versions: [],
          deliveries: [],
          grants: [],
          intents: [],
        },
      }),
      container,
    );

    expect(container.querySelector('[data-testid="artifact-download-lane"]')).toBeNull();
    expect(container.querySelector(".artifact-preview-article")).not.toBeNull();
    expect(container.textContent).toContain("思维链");
    expect(container.textContent).not.toContain("chat.artifactPreviewNoInlineTitle");
  });

  it("shows a file-missing card for unloaded markdown instead of unsupported-format copy", () => {
    const container = document.createElement("div");
    render(
      renderArtifactSidebar({
        workspace: {
          artifact: {
            artifactId: "md-miss",
            artifactType: "doc",
            storageClass: "inline-media",
            title: "公众号文章_思维链的窗口正在关上.md",
            provider: "assistant-message",
            createdBy: { type: "bot", id: "agent-1" },
            createdAt: "2026-08-13T00:00:00.000Z",
            updatedAt: "2026-08-13T00:00:00.000Z",
            lifecycleState: "created",
            mimeType: "text/markdown",
            providerMetadata: {
              previewKind: "file",
              previewUnavailable: true,
              workspaceFilename: "公众号文章_思维链的窗口正在关上.md",
              previewText: "chat.stewardFileUnavailable",
            },
          },
          versions: [],
          deliveries: [],
          grants: [],
          intents: [],
        },
      }),
      container,
    );

    expect(container.querySelector('[data-testid="artifact-text-missing-lane"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="artifact-download-lane"]')).toBeNull();
    expect(container.textContent).toContain("chat.artifactPreviewFileMissingTitle");
    expect(container.textContent).not.toContain("chat.artifactPreviewNoInlineTitle");
    expect(container.querySelector(".artifact-preview-download__hint")).toBeNull();
    expect(container.querySelector(".artifact-preview-path")).toBeNull();
    expect(container.textContent).not.toContain("chat.stewardFileUnavailable");
    expect(container.textContent).not.toContain("chat.artifactWorkspacePath");
  });

  it("shows FileMissing for unloaded HTML instead of unsupported-format copy", () => {
    const container = document.createElement("div");
    render(
      renderArtifactSidebar({
        workspace: {
          artifact: {
            artifactId: "html-miss",
            artifactType: "doc",
            storageClass: "inline-media",
            title: "日落下的未来城市.html",
            provider: "assistant-message",
            createdBy: { type: "bot", id: "agent-1" },
            createdAt: "2026-08-13T00:00:00.000Z",
            updatedAt: "2026-08-13T00:00:00.000Z",
            lifecycleState: "created",
            mimeType: "text/html",
            providerMetadata: {
              previewKind: "file",
              previewUnavailable: true,
              workspaceFilename: "output/html/日落下的未来城市.html",
              previewText: "chat.stewardFileUnavailable",
            },
          },
          versions: [],
          deliveries: [],
          grants: [],
          intents: [],
        },
      }),
      container,
    );

    expect(container.querySelector('[data-testid="artifact-text-missing-lane"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="artifact-download-lane"]')).toBeNull();
    expect(container.textContent).toContain("chat.artifactPreviewFileMissingTitle");
    expect(container.textContent).toContain("日落下的未来城市.html");
    expect(container.textContent).not.toContain("output/html/");
    expect(container.textContent).not.toContain("chat.artifactPreviewNoInlineTitle");
    expect(container.querySelector(".artifact-preview-download__hint")).toBeNull();
    expect(container.querySelector(".artifact-preview-path")).toBeNull();
    expect(container.textContent).not.toContain("chat.stewardFileUnavailable");
    expect(container.textContent).not.toContain("chat.artifactWorkspacePath");
  });

  it("shows FileMissing for unloaded PDF instead of unsupported-format copy", () => {
    const container = document.createElement("div");
    render(
      renderArtifactSidebar({
        workspace: {
          artifact: {
            artifactId: "pdf-miss",
            artifactType: "doc",
            storageClass: "inline-media",
            title: "OpenBot_高质量投资介绍.pdf",
            provider: "assistant-message",
            createdBy: { type: "bot", id: "agent-1" },
            createdAt: "2026-08-13T00:00:00.000Z",
            updatedAt: "2026-08-13T00:00:00.000Z",
            lifecycleState: "created",
            mimeType: "application/pdf",
            providerMetadata: {
              previewKind: "file",
              previewUnavailable: true,
              workspaceFilename: "OpenBot_高质量投资介绍.pdf",
              previewText: "chat.stewardFileUnavailable",
            },
          },
          versions: [],
          deliveries: [],
          grants: [],
          intents: [],
        },
      }),
      container,
    );

    expect(container.querySelector('[data-testid="artifact-text-missing-lane"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="artifact-download-lane"]')).toBeNull();
    expect(container.textContent).toContain("chat.artifactPreviewFileMissingTitle");
    expect(container.textContent).not.toContain("chat.artifactPreviewNoInlineTitle");
    expect(container.querySelector(".artifact-preview-download__hint")).toBeNull();
    expect(container.querySelector(".artifact-preview-path")).toBeNull();
    expect(container.textContent).not.toContain("chat.stewardFileUnavailable");
    expect(container.textContent).not.toContain("chat.artifactWorkspacePath");
  });

  it("keeps a markdown miss to icon, filename, badge, and the short status", () => {
    const container = document.createElement("div");
    render(
      renderArtifactSidebar({
        workspace: {
          artifact: {
            artifactId: "md-article-final",
            artifactType: "doc",
            storageClass: "inline-media",
            title: "article-final.md",
            provider: "assistant-message",
            createdBy: { type: "bot", id: "agent-1" },
            createdAt: "2026-08-13T00:00:00.000Z",
            updatedAt: "2026-08-13T00:00:00.000Z",
            lifecycleState: "created",
            mimeType: "text/markdown",
            providerMetadata: {
              previewKind: "file",
              previewUnavailable: true,
              workspaceFilename: "article-final.md",
              previewText: "chat.stewardFileUnavailable",
            },
          },
          versions: [],
          deliveries: [],
          grants: [],
          intents: [],
        },
      }),
      container,
    );

    expect(container.querySelector('[data-testid="artifact-text-missing-lane"]')).not.toBeNull();
    expect(container.querySelector(".artifact-preview-download__title")?.textContent).toBe(
      "article-final.md",
    );
    expect(container.querySelector(".artifact-preview-download__badge")?.textContent).toBe("MD");
    expect(container.querySelector(".artifact-preview-download__kicker")?.textContent?.trim()).toBe(
      "chat.artifactPreviewFileMissingTitle",
    );
    expect(container.querySelector(".artifact-preview-download__hint")).toBeNull();
    expect(container.querySelector(".artifact-preview-path")).toBeNull();
    expect(container.textContent).not.toContain("chat.stewardFileUnavailable");
    expect(container.textContent).not.toContain("chat.artifactWorkspacePath");
    expect(container.textContent).not.toContain("可能尚未同步");
  });

  it("shows FileMissing for HTML file-backed miss without downloadHref", () => {
    const container = document.createElement("div");
    render(
      renderArtifactSidebar({
        workspace: {
          artifact: {
            artifactId: "html-no-bytes",
            artifactType: "doc",
            storageClass: "inline-media",
            title: "report.html",
            provider: "assistant-message",
            createdBy: { type: "bot", id: "agent-1" },
            createdAt: "2026-08-13T00:00:00.000Z",
            updatedAt: "2026-08-13T00:00:00.000Z",
            lifecycleState: "created",
            mimeType: "text/html",
            providerMetadata: {
              previewKind: "html",
              workspaceFilename: "report.html",
            },
          },
          versions: [],
          deliveries: [],
          grants: [],
          intents: [],
        },
      }),
      container,
    );

    expect(container.querySelector('[data-testid="artifact-text-missing-lane"]')).not.toBeNull();
    expect(container.textContent).toContain("chat.artifactPreviewFileMissingTitle");
    expect(container.textContent).not.toContain("chat.artifactPreviewNoInlineTitle");
    expect(container.querySelector(".artifact-preview-download__hint")).toBeNull();
    expect(container.querySelector(".artifact-preview-path")).toBeNull();
    expect(container.textContent).not.toContain("chat.stewardFileUnavailable");
    expect(container.textContent).not.toContain("chat.artifactWorkspacePath");
  });
});

it("never downloads an Office HTML preview under the PPTX filename when original bytes are missing", () => {
  const workspace = binaryWorkspace({
    filename: "deck.pptx",
    mimeType: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  });
  workspace.artifact.openUrl = "blob:https://www.openbot.love/preview-html";
  workspace.artifact.downloadUrl = "";
  Object.assign(workspace.artifact.providerMetadata, {
    previewKind: "html",
    downloadedBinary: false,
    binaryDownloadUrl: "",
    htmlPreviewUrl: workspace.artifact.openUrl,
  });
  const header = document.createElement("div");
  render(renderArtifactSidebarHeaderActions({ workspace }), header);
  expect(header.querySelector('a[download="deck.pptx"]')).toBeNull();
});
