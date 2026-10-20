import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { CURRENT_SESSION_VERSION } from "@earendil-works/pi-coding-agent";
import { afterEach, describe, expect, it, vi } from "vitest";
import { latestDaibaiGuideCard } from "../../shared/daibai-guide-card.js";
import type { GatewayRequestContext } from "./types.js";

const mockState = vi.hoisted(() => ({
  transcriptPath: "",
  sessionId: "sess-guide",
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
      },
      canonicalKey: rawKey || "agent:main:main",
    }),
  };
});

const { chatHandlers } = await import("./chat.js");
const { boundChatHistoryMessages } = await import("./chat.js");

const sessionKey = "agent:main:main";

function createTranscript() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "openbot-daibai-guide-"));
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

const teamState = {
  step: "page" as const,
  path: "catalog" as const,
  category: "office",
  selectedIds: ["docs"],
  selectedLabels: ["文档专员"],
  role: null,
  taskText: "整理周报",
  proposedIds: [] as string[],
  customNames: [] as Array<{ id: string; name: string }>,
  created: [{ catalogId: "docs", agentId: "agt-docs", name: "文档专员" }],
};

async function appendGuide(
  ctx: GatewayRequestContext,
  params: Record<string, unknown>,
  client: unknown = null,
) {
  const respond = vi.fn();
  await chatHandlers["chat.guide.append"]({
    params,
    respond,
    req: {} as never,
    client: client as never,
    isWebchatConnect: () => false,
    context: ctx,
  });
  return respond;
}

describe("chat.guide.append history", () => {
  let dir = "";

  afterEach(() => {
    if (dir) {
      fs.rmSync(dir, { recursive: true, force: true });
      dir = "";
    }
  });

  it("appends a guide card and chat.history returns it for reload", async () => {
    dir = createTranscript();
    const ctx = context();
    const appended = await appendGuide(ctx, {
      sessionKey,
      slot: "team",
      state: teamState,
    });
    expect(appended.mock.calls.at(-1)?.[0]).toBe(true);
    expect(ctx.chatAbortControllers.size).toBe(0);

    const again = await appendGuide(ctx, {
      sessionKey,
      slot: "team",
      state: teamState,
    });
    expect(again.mock.calls.at(-1)?.[1]).toMatchObject({ ok: true, deduped: true });

    const historyRespond = vi.fn();
    await chatHandlers["chat.history"]({
      params: { sessionKey },
      respond: historyRespond,
      req: {} as never,
      client: null as never,
      isWebchatConnect: () => false,
      context: ctx,
    });
    expect(historyRespond.mock.calls.at(-1)?.[0]).toBe(true);
    const payload = historyRespond.mock.calls.at(-1)?.[1] as { messages?: unknown[] };
    const latest = latestDaibaiGuideCard(payload.messages ?? [], "team");
    expect(latest?.kind).toBe("success");
    expect(latest?.state?.created.map((member) => member.name)).toEqual(["文档专员"]);
    expect(JSON.stringify(latest)).not.toMatch(/token|oauth|secret|bearer/i);

    const raw = fs
      .readFileSync(mockState.transcriptPath, "utf8")
      .split(/\r?\n/)
      .filter(Boolean)
      .slice(1)
      .map((line) => JSON.parse(line) as { message?: unknown });
    const bounded = boundChatHistoryMessages({
      rawMessages: raw.map((line) => line.message),
      limit: 20,
      includeTools: false,
    });
    expect(latestDaibaiGuideCard(bounded.messages, "team")?.state?.taskText).toBe("整理周报");
  });

  it("refuses guide cards on a non-steward session and secret keys in the payload", async () => {
    dir = createTranscript();
    const ctx = context();
    const refused = await appendGuide(ctx, {
      sessionKey: "agent:coder:main",
      slot: "welcome",
    });
    expect(refused.mock.calls.at(-1)?.[0]).toBe(false);
    const lines = fs.readFileSync(mockState.transcriptPath, "utf8").split(/\r?\n/).filter(Boolean);
    expect(lines).toHaveLength(1);

    const secret = await appendGuide(ctx, {
      sessionKey,
      slot: "team",
      state: { ...teamState, token: "sk-live-secret" },
    });
    expect(secret.mock.calls.at(-1)?.[0]).toBe(false);
    expect(fs.readFileSync(mockState.transcriptPath, "utf8")).not.toContain("sk-live-secret");
  });
});
