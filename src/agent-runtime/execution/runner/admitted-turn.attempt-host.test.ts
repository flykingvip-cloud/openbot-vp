/**
 * The admitted turn host collects embedded lifecycle errors on the host event bus.
 * Those events are internal attempts. The candidate terminal is still the settled run.
 */
import { afterEach, expect, it, vi } from "vitest";
import type { FollowupRun } from "../../../auto-reply/reply/queue.js";
import type { TemplateContext } from "../../../auto-reply/templating.js";
import { onAgentEvent } from "../../../infra/agent-events.js";
import { bindAdmittedTurnHost } from "../../wiring/admitted-turn-host.js";
import { runAdmittedTurn } from "../index.js";

const embedded = vi.hoisted(() => vi.fn());
vi.mock("./embedded-run.js", () => ({
  runEmbeddedPiAgent: (...args: unknown[]) => embedded(...args),
}));

afterEach(() => {
  embedded.mockReset();
});

function turnParams() {
  const followupRun = {
    prompt: "hello",
    enqueuedAt: 1,
    run: {
      agentId: "bot",
      sessionId: "session-host",
      sessionKey: "main",
      sessionFile: "/tmp/admitted-attempt-host.jsonl",
      workspaceDir: "/tmp",
      agentDir: "/tmp",
      config: { agents: { list: [{ id: "bot", workspace: "/tmp" }] } },
      skillsSnapshot: {},
      provider: "openai",
      model: "gpt-test",
      thinkLevel: "off",
      verboseLevel: "off",
      timeoutMs: 1_000,
    },
  } as unknown as FollowupRun;
  return {
    commandBody: "hello",
    followupRun,
    sessionCtx: { Provider: "webchat" } as TemplateContext,
    typingSignals: new Proxy({}, { get: () => () => undefined }) as Parameters<
      typeof runAdmittedTurn
    >[0]["typingSignals"],
    blockReplyPipeline: null,
    blockStreamingEnabled: false,
    resolvedBlockStreamingBreak: "message_end" as const,
    applyReplyToMode: (payload: { text?: string }) => payload,
    shouldEmitToolResult: () => false,
    shouldEmitToolOutput: () => false,
    pendingToolTasks: new Set<Promise<void>>(),
    resetSessionAfterCompactionFailure: async () => false,
    resetSessionAfterRoleOrderingConflict: async () => false,
    isHeartbeat: false,
    sessionKey: "main",
    getActiveSessionEntry: () => undefined,
    resolvedVerboseLevel: "off" as const,
  };
}

async function attemptsDuring(run: () => Promise<unknown>) {
  const attempts: Array<{ kind?: string; terminal?: boolean }> = [];
  const stop = onAgentEvent((event) => {
    if (event.stream !== "execution-attempt") {
      return;
    }
    attempts.push({
      kind: typeof event.data.kind === "string" ? event.data.kind : undefined,
      terminal: event.data.terminal === true,
    });
  });
  try {
    const result = await run();
    return { result, attempts };
  } finally {
    stop();
  }
}

it("collects an embedded lifecycle error and still completes when the run recovers", async () => {
  embedded.mockImplementation(async (params: { onAgentEvent?: (evt: unknown) => unknown }) => {
    await params.onAgentEvent?.({ stream: "lifecycle", data: { phase: "error" } });
    return {
      payloads: [{ text: "recovered" }],
      meta: { durationMs: 1, agentMeta: { usage: { input: 1, output: 1 } } },
    };
  });
  const { result, attempts } = await attemptsDuring(() =>
    runAdmittedTurn(turnParams(), bindAdmittedTurnHost()),
  );
  expect(attempts).toEqual([{ kind: "embedded_lifecycle_error", terminal: false }]);
  expect(result).toMatchObject({ kind: "success" });
});

it("collects an embedded lifecycle error when the outer run then fails", async () => {
  embedded.mockImplementation(async (params: { onAgentEvent?: (evt: unknown) => unknown }) => {
    await params.onAgentEvent?.({ stream: "lifecycle", data: { phase: "error" } });
    throw new Error("embedded failed after internal error");
  });
  const { result, attempts } = await attemptsDuring(() =>
    runAdmittedTurn(turnParams(), bindAdmittedTurnHost()),
  );
  expect(attempts.length).toBeGreaterThan(0);
  expect(attempts.every((event) => event.kind === "embedded_lifecycle_error")).toBe(true);
  expect(attempts.every((event) => event.terminal === false)).toBe(true);
  expect(result).not.toMatchObject({ kind: "success" });
});
