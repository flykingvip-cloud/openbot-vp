/* @vitest-environment jsdom */

import { describe, expect, it, vi } from "vitest";
import type { ArtifactWorkspaceSidebar } from "./types.ts";
import {
  openArtifactDeliverablePreview,
  type DeliverablePreviewHost,
} from "./wiring/group-deliverable-preview-flow.ts";

vi.mock("../../i18n/index.ts", () => ({
  t: (key: string) => key,
}));

function encodeUtf8Base64(text: string): string {
  return btoa(unescape(encodeURIComponent(text)));
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

function buildGroupWorkspace(overrides?: {
  logicalId?: string;
  groupId?: string;
  workspaceFilename?: string;
}): ArtifactWorkspaceSidebar {
  return {
    artifact: {
      artifactId: "group-deliverable-1",
      artifactType: "doc",
      title: "市场周报",
      provider: "collaboration-envelope",
      storageClass: "collaborative-doc",
      createdBy: { type: "user", id: "test" },
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
      lifecycleState: "stored",
      providerMetadata: {
        logicalId: overrides?.logicalId ?? "weekly-brief",
        groupId: overrides?.groupId ?? "grp-alpha",
        ...(overrides?.workspaceFilename ? { workspaceFilename: overrides.workspaceFilename } : {}),
      },
    },
    versions: [],
    deliveries: [],
    grants: [],
    intents: [],
  };
}

function createPreviewContext(params?: {
  manifest?: Record<string, unknown> | null;
  groupFileText?: string;
  groupFilePath?: string;
  workspace?: ArtifactWorkspaceSidebar;
}) {
  const host = createHost();
  const workspace = params?.workspace ?? buildGroupWorkspace();
  const groupFileText = params?.groupFileText ?? "# 市场周报\n\n来自组 workspace 的正文。";
  const groupFilePath = params?.groupFilePath ?? "deliverables/weekly-brief.md";
  const manifest = params?.manifest ?? {
    groupId: "grp-alpha",
    logicalId: "weekly-brief",
    draft: null,
    canonical: {
      relativePath: "deliverables/weekly-brief.md",
      deliverableId: "skill:weekly-brief",
      knowledgeBaseId: "kb-team",
      knowledgeBaseTitle: "团队知识库",
      savedAtMs: Date.now(),
    },
  };

  const request = vi.fn(async (method: string, _payload: Record<string, unknown>) => {
    if (method === "workbench.group-manifest.read") {
      return manifest;
    }
    if (method === "knowledge.document.preview") {
      throw new Error("conversation preview must not read knowledge originals");
    }
    if (method === "knowledge.deliverables.archiveLookup") {
      return { saved: false };
    }
    if (method === "workbench.group-file.read") {
      expect(_payload).toMatchObject({
        groupId: "grp-alpha",
        filename: groupFilePath,
        render: true,
      });
      return {
        groupId: "grp-alpha",
        relativePath: groupFilePath,
        filename: groupFilePath,
        mimeType: "text/markdown",
        byteLength: groupFileText.length,
        textLike: true,
        base64: encodeUtf8Base64(groupFileText),
      };
    }
    if (method === "workbench.steward-file.read") {
      throw new Error("steward preview must not be used for collaboration groups");
    }
    throw new Error(`unexpected rpc: ${method}`);
  });

  const client = { request } as never;
  const sessionsResult = {
    sessions: [
      {
        key: "space:grp-alpha",
        groupId: "grp-alpha",
        updatedAt: Date.now(),
      },
    ],
  } as never;

  return { host, workspace, client, sessionsResult, request };
}

describe("collaboration group deliverable preview integration", () => {
  it("loads preview content from group workspace via manifest canonical path and restores saved chip", async () => {
    const { host, workspace, client, sessionsResult, request } = createPreviewContext();

    const route = await openArtifactDeliverablePreview({
      host,
      workspace,
      client,
      sessionKey: "space:grp-alpha",
      sessionsResult,
    });

    expect(route).toBe("group-file");
    expect(request).toHaveBeenCalledWith("workbench.group-manifest.read", {
      groupId: "grp-alpha",
      logicalId: "weekly-brief",
    });
    expect(request).toHaveBeenCalledWith(
      "workbench.group-file.read",
      expect.objectContaining({
        groupId: "grp-alpha",
        filename: "deliverables/weekly-brief.md",
        render: true,
      }),
    );
    expect(request.mock.calls.some(([method]) => method === "knowledge.document.preview")).toBe(
      false,
    );
    expect(request.mock.calls.some(([method]) => method === "workbench.steward-file.read")).toBe(
      false,
    );

    expect(host.sidebarOpen).toBe(true);
    expect(host.sidebarPreviewMode).toBe("artifact");
    expect(host.sidebarContent).toBe("# 市场周报\n\n来自组 workspace 的正文。");
    expect(host.sidebarArtifactWorkspace?.artifact.providerMetadata?.workspaceFileLoaded).toBe(
      true,
    );
    expect(host.sidebarArtifactWorkspace?.artifact.providerMetadata?.groupId).toBe("grp-alpha");
    expect(host.sidebarDeliverableSaveState).toMatchObject({
      artifactId: "group-deliverable-1",
      status: "saved",
      knowledgeBaseTitle: "团队知识库",
    });
  });

  it("infers drafts/{logicalId}/content.md when manifest has no paths and preserves captured chip", async () => {
    const draftPath = "drafts/weekly-brief/content.md";
    const { host, workspace, client, sessionsResult, request } = createPreviewContext({
      manifest: {
        groupId: "grp-alpha",
        logicalId: "weekly-brief",
        draft: {
          relativePath: draftPath,
          deliverableId: "skill:weekly-brief",
          updatedAtMs: Date.now(),
        },
        canonical: null,
      },
      groupFilePath: draftPath,
      groupFileText: "# 草稿\n\n待保存正文。",
    });

    const route = await openArtifactDeliverablePreview({
      host,
      workspace,
      client,
      sessionKey: "space:grp-alpha",
      sessionsResult,
    });

    expect(route).toBe("group-file");
    expect(request).toHaveBeenCalledWith(
      "workbench.group-file.read",
      expect.objectContaining({
        groupId: "grp-alpha",
        filename: draftPath,
      }),
    );
    expect(host.sidebarContent).toBe("# 草稿\n\n待保存正文。");
    expect(host.sidebarDeliverableSaveState).toMatchObject({
      artifactId: "group-deliverable-1",
      status: "captured",
    });
  });

  it("does not fall back to steward workspace when groupId is present but metadata only has steward filename", async () => {
    const host = createHost();
    const workspace = buildGroupWorkspace({ workspaceFilename: "steward-only.docx" });
    const request = vi.fn(async (method: string, _payload: Record<string, unknown>) => {
      if (method === "workbench.group-manifest.read") {
        return {
          groupId: "grp-alpha",
          logicalId: "weekly-brief",
          draft: null,
          canonical: null,
        };
      }
      if (method === "knowledge.deliverables.archiveLookup") {
        return { saved: false };
      }
      if (method === "workbench.group-file.read") {
        return {
          groupId: "grp-alpha",
          relativePath: "steward-only.docx",
          filename: "steward-only.docx",
          mimeType: "text/plain",
          byteLength: 4,
          textLike: true,
          base64: encodeUtf8Base64("正文"),
        };
      }
      throw new Error(`unexpected rpc: ${method}`);
    });
    const client = { request } as never;
    const sessionsResult = {
      sessions: [{ key: "space:grp-alpha", groupId: "grp-alpha", updatedAt: Date.now() }],
    } as never;

    const route = await openArtifactDeliverablePreview({
      host,
      workspace,
      client,
      sessionKey: "space:grp-alpha",
      sessionsResult,
    });

    expect(route).toBe("group-file");
    expect(request).toHaveBeenCalledWith(
      "workbench.group-file.read",
      expect.objectContaining({
        groupId: "grp-alpha",
        filename: "steward-only.docx",
      }),
    );
    expect(request.mock.calls.some(([method]) => method === "workbench.steward-file.read")).toBe(
      false,
    );
  });
});
