import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { CURRENT_SESSION_VERSION } from "@earendil-works/pi-coding-agent";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { OguiDecisionRecord } from "../../config/sessions/ogui-decision.js";
import type { GatewayRequestContext } from "./types.js";

const mockState = vi.hoisted(() => ({
  transcriptPath: "",
  sessionId: "sess-ogui-history",
  decisions: undefined as Record<string, OguiDecisionRecord> | undefined,
}));

vi.mock("../tenant-context.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../tenant-context.js")>();
  return {
    ...original,
    loadSessionEntryForClient: async (rawKey: string) => ({
      cfg: { session: { mainKey: "main" } },
      storePath: path.join(path.dirname(mockState.transcriptPath), "sessions.json"),
      entry: {
        sessionId: mockState.sessionId,
        sessionFile: mockState.transcriptPath,
        ...(mockState.decisions ? { oguiDecisions: mockState.decisions } : {}),
      },
      canonicalKey: rawKey || "agent:main:main",
    }),
  };
});

const { chatHandlers } = await import("./chat.js");

const sessionKey = "agent:main:main";

function expiredRecord(): OguiDecisionRecord {
  return {
    decisionId: "ogd_historical",
    version: 1,
    decisionStatus: "expired",
    resumeStatus: "pending",
    resumeRef: "ogr_secret_ref",
    scope: {
      sessionKey,
      userId: "user-from-auth",
      originRunId: "run-origin",
    },
    prompt: "选口径",
    options: [
      { value: "a", label: "甲" },
      { value: "b", label: "乙" },
    ],
    allowCustom: false,
    multiSelect: false,
    issuedAtMs: 1,
    updatedAtMs: 2,
  };
}

function createTranscript() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "openbot-ogui-history-"));
  const transcriptPath = path.join(dir, "sess.jsonl");
  fs.writeFileSync(
    transcriptPath,
    `${JSON.stringify({
      type: "session",
      version: CURRENT_SESSION_VERSION,
      id: mockState.sessionId,
      timestamp: new Date(0).toISOString(),
      cwd: "/tmp",
    })}\n`,
    "utf-8",
  );
  mockState.transcriptPath = transcriptPath;
  return dir;
}

function context(): GatewayRequestContext {
  return {
    broadcast: vi.fn(),
    broadcastChat: vi.fn(),
    nodeSendToSession: vi.fn(),
    agentRunSeq: new Map(),
    chatAbortControllers: new Map(),
    chatRunBuffers: new Map(),
    chatDeltaSentAt: new Map(),
    chatAbortedRuns: new Map(),
    removeChatRun: vi.fn(),
    dedupe: new Map(),
    registerToolEventRecipient: vi.fn(),
    loadGatewayModelCatalog: vi.fn(async () => []),
    logGateway: { warn: vi.fn(), debug: vi.fn(), info: vi.fn() },
  } as unknown as GatewayRequestContext;
}

describe("chat.history OGUI decision status", () => {
  let dir = "";

  afterEach(() => {
    mockState.decisions = undefined;
    if (dir) {
      fs.rmSync(dir, { recursive: true, force: true });
      dir = "";
    }
  });

  it("projects SessionEntry.oguiDecisions status without identity (Ev8)", async () => {
    dir = createTranscript();
    mockState.decisions = { ogd_historical: expiredRecord() };
    const respond = vi.fn();
    await chatHandlers["chat.history"]({
      params: { sessionKey },
      respond,
      req: {} as never,
      client: null as never,
      isWebchatConnect: () => false,
      context: context(),
    });
    expect(respond.mock.calls.at(-1)?.[0]).toBe(true);
    const payload = respond.mock.calls.at(-1)?.[1] as {
      oguiDecisionStatuses?: Record<string, { decisionStatus: string; version: number }>;
    };
    expect(payload.oguiDecisionStatuses).toEqual({
      ogd_historical: { decisionStatus: "expired", version: 1 },
    });
    expect(JSON.stringify(payload.oguiDecisionStatuses)).not.toContain("user-from-auth");
    expect(JSON.stringify(payload.oguiDecisionStatuses)).not.toContain("ogr_secret_ref");
  });

  it("omits the status slice when the session has no decisions (Ev8 flag-off)", async () => {
    dir = createTranscript();
    mockState.decisions = undefined;
    const respond = vi.fn();
    await chatHandlers["chat.history"]({
      params: { sessionKey },
      respond,
      req: {} as never,
      client: null as never,
      isWebchatConnect: () => false,
      context: context(),
    });
    expect(respond.mock.calls.at(-1)?.[0]).toBe(true);
    const payload = respond.mock.calls.at(-1)?.[1] as Record<string, unknown>;
    expect(payload).not.toHaveProperty("oguiDecisionStatuses");
  });
});
