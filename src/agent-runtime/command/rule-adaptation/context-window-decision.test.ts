import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ shadow: vi.fn(), activate: vi.fn() }));
vi.mock("./official-shadow.js", () => ({ runOfficialShadowRuleAdaptation: mocks.shadow }));
vi.mock("./activate.js", () => ({ activateApprovedRuntimeRuleProposal: mocks.activate }));
import { decideDynamicContextWindow } from "./context-window-decision.js";
const input = () => ({
  decisionId: "run:context",
  originalTokens: 32000,
  request: { requestId: "message", situation: { summary: "fixture" } },
  host: {} as never,
  activationBinding: { trusted: "independent" },
  activation: { sessionFile: "/tmp/fixture" },
});
beforeEach(() => {
  vi.resetAllMocks();
  mocks.shadow.mockResolvedValue({
    outcomeCode: "shadow_recorded",
    validation: { resultKind: "shadow_accepted" },
    controlUnchanged: true,
    proposal: { proposal: "fixture" },
  });
  mocks.activate.mockReturnValue({
    resultKind: "activated",
    authorizationAssessment: "host_authorized",
    snapshot: {
      status: "effective",
      catalogVersion: "v1",
      policyHash: "hash",
      items: [
        {
          ruleId: "model.context_window.guard",
          field: "agents.defaults.contextTokens",
          parameter: 24000,
        },
      ],
    },
  });
});
it("converts only authorized CAS output into a frozen execution view", async () => {
  const params = input();
  const result = await decideDynamicContextWindow(params);
  expect(result.effectiveTokens).toBe(24000);
  expect(Object.isFrozen(result)).toBe(true);
  expect(mocks.activate).toHaveBeenCalledWith(
    { proposal: "fixture" },
    params.activationBinding,
    params.activation,
  );
});
it("does not CAS a validator rejection", async () => {
  mocks.shadow.mockResolvedValue({ outcomeCode: "validator_blocked" });
  await expect(decideDynamicContextWindow(input())).rejects.toThrow("validation");
  expect(mocks.activate).not.toHaveBeenCalled();
});
it("does not consume a CAS conflict", async () => {
  mocks.activate.mockReturnValue({ resultKind: "conflict" });
  await expect(decideDynamicContextWindow(input())).rejects.toThrow("CAS");
});
it("cancel between model response and CAS prevents persistence", async () => {
  const controller = new AbortController();
  mocks.shadow.mockImplementation(async () => {
    controller.abort();
    return {};
  });
  await expect(
    decideDynamicContextWindow({
      ...input(),
      request: { ...input().request, signal: controller.signal },
    }),
  ).rejects.toThrow();
  expect(mocks.activate).not.toHaveBeenCalled();
});
