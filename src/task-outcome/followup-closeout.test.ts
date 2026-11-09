import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FollowupRun } from "../auto-reply/reply/queue/types.js";
import { createMockTypingController } from "../auto-reply/reply/test-helpers.js";
import { TASK_OUTCOME_STORE_DIRNAME } from "./runtime-from-runner.js";
import { DurableTaskOutcomeStore } from "./store.js";

const runEmbeddedPiAgentMock = vi.fn();
const routeReplyMock = vi.fn();
const isRoutableChannelMock = vi.fn();

vi.mock(
  "../agents/model-fallback.js",
  async () => await import("../test-utils/model-fallback.mock.js"),
);

vi.mock("../agents/pi-embedded.js", () => ({
  queueEmbeddedPiMessage: vi.fn(),
  abortEmbeddedPiRun: vi.fn(),
  runEmbeddedPiAgent: (params: unknown) => runEmbeddedPiAgentMock(params),
}));

vi.mock("../auto-reply/reply/route-reply.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../auto-reply/reply/route-reply.js")>();
  return {
    ...actual,
    isRoutableChannel: (...args: unknown[]) => isRoutableChannelMock(...args),
    routeReply: (...args: unknown[]) => routeReplyMock(...args),
  };
});

vi.mock("../agents/agent-scope.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../agents/agent-scope.js")>();
  return {
    ...actual,
    resolveAgentDir: vi.fn(),
  };
});

import { resolveAgentDir } from "../agents/agent-scope.js";
import { createFollowupRunner } from "../auto-reply/reply/followup-runner.js";

function makeQueued(
  overrides: Partial<FollowupRun> & { run?: Partial<FollowupRun["run"]> } = {},
): FollowupRun {
  const followupItemId = overrides.followupItemId ?? "fu-item-close-1";
  return {
    prompt: "hello",
    summaryLine: "hello",
    enqueuedAt: Date.now(),
    followupItemId,
    parentTaskId: "chat:bot:parent-1",
    originatingTo: "channel:C1",
    ...overrides,
    run: {
      agentId: "bot",
      sessionId: "session",
      sessionKey: "main",
      messageProvider: "whatsapp",
      agentAccountId: "primary",
      sessionFile: "/tmp/session.jsonl",
      workspaceDir: "/tmp",
      config: { agents: { list: [{ id: "bot" }] } } as FollowupRun["run"]["config"],
      skillsSnapshot: {},
      provider: "anthropic",
      model: "claude",
      thinkLevel: "low",
      verboseLevel: "off",
      elevatedLevel: "off",
      bashElevated: { enabled: false, allowed: false, defaultLevel: "off" },
      timeoutMs: 1_000,
      blockReplyBreak: "message_end",
      ...overrides.run,
    },
  } as FollowupRun;
}

describe("askOutcome W1 followup unified closeout through createFollowupRunner", () => {
  let agentDir = "";

  beforeEach(() => {
    agentDir = fs.mkdtempSync(path.join(os.tmpdir(), "fu-to-closeout-"));
    vi.mocked(resolveAgentDir).mockReturnValue(agentDir);
    routeReplyMock.mockReset();
    routeReplyMock.mockResolvedValue({ ok: true });
    isRoutableChannelMock.mockReset();
    isRoutableChannelMock.mockImplementation((channel) => Boolean(channel));
    runEmbeddedPiAgentMock.mockReset();
  });

  afterEach(() => {
    fs.rmSync(agentDir, { recursive: true, force: true });
  });

  it("records stable followup task identity without claiming dispatcher enqueue was delivered", async () => {
    runEmbeddedPiAgentMock.mockResolvedValueOnce({
      payloads: [{ text: "done" }],
      meta: {},
    });
    const runner = createFollowupRunner({
      opts: { onBlockReply: vi.fn(async () => {}) },
      typing: createMockTypingController(),
      typingMode: "instant",
      defaultModel: "anthropic/claude-opus-4-5",
    });
    const itemId = "fu-item-success-stable";
    await runner(makeQueued({ followupItemId: itemId }));

    const store = new DurableTaskOutcomeStore(path.join(agentDir, TASK_OUTCOME_STORE_DIRNAME));
    const taskId = `chat:bot:followup:main:${itemId}`;
    const record = store.loadTask(taskId);
    expect(record).toBeTruthy();
    expect(record?.entrypoint).toBe("chat");
    expect(record?.parentTaskId).toBe("chat:bot:parent-1");
    expect(record?.runs?.some((r) => r.status === "succeeded")).toBe(true);
    expect(record?.delivery.status).toBe("delivery_unknown");
    expect(routeReplyMock).not.toHaveBeenCalled();
  });

  it("records run_failed tip when embedded agent throws", async () => {
    runEmbeddedPiAgentMock.mockRejectedValueOnce(new Error("agent exploded"));
    const runner = createFollowupRunner({
      opts: { onBlockReply: vi.fn(async () => {}) },
      typing: createMockTypingController(),
      typingMode: "instant",
      defaultModel: "anthropic/claude-opus-4-5",
    });
    const itemId = "fu-item-fail-stable";
    await runner(makeQueued({ followupItemId: itemId }));

    const store = new DurableTaskOutcomeStore(path.join(agentDir, TASK_OUTCOME_STORE_DIRNAME));
    const taskId = `chat:bot:followup:main:${itemId}`;
    const record = store.loadTask(taskId);
    expect(record).toBeTruthy();
    expect(record?.runs?.some((r) => r.status === "failed")).toBe(true);
  });

  it("replay of same followupItemId does not mint a new unrelated taskId", async () => {
    runEmbeddedPiAgentMock.mockResolvedValue({
      payloads: [{ text: "again" }],
      meta: {},
    });
    const runner = createFollowupRunner({
      opts: { onBlockReply: vi.fn(async () => {}) },
      typing: createMockTypingController(),
      typingMode: "instant",
      defaultModel: "anthropic/claude-opus-4-5",
    });
    const itemId = "fu-item-replay-stable";
    await runner(makeQueued({ followupItemId: itemId }));
    await runner(makeQueued({ followupItemId: itemId }));

    const store = new DurableTaskOutcomeStore(path.join(agentDir, TASK_OUTCOME_STORE_DIRNAME));
    const root = path.join(agentDir, TASK_OUTCOME_STORE_DIRNAME);
    const files = fs.existsSync(root) ? fs.readdirSync(root) : [];
    const taskFiles = files.filter(
      (f) => f.includes("fu-item-replay-stable") || f.endsWith(".json"),
    );
    const taskId = `chat:bot:followup:main:${itemId}`;
    expect(store.loadTask(taskId)).toBeTruthy();
    // Only one task identity for this item (no random sibling tasks for the same queue item).
    const sibling = files.filter((f) => f.includes("fu-item-replay") || f.includes(itemId));
    expect(sibling.length).toBeLessThanOrEqual(2); // task + maybe index
    void taskFiles;
  });
});

vi.mock("../agent-runtime/execution/runner/embedded-run.js", () => ({
  runEmbeddedPiAgent: (params: unknown) => runEmbeddedPiAgentMock(params),
}));
