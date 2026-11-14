import { describe, expect, it, vi } from "vitest";
import { INVENTORY_PIN } from "../../agent-runtime/contracts/rule-adaptation-shadow.js";
import {
  createEmployeeAdviceAbortRegistry,
  defaultResolveApprovedTarget,
  handleRuntimeRuleAdaptationAdvice,
  handleRuntimeRuleAdaptationAdviceCancel,
} from "./runtime-rule-adaptation-advice.ts";
import type { GatewayRequestHandlerOptions } from "./types.ts";

const official = {
  apiKey: "host-key",
  baseUrl: "https://api.deepseek.com",
  model: "deepseek-v4-flash",
  provider: "deepseek",
  envVarName: "DEEPSEEK_API_KEY" as const,
};

const POLICY_VERSION = {
  policyHash: "fixture-policy-hash-aaaa",
  protocolVersion: "1.1",
  compilerRevision: "1.2.0",
};

function client(): GatewayRequestHandlerOptions["client"] {
  return { connect: { minProtocol: 3, maxProtocol: 3 } } as GatewayRequestHandlerOptions["client"];
}

const seatedContext = {
  tenantId: "tenant-1",
  seatId: "seat-1",
  employeeId: "employee-server",
} as never;

function configWithCapOnly() {
  return { agents: { defaults: { contextTokens: 32000 } } } as never;
}

function configWithModelWindow() {
  return {
    agents: { defaults: { contextTokens: 32000 } },
    models: {
      providers: {
        deepseek: {
          models: [{ id: "deepseek-v4-flash", contextWindow: 64000 }],
        },
      },
    },
  } as never;
}

describe("handleRuntimeRuleAdaptationAdvice", () => {
  it("does not invent an effective value or approved target from a seat plus a config cap", async () => {
    const runShadow = vi.fn();
    const advice = await handleRuntimeRuleAdaptationAdvice(
      {
        question: "上下文窗口太大",
        targetRef: { sessionKey: "agent:real-chat", agentId: "client-agent" },
        identity: { principalId: "user:forged" },
        authorizationStatus: "authorized",
        apiKey: "sk-forged",
        binding: { trigger: true, apiKey: "sk-forged" },
      },
      client(),
      {
        loadConfig: configWithCapOnly,
        resolveTrustedContext: async () => seatedContext,
        resolveOfficialModel: () => official,
        runShadow,
      },
    );
    expect(runShadow).not.toHaveBeenCalled();
    expect(advice.state).toBe("needs_information");
    expect(advice.modelCalled).toBe(false);
    expect(advice.notEffective).toBe(true);
    expect(defaultResolveApprovedTarget().targetAuthorization).toBe("unknown");
  });

  it("calls the official shadow entry only after a server-approved target and a real effective value are present", async () => {
    const runShadow = vi.fn(async (request, binding) => {
      expect(request.situation.scope).toEqual({ type: "personal", id: "agent:approved" });
      expect(JSON.stringify(request)).not.toContain("规则适配建议对照回合");
      expect(JSON.stringify(request)).not.toContain("client-agent");
      expect(binding.view.effectivePolicy[0]?.currentEffectiveValue).toBe(32000);
      return {
        outcomeCode: "shadow_recorded",
        activationAllowed: false,
        reasons: [],
        proposal: { kind: "policy_proposal", items: [] },
      } as never;
    });

    const advice = await handleRuntimeRuleAdaptationAdvice(
      {
        question: "上下文窗口太大",
        targetRef: { agentId: "client-agent" },
        identity: { principalId: "user:forged" },
        apiKey: "sk-forged",
      },
      client(),
      {
        loadConfig: configWithModelWindow,
        resolveTrustedContext: async () => seatedContext,
        resolveOfficialModel: () => official,
        resolveApprovedTarget: () => ({
          targetAuthorization: "approved",
          approvedTarget: { agentId: "agent:approved", scopeId: "agent:approved" },
        }),
        runAdvice: async (_params, host) => {
          // The production handler still does not invent compatibility; a
          // test host that already has approved target + effective value can
          // attach a real compatibility record before calling the use case.
          return (
            await import("../../agent-runtime/command/index.js")
          ).runEmployeeRuleAdaptationAdvice(_params, {
            ...host,
            facts: {
              ...host.facts,
              compatibilityRecord: {
                status: "approved_compatible",
                boundImplementationVersion: INVENTORY_PIN,
                boundExpectedPolicyVersion: POLICY_VERSION,
              },
              expectedPolicyState: "active",
              expectedPolicyVersion: POLICY_VERSION,
              hardMinContextTokens: 16000,
            },
          });
        },
        runShadow,
      },
    );

    expect(runShadow).toHaveBeenCalledTimes(1);
    expect(advice.state).toBe("adjustment_suggested");
    expect(advice.notEffective).toBe(true);
    expect(advice.activationAllowed).toBe(false);
  });

  it("blocks a denied target even when the employee has a seat", async () => {
    const runShadow = vi.fn();
    const advice = await handleRuntimeRuleAdaptationAdvice(
      { question: "上下文太大", targetRef: { agentId: "other-bot" } },
      client(),
      {
        loadConfig: configWithModelWindow,
        resolveTrustedContext: async () => seatedContext,
        resolveOfficialModel: () => official,
        resolveApprovedTarget: () => ({
          targetAuthorization: "denied",
          reason: "拥有员工席位也不等于有权调整目标机器人的规则。",
        }),
        runShadow,
      },
    );
    expect(runShadow).not.toHaveBeenCalled();
    expect(advice.state).toBe("blocked");
    expect(advice.summary).toContain("拥有员工席位也不等于有权调整目标机器人的规则");
  });

  it("explains a missing seat without calling the official shadow entry", async () => {
    const runShadow = vi.fn();
    const err = Object.assign(new Error("no seat"), { code: "NO_CURRENT_SEAT" });
    const advice = await handleRuntimeRuleAdaptationAdvice(
      { question: "上下文太大", apiKey: "sk-forged" },
      client(),
      {
        loadConfig: configWithModelWindow,
        resolveTrustedContext: async () => {
          throw err;
        },
        resolveOfficialModel: () => official,
        runShadow,
      },
    );
    expect(runShadow).not.toHaveBeenCalled();
    expect(advice.state).toBe("blocked");
    expect(advice.summary).toContain("未绑定企业席位");
    expect(advice.modelCalled).toBe(false);
  });

  it("explains a missing official model as a permission/availability block", async () => {
    const runShadow = vi.fn();
    const advice = await handleRuntimeRuleAdaptationAdvice({ question: "上下文太大" }, client(), {
      loadConfig: configWithModelWindow,
      resolveTrustedContext: async () => seatedContext,
      resolveOfficialModel: () => null,
      runShadow,
    });
    expect(runShadow).not.toHaveBeenCalled();
    expect(advice.state).toBe("blocked");
    expect(advice.summary).toContain("官方模型");
  });

  it("keeps a shadow throw inside the advice payload", async () => {
    const advice = await handleRuntimeRuleAdaptationAdvice({ question: "上下文太大" }, client(), {
      loadConfig: configWithModelWindow,
      resolveTrustedContext: async () => seatedContext,
      resolveOfficialModel: () => official,
      resolveApprovedTarget: () => ({
        targetAuthorization: "approved",
        approvedTarget: { agentId: "agent:approved", scopeId: "agent:approved" },
      }),
      runAdvice: async (_params, host) => {
        return (
          await import("../../agent-runtime/command/index.js")
        ).runEmployeeRuleAdaptationAdvice(_params, {
          ...host,
          facts: {
            ...host.facts,
            compatibilityRecord: {
              status: "approved_compatible",
              boundImplementationVersion: INVENTORY_PIN,
              boundExpectedPolicyVersion: POLICY_VERSION,
            },
            expectedPolicyState: "active",
            expectedPolicyVersion: POLICY_VERSION,
          },
          runShadow: async () => {
            throw new Error("timeout");
          },
        });
      },
    });
    expect(advice.state).toBe("failed");
    expect(advice.summary).toContain("已有聊天与原任务未改动");
  });
});

describe("handleRuntimeRuleAdaptationAdviceCancel", () => {
  it("aborts the in-flight official shadow call on the server", async () => {
    const registry = createEmployeeAdviceAbortRegistry();
    let released: ((value: never) => void) | undefined;
    const pending = new Promise<never>((resolve) => {
      released = resolve;
    });
    const runShadow = vi.fn(async (request: { signal?: AbortSignal }) => {
      expect(request.signal?.aborted).toBe(false);
      const cancelled = handleRuntimeRuleAdaptationAdviceCancel(
        { requestId: "advice-1" },
        client(),
        {
          resolveTrustedContext: async () => seatedContext,
          abortRegistry: registry,
        },
      );
      await cancelled;
      expect(request.signal?.aborted).toBe(true);
      return {
        outcomeCode: "cancelled",
        activationAllowed: false,
        cancelled: true,
        reasons: [{ code: "cancelled", message: "cancelled" }],
      } as never;
    });

    const advicePromise = handleRuntimeRuleAdaptationAdvice(
      { question: "上下文太大", requestId: "advice-1" },
      client(),
      {
        loadConfig: configWithModelWindow,
        resolveTrustedContext: async () => seatedContext,
        resolveOfficialModel: () => official,
        resolveApprovedTarget: () => ({
          targetAuthorization: "approved",
          approvedTarget: { agentId: "agent:approved", scopeId: "agent:approved" },
        }),
        abortRegistry: registry,
        runAdvice: async (params, host) => {
          const { runEmployeeRuleAdaptationAdvice } =
            await import("../../agent-runtime/command/index.js");
          return runEmployeeRuleAdaptationAdvice(params, {
            ...host,
            facts: {
              ...host.facts,
              compatibilityRecord: {
                status: "approved_compatible",
                boundImplementationVersion: INVENTORY_PIN,
                boundExpectedPolicyVersion: POLICY_VERSION,
              },
              expectedPolicyState: "active",
              expectedPolicyVersion: POLICY_VERSION,
            },
            runShadow,
          });
        },
      },
    );

    const advice = await advicePromise;
    expect(runShadow).toHaveBeenCalledTimes(1);
    expect(advice.outcomeCode).toBe("cancelled");
    expect(advice.state).toBe("failed");
    released?.(null as never);
    void pending;
  });
});
