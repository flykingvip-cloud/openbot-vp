/**
 * Chat entry: runAgentTurnWithFallback returns a model result, then bootstrap throws.
 * The embedded runner is stubbed. No external model call.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { FollowupRun } from "../auto-reply/reply/queue.js";
import type { TemplateContext } from "../auto-reply/templating.js";

vi.mock("../agents/pi-embedded.js", () => ({
  abortEmbeddedPiRun: vi.fn(),
  resolveEmbeddedSessionLane: (key: string) => key,
  runEmbeddedPiAgent: vi.fn(async () => ({
    payloads: [{ text: "chat finished" }],
    meta: {
      agentMeta: {
        usage: { input: 2, output: 3, cacheRead: 0, cacheWrite: 0 },
      },
    },
  })),
}));

vi.mock("../agents/bootstrap-budget.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../agents/bootstrap-budget.js")>();
  return {
    ...actual,
    resolveBootstrapWarningSignaturesSeen: (
      report?: Parameters<typeof actual.resolveBootstrapWarningSignaturesSeen>[0],
    ) => {
      if (process.env.OPENBOT_TEST_CHAT_BOOTSTRAP_THROW === "1") {
        const seen = Number(process.env.OPENBOT_TEST_CHAT_BOOTSTRAP_SEEN ?? "0") + 1;
        process.env.OPENBOT_TEST_CHAT_BOOTSTRAP_SEEN = String(seen);
        if (seen > 1) {
          throw new Error("chat bootstrap after model");
        }
      }
      return actual.resolveBootstrapWarningSignaturesSeen(report);
    },
  };
});

const { runAgentTurnWithFallback } = await import("../auto-reply/reply/agent-runner-execution.js");

const rates = { input: 1_000_000, output: 1_000_000, cacheRead: 0, cacheWrite: 0 };
const roots: string[] = [];

afterEach(() => {
  delete process.env.OPENBOT_EXECUTOR_EVIDENCE;
  delete process.env.OPENBOT_TEST_CHAT_BOOTSTRAP_THROW;
  delete process.env.OPENBOT_TEST_CHAT_BOOTSTRAP_SEEN;
  for (const root of roots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

describe("R8 chat entry keeps usage after bootstrap failure", () => {
  it("keeps observed usage and charges the budget once", async () => {
    process.env.OPENBOT_EXECUTOR_EVIDENCE = "1";
    process.env.OPENBOT_TEST_CHAT_BOOTSTRAP_THROW = "1";
    process.env.OPENBOT_TEST_CHAT_BOOTSTRAP_SEEN = "0";
    let failure = "";
    const agentDir = fs.mkdtempSync(path.join(os.tmpdir(), "executor-evidence-r8-chat-"));
    roots.push(agentDir);
    const cfg = {
      agents: {
        list: [{ id: "bot", agentDir, workspace: agentDir }],
      },
      models: { providers: { local: { models: [{ id: "fake", cost: rates }] } } },
    };
    const followupRun = {
      prompt: "hello",
      summaryLine: "hello",
      enqueuedAt: Date.now(),
      run: {
        agentId: "bot",
        sessionId: "session-chat",
        sessionKey: "main",
        messageProvider: "webchat",
        sessionFile: path.join(agentDir, "session.jsonl"),
        workspaceDir: agentDir,
        agentDir,
        config: cfg,
        skillsSnapshot: {},
        provider: "local",
        model: "fake",
        thinkLevel: "off",
        verboseLevel: "off",
        elevatedLevel: "off",
        bashElevated: { enabled: false, allowed: false, defaultLevel: "off" },
        timeoutMs: 1_000,
        blockReplyBreak: "message_end",
      },
    } as unknown as FollowupRun;
    const typingSignals = new Proxy({}, { get: () => () => undefined }) as never;
    await runAgentTurnWithFallback({
      commandBody: "hello",
      followupRun,
      sessionCtx: { Provider: "webchat" } as TemplateContext,
      typingSignals,
      blockReplyPipeline: null,
      blockStreamingEnabled: false,
      resolvedBlockStreamingBreak: "message_end",
      applyReplyToMode: (payload) => payload,
      shouldEmitToolResult: () => false,
      shouldEmitToolOutput: () => false,
      pendingToolTasks: new Set(),
      resetSessionAfterCompactionFailure: async () => false,
      resetSessionAfterRoleOrderingConflict: async () => false,
      isHeartbeat: false,
      sessionKey: "main",
      getActiveSessionEntry: () => undefined,
      resolvedVerboseLevel: "off",
    }).catch((err: unknown) => {
      failure = err instanceof Error ? err.message : String(err);
    });
    const callDir = path.join(agentDir, "task-outcomes", "executor-evidence", "calls");
    const calls = fs.existsSync(callDir)
      ? fs.readdirSync(callDir).map(
          (name) =>
            JSON.parse(fs.readFileSync(path.join(callDir, name), "utf8")) as {
              usage?: { input?: number; output?: number };
            },
        )
      : [];
    expect(calls, failure).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ usage: expect.objectContaining({ input: 2, output: 3 }) }),
      ]),
    );
    const logDir = path.join(agentDir, "task-outcomes", "command-log");
    const spends = fs.existsSync(logDir)
      ? fs
          .readdirSync(logDir)
          .map(
            (name) =>
              JSON.parse(fs.readFileSync(path.join(logDir, name), "utf8")) as {
                commandId?: string;
              },
          )
          .filter(
            (row) => typeof row.commandId === "string" && row.commandId.includes("budget-spend"),
          )
      : [];
    expect(spends).toHaveLength(1);
  });
});
