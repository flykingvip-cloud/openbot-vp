// @vitest-environment node
import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { KnowledgeSourceContext } from "../knowledge/sources/types.js";
import type { GatewayRequestHandler } from "./types.js";

const { tmpDir } = vi.hoisted(() => {
  const dir = `/tmp/openbot-kb-governance-rpc-${Math.random().toString(36).slice(2)}`;
  return { tmpDir: dir };
});

const contextState = vi.hoisted(() => ({
  current: {
    userId: "user-governance",
    seatId: null,
    tenantId: null,
    hasEnterpriseScope: false,
  } satisfies KnowledgeSourceContext,
}));

vi.mock("../../utils.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../utils.js")>();
  return {
    ...actual,
    CONFIG_DIR: tmpDir,
  };
});

vi.mock("../knowledge/context.js", () => ({
  resolveKnowledgeSourceContext: vi.fn(async () => contextState.current),
}));

const { knowledgeGovernanceHandlers } = await import("./knowledge-governance.js");

type InvokeResult = {
  ok: boolean;
  payload?: Record<string, unknown>;
  error?: { message?: string };
};

function cleanStore() {
  fs.rmSync(path.join(tmpDir, "knowledge"), { recursive: true, force: true });
  fs.mkdirSync(tmpDir, { recursive: true });
}

async function invoke(method: string, params: Record<string, unknown> = {}): Promise<InvokeResult> {
  const handler = knowledgeGovernanceHandlers[method] as GatewayRequestHandler | undefined;
  if (!handler) {
    throw new Error(`missing handler ${method}`);
  }
  let response: InvokeResult | null = null;
  await handler({
    req: { type: "req", id: "test", method, params },
    params,
    client: { connect: {} as never, user: "test@example.com" },
    isWebchatConnect: () => false,
    respond: (ok: boolean, payload: unknown, error: { message?: string } | undefined) => {
      response = { ok, payload: payload as Record<string, unknown> | undefined, error };
    },
  } as never);
  if (!response) {
    throw new Error("handler did not respond");
  }
  return response;
}

describe("knowledge governance RPC", () => {
  beforeEach(() => {
    cleanStore();
  });

  afterEach(() => {
    cleanStore();
  });

  it("provisions an empty index and returns zero summary when no db exists yet", async () => {
    const summaryRes = await invoke("knowledge.governance.summary");
    expect(summaryRes.ok).toBe(true);
    const summary = summaryRes.payload?.summary as Record<string, unknown>;
    expect(summary.openConflictCount).toBe(0);
    expect(summary.indexedChunkCount).toBe(0);

    const tasksRes = await invoke("knowledge.governance.tasks.list", { status: "open" });
    expect(tasksRes.ok).toBe(true);
    expect(tasksRes.payload?.tasks).toEqual([]);

    const dbPath = path.join(tmpDir, "knowledge", "index", "personal", "user-governance.db");
    expect(fs.existsSync(dbPath)).toBe(true);
  });
});
