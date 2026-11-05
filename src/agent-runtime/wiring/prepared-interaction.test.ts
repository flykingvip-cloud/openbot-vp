import type { Api, Model } from "@earendil-works/pi-ai/compat";
import { expect, it, vi } from "vitest";
import { makeZeroUsageSnapshot } from "../../agents/usage.js";
import { runPreparedInteraction } from "../command/prepared-interaction.js";
import { createAuthorizedModelSession } from "../model/index.js";
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
it("answers through governed inference without creating a business task", async () => {
  const host = bindAdmittedTurnHost();
  host.admission.tryAcquireEnterpriseAgentRun = vi.fn(async () => ({
    acquired: false as const,
    skipped: true as const,
  }));
  host.model.runWithModelFallback = vi.fn(async (p) => ({
    result: await p.run("test", "test"),
    provider: "test",
    model: "test",
    attempts: [],
  }));
  host.task.ensureChatTurnTaskOutcome = vi.fn();
  const session = createAuthorizedModelSession("interaction-test", host);
  await session.authorize({});
  session.prepareModelSet({
    config: {},
    routing: host.model.resolveExecutionRoutingFromCapabilityPlan({}),
  });
  calls.complete.mockResolvedValue({
    role: "assistant",
    content: [{ type: "text", text: JSON.stringify({ kind: "reply", text: "你好" }) }],
    usage: makeZeroUsageSnapshot(),
    stopReason: "stop",
  });
  const result = await runPreparedInteraction(
    {
      input: {
        message: "你好",
        context: [
          { role: "system", content: "identity" },
          { role: "user", content: "untrusted knowledge" },
        ],
      },
      config: {},
      provider: "test",
      model: "test",
      timeoutMs: 1000,
      maxTokens: 200,
    },
    session,
    async () => ({ model }),
  );
  expect(result).toEqual({ kind: "reply", text: "你好" });
  expect(calls.complete).toHaveBeenCalledOnce();
  const context = calls.complete.mock.calls[0]?.[1];
  expect(context.tools).toEqual([]);
  expect(context.systemPrompt).toContain("identity");
  expect(context.systemPrompt).not.toContain("untrusted knowledge");
  expect(context.messages[0]).toMatchObject({ role: "user", content: "untrusted knowledge" });
  expect(host.task.ensureChatTurnTaskOutcome).not.toHaveBeenCalled();
  session.dispose();
});
