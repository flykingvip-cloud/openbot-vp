import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import type { OpenBotConfig } from "../../config/config.js";
import {
  __resetAgentRunQueueForTest,
  acquireAgentRunSlotWithQueuePolicy,
} from "../../gateway/billing/agent-run-queue.js";
import {
  __resetAgentRunRegistryForTest,
  tryAcquireAgentRunSlot,
} from "../../gateway/billing/agent-run-registry.js";
import {
  CHAT_TURN_ERROR_UNCONFIRMED_TEXT,
  INTERACTION_MODEL_FAILURE_TEXT,
  INTERACTION_QUEUE_TIMEOUT_TEXT,
  INTERACTION_RECORD_UNAVAILABLE_TEXT,
  INTERACTION_TIMEOUT_TEXT,
} from "../model/interaction-resource-wait.js";
import { formatRestrictedInteractionNotice } from "./interaction-sources.js";
import { runAuthorizedInteraction } from "./authorized-interaction.js";
import { routeInteraction } from "./route-interaction.js";
import {
  persistRejectedInteractionTurn,
  readChatTurnTerminal,
  reconcileChatTurnTerminal,
} from "../../gateway/chat-interaction-failure.js";

afterEach(() => {
  vi.useRealTimers();
});

const captured = { requestId: "message", expectedFocusRevision: 0, expectedWriteEpoch: 0 };

function baseParams(message: string, timeoutMs = 50) {
  return {
    input: { message, context: [] },
    config: {} as OpenBotConfig,
    provider: "test",
    model: "test",
    timeoutMs,
    maxTokens: 128,
  };
}

it("S1-A / I-C1: B query does not wait for A's hanging tool beyond the interaction budget, and does not change the board", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "s1-a-queue-"));
  const registry = path.join(dir, "registry.json");
  const queue = path.join(dir, "queue.json");
  const board = path.join(dir, "session.jsonl.task-board.json");
  // Queue I/O cannot be driven by fake timers; the timeout budget itself is
  // defined against a test clock in interaction-resource-wait.test.ts.
  const budgetMs = 80;
  try {
    await __resetAgentRunRegistryForTest(registry);
    await __resetAgentRunQueueForTest(queue);
    const base = {
      enterpriseId: "ent-s1a",
      maxConcurrentRuns: 1,
      allowBurstConcurrency: false,
      concurrencyMode: "queue" as const,
    };
    // A already holds the only commercial slot (hanging tool / execution).
    const held = await tryAcquireAgentRunSlot({ ...base, runId: "run-a" }, registry);
    expect(held.ok).toBe(true);

    const authorize = vi.fn(async (input: { queueMaxWaitMs?: number }) => {
      const slot = await acquireAgentRunSlotWithQueuePolicy(
        { ...base, runId: "run-b" },
        {
          maxWaitMs: input.queueMaxWaitMs ?? budgetMs,
          pollIntervalMs: 50,
          registryStorePath: registry,
          queueStorePath: queue,
        },
      );
      if (slot.ok) {
        return { acquired: true as const, skipped: false as const };
      }
      return {
        acquired: false as const,
        skipped: false as const,
        reason: slot.reason,
        message:
          slot.reason === "CONCURRENCY_QUEUE_TIMEOUT"
            ? INTERACTION_QUEUE_TIMEOUT_TEXT
            : "denied",
      };
    });
    const dispose = vi.fn(async () => undefined);
    const started = Date.now();
    const result = await runAuthorizedInteraction(baseParams("你好，今天天气怎么样？", budgetMs), {
      session: { authorize, dispose } as never,
      authorization: { agentId: "bot", queueMaxWaitMs: budgetMs },
      prepare: vi.fn(),
      candidate: vi.fn(),
      admission: {
        captured,
        ports: {
          authorize: vi.fn(async () => true),
          commit: vi.fn(() => {
            throw new Error("ordinary query must not commit the board");
          }),
        },
      },
    });
    const waitedMs = Date.now() - started;
    expect(waitedMs).toBeGreaterThanOrEqual(budgetMs);
    expect(waitedMs).toBeLessThan(budgetMs + 400);
    expect(result).toEqual({
      kind: "respond",
      text: INTERACTION_QUEUE_TIMEOUT_TEXT,
      clarification: false,
    });
    expect(authorize).toHaveBeenCalledOnce();
    expect(authorize.mock.calls[0]?.[0]).toMatchObject({ queueMaxWaitMs: budgetMs });
    expect(dispose).toHaveBeenCalledOnce();
    expect(await fs.stat(board).then(
      () => true,
      () => false,
    )).toBe(false);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

it("S1-B / I-T1: empty-output timeout still yields a terminal that attests no business execution", async () => {
  const dispose = vi.fn(async () => undefined);
  const storeDir = await fs.mkdtemp(path.join(os.tmpdir(), "s1-b-terminal-"));
  try {
    const result = await runAuthorizedInteraction(baseParams("继续"), {
      session: {
        authorize: vi.fn(async () => ({ acquired: true, skipped: false })),
        dispose,
      } as never,
      authorization: { agentId: "bot", queueMaxWaitMs: 50 },
      prepare: () => {
        throw Object.assign(new Error("本轮未取得有效的交互决定，没有启动或修改任务。"), {
          interactionPhase: "interpretation",
          reason: "empty",
        });
      },
      candidate: vi.fn(),
      admission: { captured, ports: { authorize: vi.fn(), commit: vi.fn() } },
    });
    expect(result).toEqual({
      kind: "respond",
      text: INTERACTION_TIMEOUT_TEXT,
      clarification: false,
    });
    expect(INTERACTION_TIMEOUT_TEXT).toContain("没有启动或修改任务");
    const persisted = await persistRejectedInteractionTurn({
      error: Object.assign(new Error("timeout"), {
        interactionPhase: "interpretation",
        reason: "timeout",
      }),
      runId: "run-s1b",
      sessionKey: "sess-s1b",
      storeDir,
      append: async () => ({ ok: true }),
    });
    expect(persisted).toEqual({ persisted: true, text: INTERACTION_TIMEOUT_TEXT });
    expect(readChatTurnTerminal("run-s1b", storeDir, "sess-s1b")).toMatchObject({
      runId: "run-s1b",
      persistedToTranscript: true,
      businessExecution: "none",
      recordTemporarilyUnavailable: false,
      text: INTERACTION_TIMEOUT_TEXT,
    });
    expect(dispose).toHaveBeenCalledOnce();
  } finally {
    await fs.rm(storeDir, { recursive: true, force: true });
  }
});

it("S1-C / I-T2: after a model failure the lease is released, the failed turn is not marked completed, and the next message can be answered", async () => {
  let held = false;
  const session = {
    async authorize() {
      if (held) {
        throw new Error("previous interaction still holds the lease");
      }
      held = true;
      return { acquired: true as const, skipped: false as const };
    },
    async dispose() {
      held = false;
    },
    infer: vi.fn(async () => ({
      provider: "test",
      model: "test",
      attempts: [],
      result: {
        response: { usage: { input: 1, output: 1 } },
        readDecision: () => ({ kind: "reply" as const, text: "你好，我在。" }),
      },
    })),
    recordUsage: vi.fn(async () => undefined),
  };
  const first = await runAuthorizedInteraction(baseParams("先问一件事"), {
    session: {
      authorize: session.authorize,
      dispose: session.dispose,
    } as never,
    authorization: { agentId: "bot" },
    prepare: () => {
      throw Object.assign(new Error("provider 502"), {
        name: "FailoverError",
        interactionPhase: "interpretation",
        reason: "unknown",
      });
    },
    candidate: vi.fn(),
    admission: { captured, ports: { authorize: vi.fn(), commit: vi.fn() } },
  });
  expect(first).toEqual({
    kind: "respond",
    text: INTERACTION_MODEL_FAILURE_TEXT,
    clarification: false,
  });
  expect(INTERACTION_MODEL_FAILURE_TEXT).toContain("没有启动或修改任务");
  expect(INTERACTION_MODEL_FAILURE_TEXT).not.toContain("已完成");
  expect(held).toBe(false);

  const admissionAuthorize = vi.fn();
  const admissionCommit = vi.fn();
  const second = await runAuthorizedInteraction(baseParams("你好"), {
    session: session as never,
    authorization: { agentId: "bot" },
    prepare: vi.fn(),
    candidate: vi.fn(),
    admission: { captured, ports: { authorize: admissionAuthorize, commit: admissionCommit } },
  });
  expect(second).toMatchObject({ kind: "respond", text: "你好，我在。" });
  expect(admissionAuthorize).not.toHaveBeenCalled();
  expect(admissionCommit).not.toHaveBeenCalled();
  expect(held).toBe(false);
});

it("S1-D / I-E1: a persistence outage is not claimed durable; after recovery the original runId is reconciled", async () => {
  const storeDir = await fs.mkdtemp(path.join(os.tmpdir(), "s1-d-receipt-"));
  try {
    const notice = formatRestrictedInteractionNotice({
      mode: "restricted",
      reasons: ["transcript_unavailable"],
    });
    expect(notice).toContain(INTERACTION_RECORD_UNAVAILABLE_TEXT);
    expect(notice).toContain("本条消息不会启动或变更任务");

    const written: string[] = [];
    const first = await persistRejectedInteractionTurn({
      error: Object.assign(new Error("timeout"), {
        interactionPhase: "interpretation",
        reason: "timeout",
      }),
      runId: "run-s1d",
      sessionKey: "sess-s1d",
      storeDir,
      append: async () => {
        throw new Error("disk error");
      },
    });
    expect(first.persisted).toBe(false);
    expect(first.recordTemporarilyUnavailable).toBe(true);
    expect(first.text).toContain(INTERACTION_TIMEOUT_TEXT);
    expect(first.text).toContain(INTERACTION_RECORD_UNAVAILABLE_TEXT);
    const sidecar = readChatTurnTerminal("run-s1d", storeDir, "sess-s1d");
    expect(sidecar).toMatchObject({
      runId: "run-s1d",
      sessionKey: "sess-s1d",
      persistedToTranscript: false,
      businessExecution: "none",
      recordTemporarilyUnavailable: true,
    });

    const recovered = await reconcileChatTurnTerminal({
      runId: "run-s1d",
      sessionKey: "sess-s1d",
      storeDir,
      append: async (message, key) => {
        written.push(`${key}:${message}`);
        return { ok: true };
      },
    });
    expect(recovered.reconciled).toBe(true);
    expect(written).toHaveLength(1);
    expect(written[0]).toContain("run-s1d:interaction-rejected");
    expect(readChatTurnTerminal("run-s1d", storeDir, "sess-s1d")).toMatchObject({
      persistedToTranscript: true,
      recordTemporarilyUnavailable: false,
    });
  } finally {
    await fs.rm(storeDir, { recursive: true, force: true });
  }
});

it("S1-E: an ordinary query does not change the board and causes zero business execution", async () => {
  const authorize = vi.fn();
  const commit = vi.fn();
  const result = await routeInteraction({ message: "你好，现在几点？", context: [] }, captured, {
    inference: { infer: async () => ({ kind: "reply", text: "现在无法改任务，这是普通问答。" }) },
    admission: { authorize, commit },
  });
  expect(result).toMatchObject({ kind: "respond", text: "现在无法改任务，这是普通问答。" });
  expect(authorize).not.toHaveBeenCalled();
  expect(commit).not.toHaveBeenCalled();
});

it("I-E1: a post-admission tool error gets a queryable unconfirmed receipt and must not claim no execution", async () => {
  const storeDir = await fs.mkdtemp(path.join(os.tmpdir(), "s1-e1-tool-"));
  try {
    const result = await persistRejectedInteractionTurn({
      error: new Error("tool failed after send"),
      runId: "run-tool",
      sessionKey: "sess-tool",
      storeDir,
      append: async () => ({ ok: true }),
    });
    expect(result).toEqual({ persisted: true, text: CHAT_TURN_ERROR_UNCONFIRMED_TEXT });
    expect(result.text).not.toMatch(/没有启动新任务|没有启动或修改任务/);
    expect(readChatTurnTerminal("run-tool", storeDir, "sess-tool")).toMatchObject({
      businessExecution: "unknown",
      persistedToTranscript: true,
    });
  } finally {
    await fs.rm(storeDir, { recursive: true, force: true });
  }
});
