import { beforeEach, describe, expect, it, vi } from "vitest";
import { TaskBudgetExceededError } from "../../../task-outcome/runtime-from-runner.js";

const mocks = vi.hoisted(() => ({
  resolveEnterpriseEmbeddedTransport: vi.fn(),
  resolveAgentRunEntitlementScope: vi.fn(),
  resolveCliRunCredential: vi.fn(),
  runCliAgent: vi.fn(),
  recordCliBackendUsage: vi.fn(),
  rememberModelResultUsage: vi.fn((u: unknown) => u),
  usageRetainedForCandidateCharge: vi.fn((noted: unknown) => noted),
}));

vi.mock("../../../gateway/enterprise-model/embedded-transport.js", () => ({
  resolveEnterpriseEmbeddedTransport: (...args: unknown[]) =>
    mocks.resolveEnterpriseEmbeddedTransport(...args),
}));

vi.mock("../../../gateway/model-entitlement/resolve-agent-run-scope.js", () => ({
  resolveAgentRunEntitlementScope: (...args: unknown[]) =>
    mocks.resolveAgentRunEntitlementScope(...args),
}));

vi.mock("../../model/index.js", () => ({
  resolveCliRunCredential: (...args: unknown[]) => mocks.resolveCliRunCredential(...args),
}));

vi.mock("./cli-run.js", () => ({
  runCliAgent: (...args: unknown[]) => mocks.runCliAgent(...args),
}));

vi.mock("../../../agents/cli-backend-usage-attribution.js", () => ({
  recordCliBackendUsage: (...args: unknown[]) => mocks.recordCliBackendUsage(...args),
}));

vi.mock("../../../task-outcome/runtime-from-runner.js", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../../../task-outcome/runtime-from-runner.js")>();
  return {
    ...actual,
    rememberModelResultUsage: (u: unknown) => mocks.rememberModelResultUsage(u),
    usageRetainedForCandidateCharge: (noted: unknown, err: unknown) =>
      mocks.usageRetainedForCandidateCharge(noted, err),
  };
});

import {
  buildBootstrapWarningParams,
  createCandidateUsageCharger,
  resolveCandidateEmbeddedTransport,
  runCliCandidateWithCredential,
} from "./candidate-core.js";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("candidate-core", () => {
  it("resolves enterprise transport and returns spreadable transportFields", async () => {
    mocks.resolveEnterpriseEmbeddedTransport.mockResolvedValue({
      provider: "openai",
      model: "gpt-5.2",
      providerAuthOverride: { kind: "secret", ref: "ref-1" },
      enterpriseRuntimeModelId: "ent/acme/gpt-5.2",
    });

    const { transportFields } = await resolveCandidateEmbeddedTransport({
      provider: "ent/acme",
      model: "gpt-5.2",
      tenantId: "tenant-1",
    });

    expect(transportFields).toEqual({
      provider: "openai",
      model: "gpt-5.2",
      providerAuthOverride: { kind: "secret", ref: "ref-1" },
      enterpriseRuntimeModelId: "ent/acme/gpt-5.2",
    });
  });

  it("charges idempotently, preserves retained usage, and rethrows TaskBudgetExceededError", () => {
    const onCharge = vi.fn();
    const charger = createCandidateUsageCharger({ onCharge });
    charger.noteResultUsage({ input: 10, output: 5 });
    charger.chargeOnce(charger.notedUsage);
    charger.chargeOnce({ input: 99 });
    expect(onCharge).toHaveBeenCalledTimes(1);
    expect(onCharge).toHaveBeenCalledWith({ input: 10, output: 5 });

    const failingCharger = createCandidateUsageCharger({
      onCharge: () => {
        throw new TaskBudgetExceededError("task-1", {
          dimension: "tokens",
          detail: "budget exceeded",
          limit: 10,
          observed: 11,
        });
      },
    });
    expect(() => failingCharger.chargeOnFailure(new Error("boom"))).toThrow(
      TaskBudgetExceededError,
    );
  });

  it("skips failure charge when error is TaskBudgetExceededError or skipCharge is true", () => {
    const onCharge = vi.fn();
    const charger = createCandidateUsageCharger({ onCharge });
    charger.chargeOnFailure(
      new TaskBudgetExceededError("task-1", {
        dimension: "tokens",
        detail: "already over",
        limit: 10,
        observed: 11,
      }),
    );
    charger.chargeOnFailure(new Error("aborted"), { skipCharge: true });
    expect(onCharge).not.toHaveBeenCalled();
  });

  it("executes CLI candidate with credential and records usage attribution", async () => {
    mocks.resolveCliRunCredential.mockResolvedValue({
      credentialEnv: { ANTHROPIC_API_KEY: "secret" },
      usageAttr: { tenantId: "t1", userId: "u1", credentialId: "c1" },
    });
    mocks.runCliAgent.mockResolvedValue({ payloads: [{ text: "ok" }], meta: { durationMs: 1 } });

    const { result } = await runCliCandidateWithCredential({
      credentialInput: {
        agentId: "main",
        provider: "claude-cli",
        model: "sonnet",
        config: {},
      },
      executionId: "run-cli-1",
      runParams: {
        sessionId: "s1",
        sessionFile: "/tmp/s1.jsonl",
        workspaceDir: "/tmp",
        config: {},
        prompt: "hi",
        provider: "claude-cli",
        model: "sonnet",
        timeoutMs: 1000,
        runId: "run-cli-1",
      },
    });

    expect(result.payloads?.[0]?.text).toBe("ok");
    expect(mocks.runCliAgent).toHaveBeenCalledWith(
      expect.objectContaining({ credentialEnv: { ANTHROPIC_API_KEY: "secret" } }),
    );
    expect(mocks.recordCliBackendUsage).toHaveBeenCalledWith({
      tenantId: "t1",
      userId: "u1",
      backendId: "claude-cli",
      credentialId: "c1",
      model: "sonnet",
      executionId: "run-cli-1",
    });
  });

  it("builds bootstrap warning params with latest signature", () => {
    expect(buildBootstrapWarningParams(["w1", "w2"])).toEqual({
      bootstrapPromptWarningSignaturesSeen: ["w1", "w2"],
      bootstrapPromptWarningSignature: "w2",
    });
    expect(buildBootstrapWarningParams([])).toEqual({
      bootstrapPromptWarningSignaturesSeen: [],
      bootstrapPromptWarningSignature: undefined,
    });
  });
});
