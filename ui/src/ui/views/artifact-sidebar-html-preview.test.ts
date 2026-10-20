// @vitest-environment jsdom
import { render } from "lit";
import { describe, expect, it, vi } from "vitest";
import { renderArtifactSidebar } from "./artifact-sidebar.ts";

vi.mock("../../i18n/index.ts", () => ({
  t: (key: string) => key,
}));

function htmlWorkspace(metadata: Record<string, unknown>, opts?: { previewUrl?: string }) {
  return {
    artifact: {
      artifactId: "html-1",
      artifactType: "doc" as const,
      storageClass: "inline-media" as const,
      title: "日落下的未来城市",
      provider: "artifact-event",
      createdBy: { type: "bot" as const, id: "agent-1" },
      createdAt: "2026-08-12T00:00:00.000Z",
      updatedAt: "2026-08-12T00:00:00.000Z",
      lifecycleState: "created" as const,
      mimeType: "text/html",
      ...(opts?.previewUrl ? { previewUrl: opts.previewUrl } : {}),
      providerMetadata: metadata,
    },
    versions: [],
    deliveries: [],
    grants: [],
    intents: [],
  };
}

describe("artifact sidebar HTML preview", () => {
  it("uses iframe src only when htmlPreviewUrl is set (never paints srcdoc=undefined)", () => {
    const container = document.createElement("div");
    render(
      renderArtifactSidebar({
        workspace: htmlWorkspace(
          {
            previewKind: "html",
            htmlPreviewUrl: "blob:https://www.openbot.love/preview-html",
            htmlSrcdoc: "<!doctype html><html><body>ok</body></html>",
            workspaceFilename: "未来城市日落.html",
          },
          { previewUrl: "blob:https://www.openbot.love/preview-html" },
        ),
      }),
      container,
    );

    const iframe = container.querySelector<HTMLIFrameElement>("iframe.artifact-preview-html");
    expect(iframe).not.toBeNull();
    expect(iframe?.getAttribute("src")).toBe("blob:https://www.openbot.love/preview-html");
    expect(iframe?.hasAttribute("srcdoc")).toBe(false);
    expect(container.textContent).not.toMatch(/\bundefined\b/i);
    expect(container.querySelector(".artifact-preview-path__value")?.textContent).toBe(
      "未来城市日落.html",
    );
    expect(container.querySelector(".artifact-preview-primary--media")).not.toBeNull();
    expect(container.querySelector(".artifact-preview-media__stage")).not.toBeNull();
  });

  it("centers image media shell with path basename and no nested conversation composer", () => {
    const container = document.createElement("div");
    render(
      renderArtifactSidebar({
        workspace: {
          artifact: {
            artifactId: "img-1",
            artifactType: "image" as const,
            storageClass: "inline-media" as const,
            title: "日落",
            provider: "artifact-event",
            createdBy: { type: "bot" as const, id: "agent-1" },
            createdAt: "2026-08-12T00:00:00.000Z",
            updatedAt: "2026-08-12T00:00:00.000Z",
            lifecycleState: "created" as const,
            mimeType: "image/png",
            previewUrl: "blob:https://www.openbot.love/img",
            providerMetadata: {
              previewKind: "image",
              imagePreviewUrl: "blob:https://www.openbot.love/img",
              workspaceFilename: ".openbot/generated-images/未来城市日落.png",
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

    expect(container.querySelector(".artifact-preview-shell--media")).not.toBeNull();
    expect(container.querySelector(".artifact-preview-primary--image")).not.toBeNull();
    expect(container.querySelector(".artifact-preview-path__value")?.textContent).toBe(
      "未来城市日落.png",
    );
    expect(container.querySelector(".artifact-edit")).toBeNull();
    expect(container.querySelector(".artifact-preview-media__stage img")).not.toBeNull();
  });

  it("falls back to srcdoc only when no preview URL exists", () => {
    const container = document.createElement("div");
    const srcdoc = "<!doctype html><html><body>fallback</body></html>";
    render(
      renderArtifactSidebar({
        workspace: htmlWorkspace({
          previewKind: "html",
          htmlSrcdoc: srcdoc,
          workspaceFilename: "report.html",
        }),
      }),
      container,
    );

    const iframe = container.querySelector<HTMLIFrameElement>("iframe.artifact-preview-html");
    expect(iframe).not.toBeNull();
    expect(iframe?.getAttribute("src") ?? "").toBe("");
    expect(iframe?.getAttribute("srcdoc") ?? "").toContain("fallback");
    expect(iframe?.getAttribute("srcdoc") ?? "").toContain("data-openbot-preview-viewport");
  });

  it("ignores literal undefined/null htmlSrcdoc tokens", () => {
    const container = document.createElement("div");
    render(
      renderArtifactSidebar({
        workspace: htmlWorkspace({
          previewKind: "html",
          htmlPreviewUrl: "blob:https://www.openbot.love/ok",
          htmlSrcdoc: "undefined",
          workspaceFilename: "ok.html",
        }),
      }),
      container,
    );

    const iframe = container.querySelector<HTMLIFrameElement>("iframe.artifact-preview-html");
    expect(iframe?.getAttribute("src")).toBe("blob:https://www.openbot.love/ok");
    expect(iframe?.hasAttribute("srcdoc")).toBe(false);
    expect(container.textContent).not.toMatch(/\bundefined\b/i);
  });

  it("does not render a PDF blob as a broken image", () => {
    const container = document.createElement("div");
    const pdfBlob = "blob:https://www.openbot.love/preview-pdf";
    render(
      renderArtifactSidebar({
        workspace: {
          artifact: {
            artifactId: "pdf-1",
            artifactType: "doc" as const,
            storageClass: "inline-media" as const,
            title: "OpenBot 高质量投资介绍 PDF",
            provider: "artifact-event",
            createdBy: { type: "bot" as const, id: "agent-1" },
            createdAt: "2026-08-17T00:00:00.000Z",
            updatedAt: "2026-08-17T00:00:00.000Z",
            lifecycleState: "created" as const,
            mimeType: "application/pdf",
            previewUrl: pdfBlob,
            openUrl: pdfBlob,
            providerMetadata: {
              previewKind: "pdf",
              pdfPreviewUrl: pdfBlob,
              workspaceFilename: "OpenBot_高质量投资介绍.pdf",
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

    expect(container.querySelector("img")).toBeNull();
    const iframe = container.querySelector<HTMLIFrameElement>("iframe.artifact-preview-pdf");
    expect(iframe).not.toBeNull();
    expect(iframe?.getAttribute("src")).toBe(pdfBlob);
    expect(iframe?.hasAttribute("sandbox")).toBe(false);
  });

  it("wraps PPTX HTML preview with an inline slide-text editor", () => {
    const container = document.createElement("div");
    render(
      renderArtifactSidebar({
        workspace: htmlWorkspace({
          previewKind: "html",
          htmlPreviewUrl: "blob:https://www.openbot.love/pptx",
          htmlSrcdoc: "<!doctype html><html><body>组织新未来</body></html>",
          workspaceFilename: "通州方案.pptx",
          previewText: "# 第 1 页\n组织新未来",
          officeSlides: [{ index: 1, lines: ["组织新未来"] }],
        }),
      }),
      container,
    );

    const iframe = container.querySelector<HTMLIFrameElement>("iframe.artifact-preview-html");
    expect(iframe).not.toBeNull();
    expect(container.querySelector(".artifact-preview-text__editor")).not.toBeNull();
    expect(container.querySelector(".artifact-preview-primary--media")).toBeNull();
  });
});
