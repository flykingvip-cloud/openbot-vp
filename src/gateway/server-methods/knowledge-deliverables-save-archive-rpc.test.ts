// @vitest-environment node
import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { KnowledgeSourceContext } from "../knowledge/sources/types.js";
import type { GatewayRequestHandler, GatewayRequestHandlerOptions } from "./types.js";

const { tmpDir, saveAndArchiveMock } = vi.hoisted(() => ({
  tmpDir: `/tmp/openbot-deliverable-save-rpc-${Math.random().toString(36).slice(2)}`,
  saveAndArchiveMock: vi.fn(async (params: { knowledgeBaseId: string; groupId?: string }) => ({
    deliverableId: "skill:captured",
    knowledgeBaseId: params.knowledgeBaseId,
    knowledgeBaseTitle: "resolved",
    ...(params.groupId ? { groupId: params.groupId } : {}),
  })),
}));

const contextState = vi.hoisted(() => ({
  current: {
    userId: "user-a",
    seatId: null,
    tenantId: null,
    hasEnterpriseScope: false,
  } as KnowledgeSourceContext,
}));

vi.mock("../../utils.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../utils.js")>();
  return { ...actual, CONFIG_DIR: tmpDir };
});

vi.mock("../knowledge/context.js", () => ({
  resolveKnowledgeSourceContext: vi.fn(async () => contextState.current),
}));

vi.mock("../knowledge/deliverables/save-and-archive.js", () => ({
  saveAndArchiveWorkspaceDeliverable: saveAndArchiveMock,
}));

const { knowledgeHandlers } = await import("./knowledge.js");
const { createKnowledgeBase } = await import("../knowledge/knowledge-base-store.js");
const { ensurePersonalDeliverablesKnowledgeBase, ensureTeamDeliverablesKnowledgeBase } =
  await import("../knowledge/deliverable-folders.js");

async function invoke(params: Record<string, unknown>): Promise<{
  ok: boolean;
  payload?: Record<string, unknown>;
  error?: { message?: string; reasonCode?: string; details?: unknown };
}> {
  const method = "knowledge.deliverables.saveAndArchive";
  const handler = knowledgeHandlers[method] as GatewayRequestHandler | undefined;
  if (!handler) {
    throw new Error(`missing handler ${method}`);
  }
  let response: {
    ok: boolean;
    payload?: Record<string, unknown>;
    error?: { message?: string };
  } | null = null;
  await handler({
    req: { type: "req", id: "test", method, params },
    params,
    client: { connect: {} as never, user: "test@example.com" },
    isWebchatConnect: () => false,
    respond: (ok, payload, error) => {
      response = {
        ok,
        payload: payload as Record<string, unknown> | undefined,
        error: error as { message?: string; reasonCode?: string; details?: unknown } | undefined,
      };
    },
    context: {} as GatewayRequestHandlerOptions["context"],
  });
  if (!response) {
    throw new Error(`handler ${method} did not respond`);
  }
  return response;
}

function request(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    knowledgeBaseId: "auto",
    sessionKey: "agent:main:main",
    title: "验收成果",
    content: "这是一份已经由用户明确点击保存的完整成果内容，用于验证固定成果文件夹归档通路。",
    ...overrides,
  };
}

describe("knowledge.deliverables.saveAndArchive fixed-folder routing", () => {
  beforeEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    fs.mkdirSync(path.join(tmpDir, "knowledge"), { recursive: true });
    saveAndArchiveMock.mockClear();
    contextState.current = {
      userId: "user-a",
      seatId: null,
      tenantId: null,
      hasEnterpriseScope: false,
    };
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("routes a personal chat save with auto/default to 个人成果", async () => {
    for (const knowledgeBaseId of ["auto", "default", ""]) {
      saveAndArchiveMock.mockClear();
      const result = await invoke(request({ knowledgeBaseId }));

      expect(result.ok).toBe(true);
      expect(saveAndArchiveMock).toHaveBeenCalledOnce();
      expect(saveAndArchiveMock.mock.calls[0]?.[0]).toMatchObject({
        userId: "user-a",
        knowledgeBaseTitle: "个人成果",
      });
    }
  });

  it("routes a collaboration save with auto/default to 团队成果", async () => {
    for (const knowledgeBaseId of ["auto", "default", ""]) {
      saveAndArchiveMock.mockClear();
      const result = await invoke(
        request({ knowledgeBaseId, groupId: "group-a", sessionKey: "space:group-a" }),
      );

      expect(result.ok).toBe(true);
      expect(saveAndArchiveMock).toHaveBeenCalledOnce();
      expect(saveAndArchiveMock.mock.calls[0]?.[0]).toMatchObject({
        userId: "user-a",
        groupId: "group-a",
        knowledgeBaseTitle: "团队成果",
      });
    }
  });

  it("rejects a personal session that explicitly targets 团队成果", async () => {
    const team = ensureTeamDeliverablesKnowledgeBase({ ownerId: "user-a" });
    const result = await invoke(request({ knowledgeBaseId: team.id }));

    expect(result.ok).toBe(false);
    expect(result.error?.message).toContain("personal_deliverables");
    expect(saveAndArchiveMock).not.toHaveBeenCalled();
  });

  it("rejects a collaboration session that explicitly targets 个人成果", async () => {
    const personal = ensurePersonalDeliverablesKnowledgeBase({ ownerId: "user-a" });
    const result = await invoke(
      request({
        knowledgeBaseId: personal.id,
        groupId: "group-a",
        sessionKey: "space:group-a",
      }),
    );

    expect(result.ok).toBe(false);
    expect(result.error?.message).toContain("team_deliverables");
    expect(saveAndArchiveMock).not.toHaveBeenCalled();
  });

  it("rejects an explicit ordinary knowledge base as a deliverable archive target", async () => {
    const ordinary = createKnowledgeBase({
      title: "普通知识库",
      ownerId: "user-a",
      visibility: "private",
      backendKind: "personal",
    });

    const result = await invoke(request({ knowledgeBaseId: ordinary.id }));

    expect(result.ok).toBe(false);
    expect(result.error?.message).toContain("personal_deliverables");
    expect(saveAndArchiveMock).not.toHaveBeenCalled();
  });

  it("rejects saveAndArchive when the caller has no user context", async () => {
    contextState.current = {
      userId: null,
      seatId: null,
      tenantId: null,
      hasEnterpriseScope: false,
    };
    const result = await invoke(request());

    expect(result.ok).toBe(false);
    expect(result.error?.message).toMatch(/user context required/);
    expect(saveAndArchiveMock).not.toHaveBeenCalled();
  });

  it("calls saveAndArchive only after the reserved-folder check accepts the target", async () => {
    const rejected = await invoke(
      request({
        knowledgeBaseId: createKnowledgeBase({
          title: "企业资料",
          ownerId: "user-a",
          visibility: "enterprise",
          backendKind: "enterprise",
        }).id,
      }),
    );
    expect(rejected.ok).toBe(false);
    expect(saveAndArchiveMock).not.toHaveBeenCalled();

    const accepted = await invoke(request({ knowledgeBaseId: "auto" }));
    expect(accepted.ok).toBe(true);
    expect(saveAndArchiveMock).toHaveBeenCalledOnce();
  });

  it("forwards PDF contentBase64 for binary ingest", async () => {
    const result = await invoke(
      request({
        contentBase64: Buffer.from("%PDF-1.4").toString("base64"),
        filename: "brief.pdf",
      }),
    );
    expect(result.ok).toBe(true);
    expect(saveAndArchiveMock.mock.calls[0]?.[0]).toMatchObject({
      contentBase64: Buffer.from("%PDF-1.4").toString("base64"),
      filename: "brief.pdf",
    });
  });

  it("forwards tenant ownership proof so cloud KB ingest can write", async () => {
    contextState.current = {
      userId: "user-a",
      seatId: null,
      tenantId: "tenant-cloud",
      hasEnterpriseScope: true,
    };
    const result = await invoke(request({ knowledgeBaseId: "auto" }));
    expect(result.ok).toBe(true);
    expect(saveAndArchiveMock.mock.calls[0]?.[0]).toMatchObject({
      userId: "user-a",
      governanceOwnershipProof: {
        owner: { kind: "user", userId: "user-a" },
        scope: { kind: "tenant", tenantId: "tenant-cloud" },
      },
    });
  });

  it("forwards overwrite and save-as decision fields", async () => {
    const result = await invoke(
      request({
        saveMode: "save_as",
        expectedRawHash: "hash-seen",
        saveAsFilename: "brief-v2.md",
      }),
    );
    expect(result.ok).toBe(true);
    expect(saveAndArchiveMock.mock.calls[0]?.[0]).toMatchObject({
      saveMode: "save_as",
      expectedRawHash: "hash-seen",
      saveAsFilename: "brief-v2.md",
    });
  });

  it("returns SAVE_DECISION_REQUIRED details so the sidebar can ask", async () => {
    const { SaveDecisionRequiredError } =
      await import("../knowledge/deliverables/save-decision.js");
    saveAndArchiveMock.mockRejectedValueOnce(
      new SaveDecisionRequiredError({
        existing: {
          knowledgeBaseId: "kb-personal",
          documentId: "doc-1",
          rawHash: "hash-v1",
          filename: "deliverables/brief.md",
        },
        proposedRawHash: "hash-v2",
        reason: "content_changed",
      }),
    );
    const result = await invoke(request());
    expect(result.ok).toBe(false);
    expect(result.error?.reasonCode).toBe("SAVE_DECISION_REQUIRED");
    expect(result.error?.details).toMatchObject({
      code: "SAVE_DECISION_REQUIRED",
      proposedRawHash: "hash-v2",
      suggestedSaveAsFilename: "deliverables/brief-v2.md",
    });
  });
});
