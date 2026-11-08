import type { Api, Model } from "@earendil-works/pi-ai/compat";
import { expect, it, vi } from "vitest";
import { makeZeroUsageSnapshot } from "../../agents/usage.js";
import { runGovernedInteraction } from "../command/index.js";
import { bindAdmittedTurnHost } from "./admitted-turn-host.js";
const calls = vi.hoisted(() => ({ complete: vi.fn() }));
vi.mock("@earendil-works/pi-ai/compat", async (original) => ({
  ...(await original<typeof import("@earendil-works/pi-ai/compat")>()),
  complete: calls.complete,
}));
const model = {
  id: "test",
  provider: "test",
  api: "openai-completions",
  reasoning: false,
  input: ["text"],
  contextWindow: 8192,
  maxTokens: 1000,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
} as Model<Api>;
it.each([
  ["reply", true],
  ["execution_request", true],
  ["execution_request", false],
] as const)(
  "routes %s with authorization=%s from one governed completion",
  async (kind, authorized) => {
    const host = bindAdmittedTurnHost();
    host.admission.tryAcquireEnterpriseAgentRun = vi.fn(async () => ({
      acquired: true as const,
      skipped: false as const,
      enterpriseId: "tenant",
    }));
    host.model.runWithModelFallback = vi.fn(async (p) => ({
      result: await p.run("test", "test"),
      provider: "test",
      model: "test",
      attempts: [],
    }));
    host.task.ensureChatTurnTaskOutcome = vi.fn();
    host.admission.releaseEnterpriseAgentRun = vi.fn(async () => {});
    host.model.forgetRunModelSet = vi.fn();
    const decision =
      kind === "reply"
        ? { kind, text: "你好" }
        : { kind, request: { goal: "生成报告", acceptance: ["来源可核验"] } };
    const commit = vi.fn(() => ({ kind: "rejected" as const, reason: "stale_revision" }));
    calls.complete.mockClear();
    calls.complete.mockResolvedValue({
      role: "assistant",
      content: [{ type: "text", text: JSON.stringify(decision) }],
      usage: makeZeroUsageSnapshot(),
      stopReason: "stop",
    });
    const result = await runGovernedInteraction(
      {
        input: {
          message: "你好",
          context: [
            { role: "system", content: "identity" },
            { role: "user", content: "untrusted knowledge" },
          ],
        },
        runId: "interaction-test",
        agentId: "bot",
        agentDir: "/tmp/agent",
        sessionFile: "/tmp/session.jsonl",
        requestId: "message-a",
        captured: { expectedFocusRevision: 0, expectedWriteEpoch: 0 },
        identity: { gatewayClientPlatformUserId: "user" },
        authorized,
        config: {},
        provider: "test",
        model: "test",
        timeoutMs: 1000,
      },
      {
        modelSession: host,
        model: host.model,
        resolveFallbacks: () => undefined,
        candidate: async () => ({ model }),
        commit,
      },
    );
    expect(result).toEqual(
      kind === "reply"
        ? { kind: "respond", text: "你好", clarification: false }
        : {
            kind: "execution_admission",
            result: { kind: "rejected", reason: authorized ? "stale_revision" : "unauthorized" },
          },
    );
    expect(commit).toHaveBeenCalledTimes(kind === "execution_request" && authorized ? 1 : 0);
    expect(calls.complete).toHaveBeenCalledOnce();
    const context = calls.complete.mock.calls[0]?.[1];
    expect(context.tools).toEqual([]);
    expect(context.systemPrompt).toContain("identity");
    expect(context.systemPrompt).not.toContain("untrusted knowledge");
    expect(context.messages[0]).toMatchObject({ role: "user", content: "untrusted knowledge" });
    expect(host.task.ensureChatTurnTaskOutcome).not.toHaveBeenCalled();
    expect(host.admission.releaseEnterpriseAgentRun).toHaveBeenCalledOnce();
    expect(host.model.forgetRunModelSet).toHaveBeenCalledOnce();
  },
);
