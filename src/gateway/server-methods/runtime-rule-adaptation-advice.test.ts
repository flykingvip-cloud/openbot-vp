import { describe, expect, it, vi } from "vitest";
import type { OfficialDeepSeekCredential } from "../../agent-runtime/command/index.js";
import { handleRuntimeRuleAdaptationAdvice } from "./runtime-rule-adaptation-advice.ts";
import type { GatewayRequestHandlerOptions } from "./types.ts";

const official: OfficialDeepSeekCredential = {
  apiKey: "host-key",
  baseUrl: "https://api.deepseek.com",
  model: "deepseek-v4-flash",
  provider: "deepseek",
  envVarName: "DEEPSEEK_API_KEY",
};

function client(): GatewayRequestHandlerOptions["client"] {
  return { connect: { minProtocol: 3, maxProtocol: 3 } } as GatewayRequestHandlerOptions["client"];
}

describe("handleRuntimeRuleAdaptationAdvice", () => {
  it("resolves identity on the server and ignores a client-supplied principal, key, and binding", async () => {
    const interact = vi.fn(async (params, shadowHost) => {
      expect(shadowHost.trigger).toBe(true);
      expect(shadowHost.binding.view.hostFacts).toMatchObject({
        identity: { principalId: "user:employee-server" },
        authorizationStatus: "authorized",
      });
      expect(JSON.stringify(shadowHost)).not.toContain("sk-forged");
      expect(JSON.stringify(shadowHost)).not.toContain("user:forged");
      expect(params.sessionKey).toMatch(/^runtime-rule-adaptation-advice:/);
      return {
        interaction: { kind: "respond", text: "must-not-replace-chat", clarification: false },
        shadow: {
          outcomeCode: "shadow_recorded",
          activationAllowed: false,
          reasons: [],
          proposal: { kind: "policy_proposal", items: [] },
        },
      } as never;
    });

    const advice = await handleRuntimeRuleAdaptationAdvice(
      {
        question: "上下文窗口太大",
        targetRef: { sessionKey: "agent:real-chat" },
        identity: { principalId: "user:forged" },
        authorizationStatus: "authorized",
        apiKey: "sk-forged",
        binding: { trigger: true, apiKey: "sk-forged" },
        trigger: true,
      },
      client(),
      {
        loadConfig: () => ({ agents: { defaults: { contextTokens: 32000 } } }) as never,
        resolveTrustedContext: async () =>
          ({
            tenantId: "tenant-1",
            seatId: "seat-1",
            employeeId: "employee-server",
          }) as never,
        resolveOfficialModel: () => official,
        interact,
      },
    );

    expect(interact).toHaveBeenCalledTimes(1);
    expect(advice.state).toBe("adjustment_suggested");
    expect(advice.notEffective).toBe(true);
    expect(advice.activationAllowed).toBe(false);
    expect(advice.notEffectiveLabel).toBe("尚未生效");
  });

  it("explains a missing seat without calling the official model chain", async () => {
    const interact = vi.fn();
    const err = Object.assign(new Error("no seat"), { code: "NO_CURRENT_SEAT" });
    const advice = await handleRuntimeRuleAdaptationAdvice(
      { question: "上下文太大", apiKey: "sk-forged" },
      client(),
      {
        loadConfig: () => ({ agents: { defaults: { contextTokens: 32000 } } }) as never,
        resolveTrustedContext: async () => {
          throw err;
        },
        resolveOfficialModel: () => official,
        interact,
      },
    );
    expect(interact).not.toHaveBeenCalled();
    expect(advice.state).toBe("blocked");
    expect(advice.summary).toContain("未绑定企业席位");
    expect(advice.modelCalled).toBe(false);
  });

  it("explains a missing official model as a permission/availability block", async () => {
    const interact = vi.fn();
    const advice = await handleRuntimeRuleAdaptationAdvice({ question: "上下文太大" }, client(), {
      loadConfig: () => ({ agents: { defaults: { contextTokens: 32000 } } }) as never,
      resolveTrustedContext: async () =>
        ({
          tenantId: "tenant-1",
          seatId: "seat-1",
          employeeId: "employee-server",
        }) as never,
      resolveOfficialModel: () => null,
      interact,
    });
    expect(interact).not.toHaveBeenCalled();
    expect(advice.state).toBe("blocked");
    expect(advice.summary).toContain("官方模型");
  });

  it("keeps a host-chain throw inside the advice payload", async () => {
    const advice = await handleRuntimeRuleAdaptationAdvice({ question: "上下文太大" }, client(), {
      loadConfig: () => ({ agents: { defaults: { contextTokens: 32000 } } }) as never,
      resolveTrustedContext: async () =>
        ({
          tenantId: "tenant-1",
          seatId: "seat-1",
          employeeId: "employee-server",
        }) as never,
      resolveOfficialModel: () => official,
      interact: async () => {
        throw new Error("timeout");
      },
    });
    expect(advice.state).toBe("failed");
    expect(advice.summary).toContain("已有聊天与原任务未改动");
  });
});
