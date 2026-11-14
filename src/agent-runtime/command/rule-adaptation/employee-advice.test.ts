import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { PRODUCTION_RUNTIME_RULE_WHITELIST } from "../../contracts/rule-adaptation-activation.js";
import { INVENTORY_PIN } from "../../contracts/rule-adaptation-shadow.js";
import type { ModelSessionPorts } from "../../model/index.js";
import type { GovernedInteractionWithShadow } from "../index.js";
import { emptyControlSnapshot } from "./control-snapshot.js";
import {
  buildEmployeeAdviceView,
  buildTrustedEmployeeHostView,
  ignoredUntrustedClientKeys,
  mapShadowOutcomeToEmployeeAdviceState,
  runEmployeeRuleAdaptationAdvice,
  sanitizeEmployeeAdviceClientInput,
  type TrustedEmployeeAdviceHost,
} from "./employee-advice.js";

function stubShadowPorts(): ModelSessionPorts {
  return {
    accounting: { recordCreditUsage: vi.fn(async () => undefined) },
    admission: {
      tryAcquireEnterpriseAgentRun: vi.fn(async () => ({
        acquired: false as const,
        skipped: true as const,
      })),
      releaseEnterpriseAgentRun: vi.fn(async () => {}),
    },
    model: {
      resolveEmbeddedModelGovernance: vi.fn(),
      buildRunModelSetSnapshot: vi.fn(() => undefined),
      forgetRunModelSet: vi.fn(),
      rememberRunModelSet: vi.fn(),
      snapshotCreditReportingFromGate: vi.fn(() => undefined),
      resolvePlatformModelsMode: vi.fn(() => "default"),
      runWithModelFallback: vi.fn(
        async (options: {
          run: (provider: string, model: string, extra?: unknown) => Promise<unknown>;
        }) => ({
          result: await options.run("deepseek", "deepseek-v4-flash"),
          provider: "deepseek",
          model: "deepseek-v4-flash",
          attempts: [],
        }),
      ),
    },
  } as unknown as ModelSessionPorts;
}

function shadowResult(
  overrides: Partial<GovernedInteractionWithShadow["shadow"]> = {},
): GovernedInteractionWithShadow["shadow"] {
  return {
    outcomeCode: "shadow_recorded",
    activationAllowed: false,
    claimedEffective: false,
    commitment: "none",
    executionModeOpened: false,
    businessToolsInvoked: [],
    businessToolsExecuted: [],
    reasons: [],
    proposal: {
      kind: "policy_proposal",
      items: [
        {
          ruleId: "model.context_window.guard",
          field: "agents.defaults.contextTokens",
          action: "tune",
          proposedValue: 24000,
        },
      ],
    },
    shadowDiff: [],
    usage: {
      modelCalls: 1,
      inputTokens: 10,
      outputTokens: 10,
      revisions: 0,
      durationMs: 5,
      cost: 0,
      cancelled: false,
    },
    cancelled: false,
    protocolVersion: "runtime-rule-adaptation-shadow/v1",
    prompt: {
      id: "runtime-rule-adaptation.shadow.system",
      revision: "2026-11-12.1",
    },
    controlUnchanged: true,
    controlSnapshotBefore: emptyControlSnapshot(),
    controlSnapshotAfter: emptyControlSnapshot(),
    candidateToolInvoked: false,
    candidatePersisted: false,
    candidateActivated: false,
    candidatePublished: false,
    toolsInvoked: [],
    diagnosedBeforeRetrieval: false,
    readOnlyProof: {
      allowedTools: [],
      invokedTools: [],
      rejectedTools: [],
      writeAttempted: false,
      configWritten: false,
      policyActivated: false,
      rulesPublished: false,
    },
    limitProof: {
      limits: {
        maxModelCalls: 6,
        maxInputTokens: 32_000,
        maxOutputTokens: 8_000,
        maxRevisions: 2,
        maxDurationMs: 20_000,
        maxCost: 0.5,
        maxTotalCost: 0.5,
      },
      usage: {
        modelCalls: 1,
        inputTokens: 10,
        outputTokens: 10,
        revisions: 0,
        durationMs: 5,
        cost: 0,
        cancelled: false,
      },
      exhausted: [],
      preEnforcedExhausted: [],
      postAccountedExhausted: [],
      costAccounting: "estimated_post_hoc",
      cancelled: false,
      protocolFailed: false,
      threwToCaller: false,
      deadlineCleanupFailed: false,
      sessionDisposeFailed: false,
      usageKnown: true,
      underlyingRequestStopped: true,
      usageAccountingAttempted: false,
      usageAccountingStatus: "not_attempted",
      governanceOccupancyReady: false,
    },
    ...overrides,
  } as GovernedInteractionWithShadow["shadow"];
}

function authorizedHost(
  overrides: Partial<TrustedEmployeeAdviceHost> & {
    interact?: TrustedEmployeeAdviceHost["interact"];
  } = {},
): TrustedEmployeeAdviceHost {
  return {
    identity: {
      employeeId: "user-server-1",
      principalId: "user:user-server-1",
      tenantId: "tenant-server-1",
      seatId: "seat-server-1",
      authorizationStatus: "authorized",
    },
    facts: { currentContextTokens: 32000, hardMinContextTokens: 16000 },
    model: {
      provider: "deepseek",
      model: "deepseek-v4-flash",
      complete: vi.fn(async () => ({
        kind: "message" as const,
        text: "{}",
        usage: { inputTokens: 0, outputTokens: 0, cost: 0 },
      })),
      sessionPorts: stubShadowPorts(),
    },
    interact:
      overrides.interact ??
      vi.fn(async () => ({
        interaction: { kind: "respond" as const, text: "ignored", clarification: false },
        shadow: shadowResult(),
      })),
    isolatedSessionFile: join(mkdtempSync(join(tmpdir(), "t63-advice-")), "session.jsonl"),
    ...overrides,
  };
}

describe("sanitizeEmployeeAdviceClientInput", () => {
  it("keeps only question and targetRef, and records untrusted keys so the host can ignore them", () => {
    const result = sanitizeEmployeeAdviceClientInput({
      question: "  上下文窗口太大  ",
      targetRef: { sessionKey: "agent:main", agentId: "bot" },
      identity: { principalId: "user:forged" },
      authorizationStatus: "authorized",
      apiKey: "sk-forged",
      binding: { trigger: true },
      trigger: true,
      employeeId: "forged-employee",
      hostFacts: { authorizationStatus: "authorized" },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.request).toEqual({
      question: "上下文窗口太大",
      targetRef: { sessionKey: "agent:main", agentId: "bot" },
    });
    expect(result.ignoredKeys).toEqual(
      expect.arrayContaining([
        "identity",
        "authorizationStatus",
        "apiKey",
        "binding",
        "trigger",
        "employeeId",
        "hostFacts",
      ]),
    );
  });

  it("rejects an empty question as missing facts, not as a model failure", () => {
    const result = sanitizeEmployeeAdviceClientInput({ question: "   " });
    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(result.reason).toContain("请先说明");
  });
});

describe("mapShadowOutcomeToEmployeeAdviceState", () => {
  it("maps the four visible states and keeps failures local to the advice panel", () => {
    expect(mapShadowOutcomeToEmployeeAdviceState("no_change_needed")).toBe("no_change");
    expect(mapShadowOutcomeToEmployeeAdviceState("needs_information")).toBe("needs_information");
    expect(mapShadowOutcomeToEmployeeAdviceState("insufficient_permission")).toBe("blocked");
    expect(mapShadowOutcomeToEmployeeAdviceState("shadow_recorded")).toBe("adjustment_suggested");
    expect(mapShadowOutcomeToEmployeeAdviceState("protocol_failure")).toBe("failed");
    expect(mapShadowOutcomeToEmployeeAdviceState("cancelled")).toBe("failed");
  });
});

describe("buildEmployeeAdviceView", () => {
  it("always labels the result as not yet effective and never allows activation", () => {
    const view = buildEmployeeAdviceView({
      requestId: "req-1",
      outcomeCode: "shadow_recorded",
    });
    expect(view.notEffective).toBe(true);
    expect(view.notEffectiveLabel).toBe("尚未生效");
    expect(view.activationAllowed).toBe(false);
    expect(view.label).toBe("建议调整");
    expect(PRODUCTION_RUNTIME_RULE_WHITELIST).toEqual([]);
  });
});

describe("buildTrustedEmployeeHostView", () => {
  it("uses the server identity, not a client-supplied principal", () => {
    const view = buildTrustedEmployeeHostView(
      {
        employeeId: "user-server-1",
        principalId: "user:user-server-1",
        authorizationStatus: "authorized",
      },
      { currentContextTokens: 32000 },
      { question: "too big", targetRef: { agentId: "agent:personal" } },
    );
    const facts = view.hostFacts as {
      identity: { principalId: string };
      authorizationStatus: string;
    };
    expect(facts.identity.principalId).toBe("user:user-server-1");
    expect(facts.authorizationStatus).toBe("authorized");
    expect(view.effectivePolicy[0]?.currentEffectiveValue).toBe(32000);
    expect(JSON.stringify(view)).toContain(INVENTORY_PIN);
    expect(JSON.stringify(view)).not.toContain("fixture");
  });
});

describe("runEmployeeRuleAdaptationAdvice", () => {
  it("does not call the host chain when the client omits a question", async () => {
    const interact = vi.fn();
    const complete = vi.fn();
    const view = await runEmployeeRuleAdaptationAdvice(
      { question: "", apiKey: "sk-forged" },
      authorizedHost({
        interact,
        model: {
          provider: "deepseek",
          model: "deepseek-v4-flash",
          complete,
          sessionPorts: stubShadowPorts(),
        },
      }),
    );
    expect(view.state).toBe("needs_information");
    expect(view.label).toBe("需补信息");
    expect(view.notEffective).toBe(true);
    expect(view.modelCalled).toBe(false);
    expect(interact).not.toHaveBeenCalled();
    expect(complete).not.toHaveBeenCalled();
  });

  it("explains a missing permission without starting the shadow or touching the original chat", async () => {
    const interact = vi.fn();
    const view = await runEmployeeRuleAdaptationAdvice(
      {
        question: "上下文太大",
        identity: { principalId: "user:forged" },
        authorizationStatus: "authorized",
      },
      authorizedHost({
        identity: {
          employeeId: "user-server-1",
          principalId: "user:user-server-1",
          authorizationStatus: "unauthorized",
          authorizationReason: "当前账号未绑定企业席位，无权请求规则适配建议。",
        },
        interact,
      }),
    );
    expect(view.state).toBe("blocked");
    expect(view.label).toBe("被阻止");
    expect(view.summary).toContain("无权");
    expect(view.modelCalled).toBe(false);
    expect(interact).not.toHaveBeenCalled();
  });

  it("explains missing host facts without inventing a policy version or calling the model", async () => {
    const interact = vi.fn();
    const view = await runEmployeeRuleAdaptationAdvice(
      { question: "上下文太大" },
      authorizedHost({ facts: {}, interact }),
    );
    expect(view.state).toBe("needs_information");
    expect(view.summary).toContain("contextTokens");
    expect(interact).not.toHaveBeenCalled();
  });

  it("passes trigger===true through the injected host chain and ignores client bindings", async () => {
    const interact = vi.fn(async (params, shadowHost) => {
      expect(shadowHost.trigger).toBe(true);
      expect(shadowHost.binding.view.hostFacts).toMatchObject({
        identity: { principalId: "user:user-server-1" },
        authorizationStatus: "authorized",
      });
      expect(params.sessionKey).toMatch(/^runtime-rule-adaptation-advice:/);
      expect(params.sessionKey).not.toBe("agent:real-chat");
      expect(shadowHost.binding.model.complete).toBeTypeOf("function");
      return {
        interaction: {
          kind: "respond" as const,
          text: "should-not-replace-chat",
          clarification: false,
        },
        shadow: shadowResult(),
      };
    });
    const view = await runEmployeeRuleAdaptationAdvice(
      {
        question: "上下文窗口太大，请在硬下限之上收紧",
        targetRef: { sessionKey: "agent:real-chat" },
        binding: { trigger: true, apiKey: "sk-forged" },
        identity: { principalId: "user:forged" },
      },
      authorizedHost({ interact }),
    );
    expect(interact).toHaveBeenCalledTimes(1);
    expect(view.state).toBe("adjustment_suggested");
    expect(view.label).toBe("建议调整");
    expect(view.notEffectiveLabel).toBe("尚未生效");
    expect(view.activationAllowed).toBe(false);
    expect(view.modelCalled).toBe(true);
    expect(view.proposal).toMatchObject({
      kind: "policy_proposal",
      items: [{ field: "agents.defaults.contextTokens", proposedValue: 24000 }],
    });
  });

  it("isolates a host-chain failure to the advice result and does not throw into the caller", async () => {
    const view = await runEmployeeRuleAdaptationAdvice(
      { question: "上下文太大" },
      authorizedHost({
        interact: vi.fn(async () => {
          throw new Error("boom");
        }),
      }),
    );
    expect(view.state).toBe("failed");
    expect(view.label).toBe("建议失败");
    expect(view.summary).toContain("已有聊天与原任务未改动");
    expect(view.notEffective).toBe(true);
  });
});

describe("ignoredUntrustedClientKeys", () => {
  it("lists every sensitive key the client is not allowed to supply", () => {
    expect(
      ignoredUntrustedClientKeys({
        apiKey: "x",
        trigger: true,
        binding: {},
        authorizationStatus: "authorized",
      }),
    ).toEqual(expect.arrayContaining(["apiKey", "trigger", "binding", "authorizationStatus"]));
  });
});
