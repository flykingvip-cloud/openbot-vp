/* @vitest-environment jsdom */

import { describe, expect, it, vi } from "vitest";
import type { ArtifactWorkspaceSidebar } from "../types.ts";
import {
  openArtifactDeliverablePreview,
  type DeliverablePreviewHost,
} from "./group-deliverable-preview-flow.ts";

vi.mock("../../../i18n/index.ts", () => ({
  t: (key: string) => key,
}));

function encodeUtf8Base64(text: string): string {
  return btoa(unescape(encodeURIComponent(text)));
}

function expectText(value: unknown): string {
  expect(typeof value).toBe("string");
  return value as string;
}

function createHost(): DeliverablePreviewHost {
  return {
    sidebarOpen: false,
    sidebarPreviewMode: "markdown",
    sidebarContent: null,
    sidebarError: null,
    sidebarArtifactWorkspace: null,
    sidebarDeliverableSaveState: null,
    artifactPreviewMissIds: [],
  };
}

function buildStewardWorkspace(filename: string): ArtifactWorkspaceSidebar {
  return {
    artifact: {
      artifactId: "assistant-doc:steward-1",
      artifactType: "doc",
      title: "讲座报告",
      provider: "assistant-message",
      storageClass: "inline-media",
      createdBy: { type: "bot", id: "main" },
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
      lifecycleState: "stored",
      mimeType: "application/pdf",
      providerMetadata: {
        workspaceFilename: filename,
        previewKind: "file",
        deliverableEnvelope: true,
      },
    },
    versions: [],
    deliveries: [],
    grants: [],
    intents: [],
  };
}

describe("steward deliverable preview routing", () => {
  it("does not steal steward files into a leftover collaboration team selection", async () => {
    const host = createHost();
    const workspace = buildStewardWorkspace("组织新未来_当数字人成为你的同事_精美版.pdf");
    const pdfBase64 = btoa("%PDF-1.4");
    const request = vi.fn(async (method: string, payload: Record<string, unknown>) => {
      if (method === "workbench.group-file.read" || method === "workbench.group-manifest.read") {
        throw new Error(`group rpc must not run for steward chat: ${method}`);
      }
      if (method === "workbench.steward-file.read") {
        expect(payload).toMatchObject({
          filename: "组织新未来_当数字人成为你的同事_精美版.pdf",
          sessionKey: "agent:main:main",
          render: true,
        });
        return {
          filename: "组织新未来_当数字人成为你的同事_精美版.pdf",
          relativePath: "组织新未来_当数字人成为你的同事_精美版.pdf",
          mimeType: "application/pdf",
          byteLength: 8,
          textLike: false,
          base64: pdfBase64,
        };
      }
      throw new Error(`unexpected rpc: ${method}`);
    });

    const route = await openArtifactDeliverablePreview({
      host,
      workspace,
      client: { request } as never,
      sessionKey: "agent:main:main",
      sessionsResult: {
        sessions: [
          { key: "agent:main:main", updatedAt: Date.now() },
          {
            key: "space:grp-hrqb-163-com-权变管理专家",
            groupId: "grp-hrqb-163-com-权变管理专家",
            updatedAt: Date.now(),
          },
        ],
      } as never,
      // Leftover team selection from a previous collaboration visit.
      workbenchTeamSelectedKey: "space:grp-hrqb-163-com-权变管理专家",
    });

    expect(route).toBe("steward-file");
    expect(host.sidebarPreviewMode).toBe("artifact");
    expect(host.sidebarArtifactWorkspace?.artifact.providerMetadata?.previewKind).toBe("pdf");
    // Prefer blob: for Chrome iframe stability; data: remains as fallback metadata.
    const previewUrl = String(host.sidebarArtifactWorkspace?.artifact.previewUrl ?? "");
    expect(previewUrl).toMatch(/^(?:blob:|data:application\/pdf;base64,)/);
    expect(host.sidebarArtifactWorkspace?.artifact.providerMetadata?.dataUrl).toMatch(
      /^data:application\/pdf;base64,/,
    );
    expect(request.mock.calls.some(([method]) => method === "workbench.group-file.read")).toBe(
      false,
    );
  });

  it("does not accept a PDF preview when the server bytes do not parse", async () => {
    const host = createHost();
    const workspace = buildStewardWorkspace("讲座报告.pdf");
    const request = vi.fn(async (method: string) => {
      if (method === "workbench.steward-file.read") {
        return {
          filename: "讲座报告.pdf",
          relativePath: "讲座报告.pdf",
          mimeType: "application/pdf",
          byteLength: 11,
          textLike: false,
          base64: btoa("not-a-pdf"),
        };
      }
      throw new Error(`unexpected rpc: ${method}`);
    });

    const route = await openArtifactDeliverablePreview({
      host,
      workspace,
      client: { request } as never,
      sessionKey: "agent:main:main",
      sessionsResult: { sessions: [{ key: "agent:main:main", updatedAt: Date.now() }] } as never,
    });

    expect(route).toBe("steward-file");
    expect(host.sidebarArtifactWorkspace?.artifact.providerMetadata?.previewKind).not.toBe("pdf");
    expect(host.sidebarArtifactWorkspace?.artifact.providerMetadata?.pdfParseFailed).toBe(true);
    expect(host.sidebarArtifactWorkspace?.artifact.providerMetadata?.previewUnavailable).toBe(true);
  });

  it("opens the sidebar with a loading shell before the file RPC resolves", async () => {
    const host = createHost();
    const workspace = buildStewardWorkspace("组织新未来_当数字人成为你的同事_精美版.pdf");
    let resolveRead!: (value: unknown) => void;
    const readPromise = new Promise((resolve) => {
      resolveRead = resolve;
    });
    const request = vi.fn(async (method: string) => {
      if (method === "workbench.steward-file.read") {
        return readPromise;
      }
      throw new Error(`unexpected rpc: ${method}`);
    });

    const pending = openArtifactDeliverablePreview({
      host,
      workspace,
      client: { request } as never,
      sessionKey: "agent:main:main",
      sessionsResult: { sessions: [{ key: "agent:main:main", updatedAt: Date.now() }] } as never,
    });

    await Promise.resolve();
    expect(host.sidebarOpen).toBe(true);
    expect(host.sidebarPreviewMode).toBe("artifact");
    expect(host.sidebarArtifactWorkspace?.artifact.providerMetadata?.previewKind).toBe("loading");
    expect(String(host.sidebarContent ?? "")).toMatch(/loading|stewardFileLoading/i);

    resolveRead({
      filename: "组织新未来_当数字人成为你的同事_精美版.pdf",
      relativePath: "组织新未来_当数字人成为你的同事_精美版.pdf",
      mimeType: "application/pdf",
      byteLength: 8,
      textLike: false,
      base64: btoa("%PDF-1.4"),
    });
    await pending;
    expect(host.sidebarArtifactWorkspace?.artifact.providerMetadata?.previewKind).toBe("pdf");
  });

  it("ignores repeat open clicks while the same artifact is still loading", async () => {
    const host = createHost();
    const workspace = buildStewardWorkspace("slow.pdf");
    let resolveRead!: (value: unknown) => void;
    const readPromise = new Promise((resolve) => {
      resolveRead = resolve;
    });
    const request = vi.fn(async (method: string) => {
      if (method === "workbench.steward-file.read") {
        return readPromise;
      }
      throw new Error(`unexpected rpc: ${method}`);
    });

    const first = openArtifactDeliverablePreview({
      host,
      workspace,
      client: { request } as never,
      sessionKey: "agent:main:main",
      sessionsResult: { sessions: [{ key: "agent:main:main", updatedAt: Date.now() }] } as never,
    });
    await Promise.resolve();
    const second = await openArtifactDeliverablePreview({
      host,
      workspace,
      client: { request } as never,
      sessionKey: "agent:main:main",
      sessionsResult: { sessions: [{ key: "agent:main:main", updatedAt: Date.now() }] } as never,
    });
    expect(second).toBe("inline");
    expect(request).toHaveBeenCalledTimes(1);

    resolveRead({
      filename: "slow.pdf",
      relativePath: "slow.pdf",
      mimeType: "application/pdf",
      byteLength: 8,
      textLike: false,
      base64: btoa("%PDF-1.4"),
    });
    await first;
  });

  it("falls back to a published HTML openUrl when the workspace file is missing", async () => {
    const host = createHost();
    const workspace = buildStewardWorkspace("128-layout-preview.html");
    workspace.artifact.openUrl = "https://www.openbot.love/128-layout-preview.html";
    workspace.artifact.mimeType = "text/html";
    const request = vi.fn(async () => {
      throw new Error("not found");
    });

    const route = await openArtifactDeliverablePreview({
      host,
      workspace,
      client: { request } as never,
      sessionKey: "agent:main:main",
      sessionsResult: { sessions: [{ key: "agent:main:main", updatedAt: Date.now() }] } as never,
    });

    expect(route).toBe("inline");
    expect(host.sidebarPreviewMode).toBe("artifact");
    const meta = host.sidebarArtifactWorkspace?.artifact.providerMetadata ?? {};
    expect(meta.previewKind).toBe("html");
    expect(meta.htmlPreviewUrl).toBe("https://www.openbot.love/128-layout-preview.html");
    expect(meta.publishedUrlPreview).toBe(true);
    expect(String(host.sidebarContent ?? "")).not.toMatch(
      /unavailable|暂不可用|stewardFileUnavailable/i,
    );
  });

  it("keeps file-unavailable state in artifact chrome instead of tool-output markdown", async () => {
    const host = createHost();
    const workspace = buildStewardWorkspace("一切都刚刚开始_第128期综述_发布版.docx");
    const request = vi.fn(async () => {
      throw new Error("not found");
    });

    const route = await openArtifactDeliverablePreview({
      host,
      workspace,
      client: { request } as never,
      sessionKey: "agent:main:main",
      sessionsResult: { sessions: [{ key: "agent:main:main", updatedAt: Date.now() }] } as never,
    });

    expect(route).toBe("steward-file");
    expect(host.sidebarOpen).toBe(true);
    expect(host.sidebarPreviewMode).toBe("artifact");
    expect(host.sidebarArtifactWorkspace).not.toBeNull();
    const meta = host.sidebarArtifactWorkspace?.artifact.providerMetadata ?? {};
    expect(meta.previewKind).toBe("file");
    expect(meta.previewUnavailable).toBe(true);
    const previewText = typeof meta.previewText === "string" ? meta.previewText : "";
    expect(previewText.length).toBeGreaterThan(20);
    expect(previewText).not.toMatch(/chrome|挂载|Browser Relay/i);
    expect(host.sidebarContent).toBeNull();
  });

  it("does not flash markdown tool-output when a later lookup succeeds", async () => {
    const host = createHost();
    const workspace = buildStewardWorkspace("OpenBot_高质量投资介绍.pdf");
    let stewardReads = 0;
    const request = vi.fn(async (method: string, payload: Record<string, unknown>) => {
      if (method === "workbench.group-file.read" || method === "workbench.group-manifest.read") {
        throw new Error("group miss");
      }
      if (method === "workbench.steward-file.read") {
        stewardReads += 1;
        const filename = typeof payload.filename === "string" ? payload.filename : "";
        if (filename.endsWith(".html")) {
          const html = "<!doctype html><html><body><h1>投资介绍</h1></body></html>";
          return {
            filename: "OpenBot_高质量投资介绍.html",
            relativePath: "OpenBot_高质量投资介绍.html",
            mimeType: "text/html",
            byteLength: html.length,
            textLike: true,
            base64: encodeUtf8Base64(html),
          };
        }
        throw new Error("pdf missing");
      }
      throw new Error(`unexpected rpc: ${method}`);
    });

    const route = await openArtifactDeliverablePreview({
      host,
      workspace,
      client: { request } as never,
      sessionKey: "agent:main:main",
      sessionsResult: { sessions: [{ key: "agent:main:main", updatedAt: Date.now() }] } as never,
    });

    expect(route).toBe("steward-file");
    expect(host.sidebarPreviewMode).toBe("artifact");
    expect(host.sidebarPreviewMode).not.toBe("markdown");
    const meta = host.sidebarArtifactWorkspace?.artifact.providerMetadata ?? {};
    expect(meta.previewKind).toBe("html");
    expect(stewardReads).toBeGreaterThan(1);
  });

  it("renders steward PPTX as an HTML slide preview in the sidebar", async () => {
    const host = createHost();
    const workspace = buildStewardWorkspace("讲座.pptx");
    workspace.artifact.mimeType =
      "application/vnd.openxmlformats-officedocument.presentationml.presentation";
    const html =
      "<!doctype html><html><body><h1>讲座.pptx</h1><section>第 1 页</section></body></html>";
    const pptxBytes = Buffer.from("PK\u0003\u0004-pptx").toString("base64");
    const request = vi.fn(async (method: string) => {
      if (method === "workbench.steward-file.read") {
        return {
          filename: "讲座.pptx",
          relativePath: "讲座.pptx",
          mimeType: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
          byteLength: 1200,
          textLike: false,
          renderKind: "html",
          html,
          base64: pptxBytes,
        };
      }
      throw new Error(`unexpected rpc: ${method}`);
    });

    const route = await openArtifactDeliverablePreview({
      host,
      workspace,
      client: { request } as never,
      sessionKey: "agent:main:main",
      sessionsResult: { sessions: [{ key: "agent:main:main", updatedAt: Date.now() }] } as never,
    });

    expect(route).toBe("steward-file");
    const meta = host.sidebarArtifactWorkspace?.artifact.providerMetadata ?? {};
    expect(meta.previewKind).toBe("html");
    expect(expectText(meta.htmlSrcdoc)).toContain("第 1 页");
    expect(meta.fileBase64).toBe(pptxBytes);
  });

  it("opens agent-produced PPTX from pptxPath or the .pptx title when workspaceFilename is missing", async () => {
    const host = createHost();
    const workspace = buildStewardWorkspace("unused.pdf");
    workspace.artifact.title = "通州妇产医院后勤管理岗位精简优化方案_客户演示版.pptx";
    workspace.artifact.mimeType =
      "application/vnd.openxmlformats-officedocument.presentationml.presentation";
    workspace.artifact.providerMetadata = {
      pptxPath: "/tmp/通州妇产医院后勤管理岗位精简优化方案_客户演示版.pptx",
      previewKind: "file",
    };
    const html =
      "<!doctype html><html><body><h1>客户演示版</h1><section>第 1 页</section></body></html>";
    const request = vi.fn(async (method: string, params?: { filename?: string }) => {
      if (method === "workbench.steward-file.read") {
        expect(params?.filename).toBe("/tmp/通州妇产医院后勤管理岗位精简优化方案_客户演示版.pptx");
        return {
          filename: "通州妇产医院后勤管理岗位精简优化方案_客户演示版.pptx",
          relativePath: "output/pptx/通州妇产医院后勤管理岗位精简优化方案_客户演示版.pptx",
          mimeType: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
          byteLength: 1800,
          textLike: false,
          renderKind: "html",
          html,
        };
      }
      throw new Error(`unexpected rpc: ${method}`);
    });

    const route = await openArtifactDeliverablePreview({
      host,
      workspace,
      client: { request } as never,
      sessionKey: "agent:main:main",
      sessionsResult: { sessions: [{ key: "agent:main:main", updatedAt: Date.now() }] } as never,
    });

    expect(route).toBe("steward-file");
    expect(host.sidebarArtifactWorkspace?.artifact.providerMetadata?.previewKind).toBe("html");
    expect(request).toHaveBeenCalled();
  });

  it("shows an unresolvable path instead of opening a same-name file", async () => {
    const host = createHost();
    const workspace = buildStewardWorkspace("article.html");
    workspace.artifact.providerMetadata = {
      workspaceFilename: "article.html",
      filePath: "/tmp/campaigns/october/article.html",
      previewKind: "file",
    };
    const request = vi.fn(async () => {
      throw new Error("cannot resolve workspace path");
    });
    const route = await openArtifactDeliverablePreview({
      host,
      workspace,
      client: { request } as never,
      sessionKey: "agent:main:main",
      sessionsResult: { sessions: [{ key: "agent:main:main", updatedAt: Date.now() }] } as never,
    });
    expect(route).toBe("steward-file");
    expect(request).toHaveBeenCalledWith(
      "workbench.steward-file.read",
      expect.objectContaining({ filename: "/tmp/campaigns/october/article.html" }),
    );
    const rawPreviewText = host.sidebarArtifactWorkspace?.artifact.providerMetadata?.previewText;
    const previewText = typeof rawPreviewText === "string" ? rawPreviewText : "";
    expect(previewText).toContain("cannot be resolved inside the workspace");
    expect(previewText).not.toContain("not ready to preview yet");
  });

  it("renders steward HTML reports inline instead of dumping source", async () => {
    const host = createHost();
    const workspace = buildStewardWorkspace("report_a4.html");
    const html = "<html><body><h1>报告</h1></body></html>";
    const request = vi.fn(async () => ({
      filename: "report_a4.html",
      relativePath: "report_a4.html",
      mimeType: "text/html",
      byteLength: html.length,
      textLike: true,
      base64: encodeUtf8Base64(html),
    }));

    const route = await openArtifactDeliverablePreview({
      host,
      workspace,
      client: { request } as never,
      sessionKey: "main",
      sessionsResult: { sessions: [{ key: "main", updatedAt: Date.now() }] } as never,
    });

    expect(route).toBe("steward-file");
    const meta = host.sidebarArtifactWorkspace?.artifact.providerMetadata ?? {};
    expect(meta.previewKind).toBe("html");
    // Full HTML pages use sandboxed iframe srcdoc (not text/source, not stripped renderedHtml).
    expect(expectText(meta.htmlSrcdoc)).toContain("报告");
    expect(meta.previewText).toBeUndefined();
  });

  it("keeps saved conversation chips on steward workspace and never reads knowledge originals", async () => {
    const host = createHost();
    const workspace = buildStewardWorkspace("咨询报告.pdf");
    workspace.artifact.providerMetadata = {
      ...workspace.artifact.providerMetadata,
      saved: true,
      relatedKnowledgeBaseId: "kb-personal",
      knowledgeDocumentId: "doc-report",
    };
    const request = vi.fn(async (method: string, payload: Record<string, unknown>) => {
      if (method === "knowledge.document.preview") {
        throw new Error("conversation preview must not read knowledge originals");
      }
      if (method === "workbench.steward-file.read") {
        expect(payload).toMatchObject({
          filename: "咨询报告.pdf",
          sessionKey: "agent:bot-2:main",
          render: true,
        });
        return {
          filename: "咨询报告.pdf",
          relativePath: "咨询报告.pdf",
          mimeType: "application/pdf",
          byteLength: 8,
          textLike: false,
          base64: btoa("%PDF-1.4"),
        };
      }
      throw new Error(`unexpected rpc: ${method}`);
    });

    const route = await openArtifactDeliverablePreview({
      host,
      workspace,
      client: { request } as never,
      sessionKey: "agent:bot-2:main",
      sessionsResult: { sessions: [{ key: "agent:bot-2:main", updatedAt: Date.now() }] } as never,
    });

    expect(route).toBe("steward-file");
    expect(request).toHaveBeenCalledWith(
      "workbench.steward-file.read",
      expect.objectContaining({
        filename: "咨询报告.pdf",
        sessionKey: "agent:bot-2:main",
      }),
    );
    expect(request.mock.calls.some(([method]) => method === "knowledge.document.preview")).toBe(
      false,
    );
    expect(host.sidebarArtifactWorkspace?.artifact.providerMetadata?.previewKind).toBe("pdf");
  });

  it("does not scan group workspace when a steward 1:1 preview misses", async () => {
    const host = createHost();
    const workspace = buildStewardWorkspace("从干部培训到人才战略工程的落地方案.pptx");
    const request = vi.fn(async (method: string) => {
      if (method === "workbench.group-file.read" || method === "workbench.group-manifest.read") {
        throw new Error(`group rpc must not run for steward chat: ${method}`);
      }
      if (method === "workbench.steward-file.read") {
        throw new Error("not found");
      }
      throw new Error(`unexpected rpc: ${method}`);
    });

    const route = await openArtifactDeliverablePreview({
      host,
      workspace,
      client: { request } as never,
      sessionKey: "agent:main:employee:c6862233-2e3e-4c89-a942-ce813e782637",
      sessionsResult: {
        sessions: [
          {
            key: "agent:main:employee:c6862233-2e3e-4c89-a942-ce813e782637",
            updatedAt: Date.now(),
          },
          {
            key: "space:grp-other",
            groupId: "grp-other",
            updatedAt: Date.now(),
          },
        ],
      } as never,
      workbenchTeamSelectedKey: "space:grp-other",
    });

    expect(route).toBe("steward-file");
    expect(request.mock.calls.some(([method]) => method === "workbench.group-file.read")).toBe(
      false,
    );
    expect(request.mock.calls.some(([method]) => method === "workbench.group-manifest.read")).toBe(
      false,
    );
    expect(host.sidebarArtifactWorkspace?.artifact.providerMetadata?.previewUnavailable).toBe(true);
  });

  it("notes artifactPreviewMissIds when the steward workspace file is missing", async () => {
    const host = createHost();
    const workspace = buildStewardWorkspace("从未写入的成果.html");
    workspace.artifact.mimeType = "text/html";
    workspace.artifact.artifactId = "assistant-doc:html-never-written";
    const request = vi.fn(async () => {
      throw new Error("not found");
    });

    const route = await openArtifactDeliverablePreview({
      host,
      workspace,
      client: { request } as never,
      sessionKey: "agent:main:main",
      sessionsResult: { sessions: [{ key: "agent:main:main", updatedAt: Date.now() }] } as never,
    });

    expect(route).toBe("steward-file");
    expect(host.artifactPreviewMissIds).toContain("assistant-doc:html-never-written");
    expect(host.sidebarArtifactWorkspace?.artifact.providerMetadata?.previewUnavailable).toBe(true);
  });
});
