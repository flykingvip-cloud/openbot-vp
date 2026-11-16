import { expect, it, vi } from "vitest";
import { sessionTaskState } from "../../state/index.js";
import {
  recordNormalTaskRuleAdvice,
  type GatewayInteractionParams,
} from "../../wiring/interaction-turn.js";

vi.mock("../../wiring/interaction-candidate.js", () => ({
  bindInteractionCandidate: () => async () => ({ model: { contextWindow: 32000 } }),
}));

const params = {
  config: {},
  agentId: "fixture",
  agentDir: "/tmp/fixture",
  captured: { expectedFocusRevision: 0, expectedWriteEpoch: 0 },
  authorized: true,
  provider: "fixture",
  model: "fixture",
  timeoutMs: 1000,
  runId: "run-fixture",
  requestId: "message-fixture",
  sessionFile: "/tmp/not-read",
  identity: {},
  input: { message: "fixture", context: [] },
} as GatewayInteractionParams;
it("does not start advice for ordinary dialogue", async () => {
  const shadow = vi.fn();
  await recordNormalTaskRuleAdvice(
    params,
    { kind: "respond", text: "hello", clarification: false },
    shadow,
  );
  expect(shadow).not.toHaveBeenCalled();
});
it("does not start advice for rejected admission", async () => {
  const shadow = vi.fn();
  await recordNormalTaskRuleAdvice(
    params,
    { kind: "execution_admission", result: { kind: "rejected", reason: "unauthorized" } },
    shadow,
  );
  expect(shadow).not.toHaveBeenCalled();
});
it("rejects stale binding before resolving credentials or calling the model", async () => {
  const current = vi.spyOn(sessionTaskState, "bindingCurrent").mockReturnValue(false);
  const shadow = vi.fn();
  try {
    await recordNormalTaskRuleAdvice(
      params,
      {
        kind: "execution_admission",
        result: { kind: "accepted", binding: { taskId: "task-fixture" } as never, acceptance: [] },
      },
      shadow,
    );
    expect(shadow).not.toHaveBeenCalled();
    expect(current).toHaveBeenCalledWith(
      params.sessionFile,
      expect.objectContaining({ taskId: "task-fixture" }),
    );
  } finally {
    current.mockRestore();
  }
});

for (const failure of [false, true]) {
  it(`accepted task preserves its result when shadow ${failure ? "throws" : "returns"}`, async () => {
    const current = vi.spyOn(sessionTaskState, "bindingCurrent").mockReturnValue(true);
    const interaction = {
      kind: "execution_admission" as const,
      result: {
        kind: "accepted" as const,
        binding: { taskId: "task-fixture" } as never,
        acceptance: [],
      },
    };
    const before = structuredClone(interaction);
    const shadow = vi.fn(async () => {
      if (failure) {
        throw new Error("provider unavailable");
      }
      return {
        outcomeCode: "no_change_needed",
        activationAllowed: false,
        controlUnchanged: true,
        usage: { modelCalls: 1 },
      } as never;
    });
    try {
      const advice = await recordNormalTaskRuleAdvice(params, interaction, shadow);
      if (failure) {
        expect(advice).toBeUndefined();
      } else {
        expect(advice).toMatchObject({
          currentTokens: 32000,
          result: { outcomeCode: "no_change_needed" },
        });
      }
      expect(shadow).toHaveBeenCalledOnce();
      expect(shadow.mock.calls[0]).toBeDefined();
      expect(interaction).toEqual(before);
    } finally {
      current.mockRestore();
    }
  });
}
it("uses current-turn admission without inventing a persistent task", async () => {
  const current = vi.spyOn(sessionTaskState, "turnAdmissionCurrent").mockReturnValue(true);
  const binding = vi.spyOn(sessionTaskState, "bindingCurrent");
  const shadow = vi.fn(
    async () =>
      ({
        outcomeCode: "no_change_needed",
        controlUnchanged: true,
        usage: { modelCalls: 1 },
      }) as never,
  );
  try {
    const result = await recordNormalTaskRuleAdvice(
      params,
      {
        kind: "execution_admission",
        result: {
          kind: "accepted_turn",
          admission: {
            requestId: params.requestId,
            sessionFile: params.sessionFile,
            goal: "fixture",
            acceptance: ["fixture"],
            focusRevision: 0,
            writeEpoch: 0,
          },
        },
      },
      shadow,
    );
    expect(result?.result.outcomeCode).toBe("no_change_needed");
    expect(shadow).toHaveBeenCalledOnce();
    expect(binding).not.toHaveBeenCalled();
  } finally {
    current.mockRestore();
    binding.mockRestore();
  }
});

it("refuses an unauthorized host before credential resolution", async () => {
  const shadow = vi.fn();
  await recordNormalTaskRuleAdvice(
    { ...params, authorized: false },
    {
      kind: "execution_admission",
      result: {
        kind: "accepted_turn",
        admission: {
          requestId: params.requestId,
          sessionFile: params.sessionFile,
          goal: "fixture",
          acceptance: ["fixture"],
          focusRevision: 0,
          writeEpoch: 0,
        },
      },
    },
    shadow,
  );
  expect(shadow).not.toHaveBeenCalled();
});
