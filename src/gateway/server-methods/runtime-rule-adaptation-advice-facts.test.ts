import { describe, expect, it } from "vitest";
import {
  createEmployeeAdvicePolicyFactSource,
  resolveEmployeeAdviceApprovedTarget,
  resolveEmployeeAdviceProductionFacts,
  resolveEmployeeAdviceTargetAgentId,
} from "./runtime-rule-adaptation-advice-facts.ts";

const identity = {
  employeeId: "employee-server",
  principalId: "user:employee-server",
  tenantId: "tenant-1",
  seatId: "seat-1",
  authorizationStatus: "authorized" as const,
};

function configWithAgent() {
  return {
    agents: {
      defaults: { contextTokens: 32000 },
      list: [{ id: "personal-bot" }],
    },
    models: {
      providers: {
        deepseek: {
          models: [{ id: "deepseek-v4-flash", contextWindow: 64000 }],
        },
      },
    },
  } as never;
}

describe("resolveEmployeeAdviceTargetAgentId", () => {
  it("uses a parsed session key or a valid agentId and does not fall back to the default agent", () => {
    expect(resolveEmployeeAdviceTargetAgentId({ sessionKey: "agent:personal-bot:chat" })).toEqual({
      ok: true,
      agentId: "personal-bot",
      sessionKey: "agent:personal-bot:chat",
    });
    expect(resolveEmployeeAdviceTargetAgentId({ agentId: "personal-bot" })).toEqual({
      ok: true,
      agentId: "personal-bot",
    });
    expect(resolveEmployeeAdviceTargetAgentId({ sessionKey: "agent:real-chat" }).ok).toBe(false);
    expect(resolveEmployeeAdviceTargetAgentId({}).ok).toBe(false);
  });

  it("rejects a session key and agentId that do not agree", () => {
    const resolved = resolveEmployeeAdviceTargetAgentId({
      sessionKey: "agent:personal-bot:chat",
      agentId: "other-bot",
    });
    expect(resolved.ok).toBe(false);
    if (!resolved.ok) {
      expect(resolved.reason).toContain("不一致");
    }
  });
});

describe("resolveEmployeeAdviceApprovedTarget", () => {
  it("approves view-and-request-advice access without requiring activation rights", async () => {
    const resolved = await resolveEmployeeAdviceApprovedTarget({
      identity,
      targetRef: { agentId: "personal-bot" },
      config: configWithAgent(),
      checkAgentAccess: async () => ({
        ok: true,
        agentId: "personal-bot",
        tenantId: "tenant-1",
        userId: "employee-server",
        activationAuthorized: false,
      }),
    });
    expect(resolved.targetAuthorization).toBe("approved");
    expect(resolved.approvedTarget?.scopeId).toBe("personal-bot");
  });

  it("denies when view access is refused", async () => {
    const resolved = await resolveEmployeeAdviceApprovedTarget({
      identity,
      targetRef: { agentId: "personal-bot" },
      config: configWithAgent(),
      checkAgentAccess: async () => ({
        ok: false,
        denied: true,
        reason: "当前账号没有查看该目标并请求建议的权限。",
      }),
    });
    expect(resolved.targetAuthorization).toBe("denied");
  });
});

describe("resolveEmployeeAdviceProductionFacts", () => {
  it("leaves compatibility and policy state unset when the source has no record", async () => {
    const facts = await resolveEmployeeAdviceProductionFacts({
      identity,
      targetRef: { agentId: "personal-bot" },
      config: configWithAgent(),
      officialModel: { provider: "deepseek", model: "deepseek-v4-flash" },
      checkAgentAccess: async () => ({
        ok: true,
        agentId: "personal-bot",
        tenantId: "tenant-1",
        userId: "employee-server",
        activationAuthorized: false,
      }),
      policyFactSource: createEmployeeAdvicePolicyFactSource([]),
    });
    expect(facts.targetAuthorization).toBe("approved");
    expect(facts.compatibilityRecord).toBeUndefined();
    expect(facts.expectedPolicyState).toBeUndefined();
    expect(facts.currentContextTokens).toBe(32000);
    expect(facts.modelContextWindow).toBe(64000);
  });

  it("does not treat a config cap alone as the effective value", async () => {
    const facts = await resolveEmployeeAdviceProductionFacts({
      identity,
      targetRef: { agentId: "personal-bot" },
      config: {
        agents: { defaults: { contextTokens: 32000 }, list: [{ id: "personal-bot" }] },
      } as never,
      officialModel: { provider: "deepseek", model: "deepseek-v4-flash" },
      checkAgentAccess: async () => ({
        ok: true,
        agentId: "personal-bot",
        tenantId: "tenant-1",
        userId: "employee-server",
      }),
    });
    expect(facts.configContextTokenCap).toBe(32000);
    expect(facts.modelContextWindow).toBeUndefined();
    expect(facts.currentContextTokens).toBeUndefined();
  });
});
