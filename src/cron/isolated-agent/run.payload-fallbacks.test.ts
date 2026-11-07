import { describe, expect, it } from "vitest";
import {
  makeIsolatedAgentTurnJob,
  makeIsolatedAgentTurnParams,
  setupRunCronIsolatedAgentTurnSuite,
} from "./run.suite-helpers.js";
import {
  loadRunCronIsolatedAgentTurn,
  tryAcquireEnterpriseAgentRunMock,
  releaseEnterpriseAgentRunMock,
  resolveAgentModelFallbacksOverrideMock,
  runWithModelFallbackMock,
} from "./run.test-harness.js";

const runCronIsolatedAgentTurn = await loadRunCronIsolatedAgentTurn();

// ---------- tests ----------

describe("runCronIsolatedAgentTurn — payload.fallbacks", () => {
  setupRunCronIsolatedAgentTurnSuite();

  it("releases quota when routing rejects before model startup", async () => {
    tryAcquireEnterpriseAgentRunMock.mockResolvedValue({
      acquired: true,
      skipped: false,
      enterpriseId: "tenant-test",
      modelGate: {
        capabilityPlan: {
          categoryId: "default",
          executor: "chat_model",
          authorizedModelIds: [],
          executableModelIds: [],
          fallbackModelIds: [],
          preferredModelOrder: [],
          reasons: [],
          classificationSource: "task_text",
          failure: { kind: "no_executable_candidates", message: "No executable candidates" },
        },
      },
    });
    const result = await runCronIsolatedAgentTurn(makeIsolatedAgentTurnParams());
    expect(result.status).toBe("error");
    expect(runWithModelFallbackMock).not.toHaveBeenCalled();
    expect(releaseEnterpriseAgentRunMock).toHaveBeenCalledOnce();
  });

  it.each([
    {
      name: "passes payload.fallbacks as fallbacksOverride when defined",
      payload: {
        kind: "agentTurn",
        message: "test",
        fallbacks: ["anthropic/claude-sonnet-4-6", "openai/gpt-5"],
      },
      expectedFallbacks: ["anthropic/claude-sonnet-4-6", "openai/gpt-5"],
    },
    {
      name: "falls back to agent-level fallbacks when payload.fallbacks is undefined",
      payload: { kind: "agentTurn", message: "test" },
      agentFallbacks: ["openai/gpt-4o"],
      expectedFallbacks: ["openai/gpt-4o"],
    },
    {
      name: "payload.fallbacks=[] disables fallbacks even when agent config has them",
      payload: { kind: "agentTurn", message: "test", fallbacks: [] },
      agentFallbacks: ["openai/gpt-4o"],
      expectedFallbacks: [],
    },
  ])("$name", async ({ payload, agentFallbacks, expectedFallbacks }) => {
    if (agentFallbacks) {
      resolveAgentModelFallbacksOverrideMock.mockReturnValue(agentFallbacks);
    }

    const result = await runCronIsolatedAgentTurn(
      makeIsolatedAgentTurnParams({
        job: makeIsolatedAgentTurnJob({ payload }),
      }),
    );

    expect(result.status).toBe("ok");
    expect(runWithModelFallbackMock).toHaveBeenCalledOnce();
    expect(runWithModelFallbackMock.mock.calls[0][0].fallbacksOverride).toEqual(expectedFallbacks);
  });
});
