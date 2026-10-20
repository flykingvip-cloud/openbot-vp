import { describe, expect, it, vi } from "vitest";
import type { GroupManifestLookup } from "../controllers/group-deliverable-manifest.ts";
import type { ArtifactWorkspaceSidebar } from "../types.ts";
import {
  extractArtifactPreviewContent,
  extractArtifactSavePayload,
  markDeliverableSaveDirty,
  mergeDeliverableSaveStateAfterPreviewLoad,
  resolveDeliverableSaveChipLabel,
  resolveDeliverableSaveToastMessage,
  resolveGroupWorkspaceReadTarget,
  resolveInferredGroupDraftPath,
  resolvePersistableDeliverableId,
  resolveSaveKnowledgeBaseId,
  SAVE_ARCHIVE_KB_AUTO,
  saveAndArchiveSidebarDeliverable,
  DeliverableSaveCancelledError,
} from "./deliverable-save.ts";

vi.mock("../../i18n/index.ts", () => ({
  t: (key: string, params?: Record<string, string>) => {
    if (key === "chat.deliverableStatusSavedKb" && params?.kb) {
      return `saved:${params.kb}`;
    }
    const labels: Record<string, string> = {
      "chat.deliverableStatusUnsaved": "unsaved",
      "chat.deliverableStatusSaved": "saved",
      "chat.deliverableStatusCaptured": "captured",
      "chat.deliverableStatusKbFailed": "kb_failed",
    };
    return labels[key] ?? key;
  },
}));

function workspace(
  artifactId: string,
  metadata: Record<string, unknown> = {},
): ArtifactWorkspaceSidebar {
  return {
    artifact: {
      artifactId,
      artifactType: "doc",
      title: "Demo",
      sourceMessage: "body",
      provider: "test",
      storageClass: "collaborative-doc",
      createdBy: { type: "user", id: "test" },
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
      lifecycleState: "stored",
      providerMetadata: metadata,
    },
    versions: [],
    deliveries: [],
    grants: [],
    intents: [],
  };
}

describe("mergeDeliverableSaveStateAfterPreviewLoad", () => {
  it("preserves saved chip after group file reload", () => {
    const prior = {
      artifactId: "a1",
      status: "saved" as const,
      knowledgeBaseTitle: "Team KB",
    };
    const next = mergeDeliverableSaveStateAfterPreviewLoad(
      prior,
      workspace("a1", { workspaceFilename: "deliverables/draft.md" }),
    );
    expect(next).toEqual(prior);
  });

  it("preserves kb_failed chip after steward reload", () => {
    const prior = {
      artifactId: "a1",
      status: "kb_failed" as const,
      error: "boom",
    };
    const next = mergeDeliverableSaveStateAfterPreviewLoad(
      prior,
      workspace("a1", { workspaceFilename: "notes.md" }),
    );
    expect(next).toEqual(prior);
  });

  it("preserves dirty saved chip after group file reload", () => {
    const prior = {
      artifactId: "a1",
      status: "saved" as const,
      knowledgeBaseTitle: "Team KB",
      dirty: true,
    };
    const next = mergeDeliverableSaveStateAfterPreviewLoad(
      prior,
      workspace("a1", { workspaceFilename: "deliverables/final.md" }),
    );
    expect(next.dirty).toBe(true);
  });
});

describe("markDeliverableSaveDirty", () => {
  it("marks saved deliverables dirty after inline edit", () => {
    expect(
      markDeliverableSaveDirty({
        artifactId: "a1",
        status: "saved",
        knowledgeBaseTitle: "KB",
      })?.dirty,
    ).toBe(true);
    expect(
      markDeliverableSaveDirty({
        artifactId: "a1",
        status: "captured",
      }),
    ).toEqual({ artifactId: "a1", status: "captured" });
  });
});

describe("resolveGroupWorkspaceReadTarget", () => {
  const manifest: GroupManifestLookup = {
    groupId: "group-abc",
    logicalId: "logic-1",
    draft: {
      relativePath: "deliverables/draft.md",
      updatedAtMs: 1,
    },
    canonical: {
      relativePath: "deliverables/final.md",
      deliverableId: "d1",
      knowledgeBaseId: "kb1",
      savedAtMs: 2,
    },
  };

  it("prefers canonical manifest path over draft and metadata", () => {
    expect(
      resolveGroupWorkspaceReadTarget(
        workspace("a1", { workspaceFilename: "deliverables/other.md" }),
        "group-abc",
        manifest,
      ),
    ).toEqual({ groupId: "group-abc", filename: "deliverables/final.md" });
  });

  it("falls back to draft path when canonical is absent", () => {
    expect(
      resolveGroupWorkspaceReadTarget(
        workspace("a1", { workspaceFilename: "deliverables/other.md" }),
        "group-abc",
        { ...manifest, canonical: null },
      ),
    ).toEqual({ groupId: "group-abc", filename: "deliverables/draft.md" });
  });

  it("returns null without groupId even when metadata has filename", () => {
    expect(
      resolveGroupWorkspaceReadTarget(
        workspace("a1", { workspaceFilename: "x.md" }),
        null,
        manifest,
      ),
    ).toBeNull();
  });

  it("infers draft path from logicalId when filename is absent", () => {
    expect(
      resolveGroupWorkspaceReadTarget(
        workspace("a1", { logicalId: "Weekly Report" }),
        "group-abc",
        null,
      ),
    ).toEqual({
      groupId: "group-abc",
      filename: resolveInferredGroupDraftPath("Weekly Report"),
    });
  });
});

describe("resolveDeliverableSaveChipLabel", () => {
  it("matches chip labels for saved and failure states", () => {
    expect(
      resolveDeliverableSaveChipLabel({
        artifactId: "a1",
        status: "saved",
        knowledgeBaseTitle: "Team KB",
      }),
    ).toBe("saved:Team KB");
    expect(
      resolveDeliverableSaveChipLabel({
        artifactId: "a1",
        status: "kb_failed",
      }),
    ).toBe("kb_failed");
  });
});

describe("resolveDeliverableSaveToastMessage", () => {
  it("includes kb failure detail for toast", () => {
    expect(
      resolveDeliverableSaveToastMessage({
        artifactId: "a1",
        status: "kb_failed",
        error: "gemini embeddings failed: 429",
      }),
    ).toBe("kb_failed: gemini embeddings failed: 429");
  });
});

describe("extractArtifactSavePayload", () => {
  it("sends PDF bytes as base64 instead of preview text", () => {
    const pdfWorkspace = workspace("a1", {
      previewKind: "pdf",
      fileBase64: "JVBERi0x",
      previewText: "对话摘要不应作为 PDF 正文",
    });
    expect(extractArtifactSavePayload(pdfWorkspace)).toEqual({
      content: "",
      contentBase64: "JVBERi0x",
    });
  });

  it("does not archive the binary preview hint as document text", () => {
    const binaryWorkspace = workspace("a1", {
      previewKind: "binary",
      previewText: "Download the file and open it with a compatible app.",
    });
    expect(extractArtifactSavePayload(binaryWorkspace)).toEqual({ content: "" });
  });

  it("archives original Office bytes instead of preview HTML", () => {
    const pptxWorkspace = workspace("a1", {
      previewKind: "html",
      htmlSrcdoc: "<!doctype html><html><body>第 1 页</body></html>",
      fileBase64: "UEsDBAoAAAAA",
      workspaceFilename: "reports/deck.pptx",
    });
    expect(extractArtifactSavePayload(pptxWorkspace)).toEqual({
      content: "",
      contentBase64: "UEsDBAoAAAAA",
    });
  });
});

describe("extractArtifactPreviewContent", () => {
  it("prefers htmlSrcdoc over envelope sourceMessage for html previews", () => {
    const htmlWorkspace = workspace("a1", {
      previewKind: "html",
      htmlSrcdoc: "<!doctype html><html><body><h1>报告</h1></body></html>",
    });
    htmlWorkspace.artifact.sourceMessage = "对话摘要不应作为沉淀正文";
    expect(extractArtifactPreviewContent(htmlWorkspace)).toContain("<h1>报告</h1>");
  });
});

describe("resolvePersistableDeliverableId", () => {
  it("drops sidebar preview artifact ids", () => {
    expect(resolvePersistableDeliverableId("assistant-doc:abc")).toBeNull();
    expect(resolvePersistableDeliverableId("tool-write:xyz")).toBeNull();
    expect(resolvePersistableDeliverableId("skill:real-1")).toBe("skill:real-1");
  });
});

describe("resolveSaveKnowledgeBaseId", () => {
  it("falls back to auto when KU has no selection or loaded bases", () => {
    expect(
      resolveSaveKnowledgeBaseId({
        selectedKnowledgeBaseId: null,
        knowledgeBaseIds: [],
      }),
    ).toBe(SAVE_ARCHIVE_KB_AUTO);
  });

  it("always uses auto so gateway picks 个人成果 or 团队成果", () => {
    expect(
      resolveSaveKnowledgeBaseId({
        selectedKnowledgeBaseId: "kb-selected",
        knowledgeBaseIds: ["kb-first"],
        relatedKnowledgeBaseId: "kb-related",
      }),
    ).toBe(SAVE_ARCHIVE_KB_AUTO);
    expect(
      resolveSaveKnowledgeBaseId({
        selectedKnowledgeBaseId: "kb-enterprise",
        knowledgeBaseIds: ["kb-enterprise"],
      }),
    ).toBe(SAVE_ARCHIVE_KB_AUTO);
  });
});

describe("saveAndArchiveSidebarDeliverable", () => {
  it("omits preview artifact ids from saveAndArchive RPC", async () => {
    const request = vi.fn(async () => ({
      deliverableId: "skill:1",
      knowledgeBaseId: "kb-1",
      knowledgeBaseTitle: "KB",
    }));
    await saveAndArchiveSidebarDeliverable({
      client: { request } as never,
      workspace: workspace("assistant-doc:previewhash", { logicalId: "doc-1" }),
      sessionKey: "agent:main:main",
      knowledgeBaseId: "kb-1",
      content: "enough markdown body for archive",
      deliverableId: "assistant-doc:previewhash",
    });
    expect(request).toHaveBeenCalledWith(
      "knowledge.deliverables.saveAndArchive",
      expect.objectContaining({
        knowledgeBaseId: SAVE_ARCHIVE_KB_AUTO,
      }),
    );
    expect(request).toHaveBeenCalledWith(
      "knowledge.deliverables.saveAndArchive",
      expect.not.objectContaining({ deliverableId: expect.anything() }),
    );
  });

  it("never forwards an ordinary or enterprise knowledgeBaseId", async () => {
    const request = vi.fn(async () => ({
      deliverableId: "skill:1",
      knowledgeBaseId: "kb-personal-deliverables",
      knowledgeBaseTitle: "个人成果",
    }));
    await saveAndArchiveSidebarDeliverable({
      client: { request } as never,
      workspace: workspace("skill:real-1", { logicalId: "doc-1" }),
      sessionKey: "agent:main:main",
      knowledgeBaseId: "kb-enterprise",
      content: "enough markdown body for archive",
      deliverableId: "skill:real-1",
    });
    expect(request).toHaveBeenCalledWith(
      "knowledge.deliverables.saveAndArchive",
      expect.objectContaining({
        knowledgeBaseId: SAVE_ARCHIVE_KB_AUTO,
        deliverableId: "skill:real-1",
      }),
    );
    expect(request).toHaveBeenCalledWith(
      "knowledge.deliverables.saveAndArchive",
      expect.not.objectContaining({ knowledgeBaseId: "kb-enterprise" }),
    );
  });

  it("forwards PDF contentBase64 to saveAndArchive", async () => {
    const request = vi.fn(async () => ({
      deliverableId: "skill:1",
      knowledgeBaseId: "kb-personal-deliverables",
      knowledgeBaseTitle: "个人成果",
      documentId: "doc-1",
    }));
    await saveAndArchiveSidebarDeliverable({
      client: { request } as never,
      workspace: workspace("skill:real-1", { workspaceFilename: "brief.pdf" }),
      sessionKey: "agent:main:main",
      content: "",
      contentBase64: "JVBERi0x",
      filename: "brief.pdf",
      deliverableId: "skill:real-1",
    });
    expect(request).toHaveBeenCalledWith(
      "knowledge.deliverables.saveAndArchive",
      expect.objectContaining({
        contentBase64: "JVBERi0x",
        filename: "brief.pdf",
      }),
    );
  });

  it("retries with overwrite after SAVE_DECISION_REQUIRED", async () => {
    const request = vi
      .fn()
      .mockRejectedValueOnce({
        details: {
          code: "SAVE_DECISION_REQUIRED",
          existing: { rawHash: "hash-v1", filename: "brief.md" },
          suggestedSaveAsFilename: "brief-v2.md",
        },
      })
      .mockResolvedValueOnce({
        deliverableId: "skill:1",
        knowledgeBaseId: "kb-personal-deliverables",
        knowledgeBaseTitle: "个人成果",
      });
    const askSaveDecision = vi.fn(async () => ({ saveMode: "overwrite" as const }));
    await saveAndArchiveSidebarDeliverable({
      client: { request } as never,
      workspace: workspace("skill:real-1", { logicalId: "doc-1" }),
      sessionKey: "agent:main:main",
      content: "enough markdown body for archive",
      deliverableId: "skill:real-1",
      askSaveDecision,
    });
    expect(askSaveDecision).toHaveBeenCalledOnce();
    expect(request).toHaveBeenNthCalledWith(
      2,
      "knowledge.deliverables.saveAndArchive",
      expect.objectContaining({
        saveMode: "overwrite",
        expectedRawHash: "hash-v1",
      }),
    );
  });

  it("re-asks on the same click when overwrite becomes stale", async () => {
    const request = vi
      .fn()
      .mockRejectedValueOnce({
        details: {
          code: "SAVE_DECISION_REQUIRED",
          existing: { rawHash: "hash-v1", filename: "brief.md" },
          suggestedSaveAsFilename: "brief-v2.md",
        },
      })
      .mockRejectedValueOnce({
        details: {
          code: "SAVE_CONFLICT_STALE",
          existing: { rawHash: "hash-v2", filename: "brief.md" },
          suggestedSaveAsFilename: "brief-v2.md",
        },
      })
      .mockResolvedValueOnce({
        deliverableId: "skill:1",
        knowledgeBaseId: "kb-personal-deliverables",
        knowledgeBaseTitle: "个人成果",
      });
    const askSaveDecision = vi
      .fn()
      .mockResolvedValueOnce({ saveMode: "overwrite" as const })
      .mockResolvedValueOnce({ saveMode: "overwrite" as const });
    await saveAndArchiveSidebarDeliverable({
      client: { request } as never,
      workspace: workspace("skill:real-1", { logicalId: "doc-1" }),
      sessionKey: "agent:main:main",
      content: "enough markdown body for archive",
      deliverableId: "skill:real-1",
      askSaveDecision,
    });
    expect(askSaveDecision).toHaveBeenCalledTimes(2);
    expect(askSaveDecision.mock.calls[1]?.[0]).toMatchObject({
      kind: "stale",
      existingRawHash: "hash-v2",
    });
    expect(request).toHaveBeenNthCalledWith(
      3,
      "knowledge.deliverables.saveAndArchive",
      expect.objectContaining({
        saveMode: "overwrite",
        expectedRawHash: "hash-v2",
      }),
    );
  });

  it("cancels without retry when the user dismisses the decision", async () => {
    const request = vi.fn().mockRejectedValueOnce({
      details: {
        code: "SAVE_DECISION_REQUIRED",
        existing: { rawHash: "hash-v1", filename: "brief.md" },
        suggestedSaveAsFilename: "brief-v2.md",
      },
    });
    await expect(
      saveAndArchiveSidebarDeliverable({
        client: { request } as never,
        workspace: workspace("skill:real-1"),
        sessionKey: "agent:main:main",
        content: "enough markdown body for archive",
        askSaveDecision: async () => null,
      }),
    ).rejects.toBeInstanceOf(DeliverableSaveCancelledError);
    expect(request).toHaveBeenCalledOnce();
  });
});
