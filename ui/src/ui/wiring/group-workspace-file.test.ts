/* @vitest-environment jsdom */

import { describe, expect, it, vi } from "vitest";
import type { ArtifactWorkspaceSidebar } from "../types.ts";
import { openGroupWorkspaceFileArtifact } from "./group-workspace-file.ts";

vi.mock("../../../i18n/index.ts", () => ({
  t: (key: string) => key,
}));

function encodeUtf8Base64(text: string): string {
  return btoa(unescape(encodeURIComponent(text)));
}

function createHost() {
  return {
    sidebarOpen: false,
    sidebarPreviewMode: "markdown" as const,
    sidebarContent: null as string | null,
    sidebarError: null as string | null,
    sidebarArtifactWorkspace: null as ArtifactWorkspaceSidebar | null,
  };
}

function buildWorkspace(): ArtifactWorkspaceSidebar {
  return {
    artifact: {
      artifactId: "a1",
      artifactType: "doc",
      title: "报告",
      provider: "assistant-message",
      storageClass: "inline-media",
      createdBy: { type: "user", id: "u1" },
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
      lifecycleState: "stored",
      providerMetadata: {
        workspaceFilename: "reports/ai-org-report.pdf",
        groupId: "grp-alpha",
      },
    },
    versions: [],
    deliveries: [],
    grants: [],
    intents: [],
  };
}

describe("openGroupWorkspaceFileArtifact", () => {
  it("renders HTML report content when agent claimed a PDF under reports/", async () => {
    const host = createHost();
    const html = "<html><body><h1>组织变革</h1></body></html>";
    const request = vi.fn(async (_method: string, payload: { filename: string }) => {
      if (payload.filename === "report/ai-org-report.html") {
        return {
          groupId: "grp-alpha",
          relativePath: "report/ai-org-report.html",
          filename: "ai-org-report.html",
          mimeType: "text/html",
          byteLength: html.length,
          textLike: true,
          base64: encodeUtf8Base64(html),
        };
      }
      throw new Error("missing");
    });

    await openGroupWorkspaceFileArtifact(
      host,
      buildWorkspace(),
      "grp-alpha",
      "reports/ai-org-report.pdf",
      { request } as never,
    );

    expect(host.sidebarPreviewMode).toBe("artifact");
    const meta = host.sidebarArtifactWorkspace?.artifact.providerMetadata ?? {};
    expect(meta.previewKind).toBe("html");
    const htmlPreview =
      typeof meta.htmlSrcdoc === "string"
        ? meta.htmlSrcdoc
        : typeof meta.renderedHtml === "string"
          ? meta.renderedHtml
          : "";
    expect(htmlPreview).toContain("组织变革");
    expect(meta.workspaceFilename).toBe("report/ai-org-report.html");
    expect(meta.groupId).toBe("grp-alpha");
  });

  it("opens PDF bytes as an inline data URL preview", async () => {
    const host = createHost();
    const request = vi.fn(async () => ({
      groupId: "grp-alpha",
      relativePath: "reports/ai-org-report.pdf",
      filename: "ai-org-report.pdf",
      mimeType: "application/pdf",
      byteLength: 4,
      textLike: false,
      base64: btoa("%PDF"),
    }));

    await openGroupWorkspaceFileArtifact(
      host,
      buildWorkspace(),
      "grp-alpha",
      "reports/ai-org-report.pdf",
      { request } as never,
    );

    expect(host.sidebarPreviewMode).toBe("artifact");
    expect(host.sidebarArtifactWorkspace?.artifact.mimeType).toBe("application/pdf");
    const previewUrl = host.sidebarArtifactWorkspace?.artifact.previewUrl ?? "";
    expect(previewUrl).toMatch(/^blob:|^data:application\/pdf;base64,/);
    expect(host.sidebarArtifactWorkspace?.artifact.providerMetadata?.previewKind).toBe("pdf");
  });

  it("keeps an in-pane download lane for non-previewable office binaries", async () => {
    const host = createHost();
    const request = vi.fn(async () => ({
      groupId: "grp-alpha",
      relativePath: "reports/weekly.xlsx",
      filename: "weekly.xlsx",
      mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      byteLength: 8,
      textLike: false,
      base64: btoa("PK\x03\x04xlsx"),
    }));

    await openGroupWorkspaceFileArtifact(
      host,
      buildWorkspace(),
      "grp-alpha",
      "reports/weekly.xlsx",
      { request } as never,
    );

    expect(host.sidebarPreviewMode).toBe("artifact");
    expect(host.sidebarContent).toBeNull();
    const artifact = host.sidebarArtifactWorkspace?.artifact;
    expect(artifact?.artifactType).toBe("binary");
    expect(artifact?.providerMetadata?.previewKind).toBe("binary");
    expect(artifact?.providerMetadata?.downloadedBinary).toBe(true);
    const binaryDownloadUrl = artifact?.providerMetadata?.binaryDownloadUrl;
    expect(typeof binaryDownloadUrl).toBe("string");
    expect(binaryDownloadUrl).toMatch(/^blob:/);
    expect(artifact?.downloadUrl).toBe(binaryDownloadUrl);
  });
});
