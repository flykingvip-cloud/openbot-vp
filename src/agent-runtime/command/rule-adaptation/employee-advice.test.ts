import { describe, expect, it, vi } from "vitest";
import { PRODUCTION_RUNTIME_RULE_WHITELIST } from "../../contracts/rule-adaptation-activation.js";
import { INVENTORY_PIN } from "../../contracts/rule-adaptation-shadow.js";
import type { ShadowRunResult } from "../../contracts/rule-adaptation-shadow.js";
import type { ModelSessionPorts } from "../../model/index.js";
import { emptyControlSnapshot } from "./control-snapshot.js";
import {
  buildEmployeeAdviceView,
  buildTrustedEmployeeHostView,
  ignoredUntrustedClientKeys,
  mapShadowOutcomeToEmployeeAdviceState,
  resolveTrustedEffectiveContextTokens,
  runEmployeeRuleAdaptationAdvice,
  sanitizeEmployeeAdviceClientInput,
  type TrustedEmployeeAdviceFacts,
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

const POLICY_VERSION = {
  policyHash: "fixture-policy-hash-aaaa",
  protocolVersion: "1.1",
  compilerRevision: "1.2.0",
};

function completeFacts(
  overrides: Partial<TrustedEmployeeAdviceFacts> = {},
): TrustedEmployeeAdviceFacts {
  return {
    currentContextTokens: 32000,
    currentContextTokenSource: "agentContextTokens",
    modelContextWindow: 64000,
    configContextTokenCap: 32000,
    targetAuthorization: "approved",
    approvedTarget: { agentId: "agent:personal", scopeId: "agent:personal" },
    compatibilityRecord: {
      status: "approved_compatible",
      boundImplementationVersion: INVENTORY_PIN,
      boundExpectedPolicyVersion: POLICY_VERSION,
    },
    expectedPolicyState: "active",
    expectedPolicyVersion: POLICY_VERSION,
    hardMinContextTokens: 16000,
    ...overrides,
  };
}

function shadowResult(overrides: Partial<ShadowRunResult> = {}): ShadowRunResult {
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
  } as ShadowRunResult;
}

function authorizedHost(
  overrides: Partial<TrustedEmployeeAdviceHost> = {},
): TrustedEmployeeAdviceHost {
  return {
    identity: {
      employeeId: "user-server-1",
      principalId: "user:user-server-1",
      tenantId: "tenant-server-1",
      seatId: "seat-server-1",
      authorizationStatus: "authorized",
    },
    facts: completeFacts(),
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
    runShadow: vi.fn(async () => shadowResult()),
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

describe("resolveTrustedEffectiveContextTokens", () => {
  it("does not treat a config cap alone as the effective value", () => {
    expect(resolveTrustedEffectiveContextTokens({ configCap: 32000 })).toMatchObject({
      ok: false,
    });
    expect(resolveTrustedEffectiveContextTokens({ modelWindow: 64000, configCap: 32000 })).toEqual({
      ok: true,
      tokens: 32000,
      source: "agentContextTokens",
    });
    expect(resolveTrustedEffectiveContextTokens({ modelWindow: 64000 })).toEqual({
      ok: true,
      tokens: 64000,
      source: "model",
    });
  });
});

describe("buildTrustedEmployeeHostView", () => {
  it("uses the server identity and approved target, not a client-supplied principal or agentId", () => {
    const view = buildTrustedEmployeeHostView(
      {
        employeeId: "user-server-1",
        principalId: "user:user-server-1",
        authorizationStatus: "authorized",
      },
      completeFacts(),
      { question: "too big", targetRef: { agentId: "client-forged-agent" } },
    );
    const facts = view.hostFacts as {
      identity: { principalId: string; scope?: { id: string } };
      authorizationStatus: string;
      compatibilityRecord?: { status: string };
      expectedPolicyState?: string;
    };
    expect(facts.identity.principalId).toBe("user:user-server-1");
    expect(facts.identity.scope?.id).toBe("agent:personal");
    expect(facts.identity.scope?.id).not.toBe("client-forged-agent");
    expect(facts.authorizationStatus).toBe("authorized");
    expect(view.effectivePolicy[0]?.currentEffectiveValue).toBe(32000);
    expect(facts.compatibilityRecord?.status).toBe("approved_compatible");
    expect(facts.expectedPolicyState).toBe("active");
    expect(JSON.stringify(view)).toContain(INVENTORY_PIN);
  });

  it("does not invent approved_compatible, active state, or a client agentId scope when facts are missing", () => {
    const view = buildTrustedEmployeeHostView(
      {
        employeeId: "user-server-1",
        principalId: "user:user-server-1",
        authorizationStatus: "authorized",
      },
      { currentContextTokens: 32000, configContextTokenCap: 32000 },
      { question: "too big", targetRef: { agentId: "client-forged-agent" } },
    );
    const facts = view.hostFacts as {
      identity: { scope?: { id: string } };
      compatibilityRecord?: unknown;
      expectedPolicyState?: unknown;
    };
    expect(facts.compatibilityRecord).toBeUndefined();
    expect(facts.expectedPolicyState).toBeUndefined();
    expect(facts.identity.scope).toBeUndefined();
    expect(view.effectivePolicy).toEqual([]);
    expect(JSON.stringify(view)).not.toContain("approved_compatible");
    expect(JSON.stringify(view)).not.toContain("client-forged-agent");
  });
});

describe("runEmployeeRuleAdaptationAdvice", () => {
  it("does not call the official shadow entry when the client omits a question", async () => {
    const runShadow = vi.fn();
    const complete = vi.fn();
    const view = await runEmployeeRuleAdaptationAdvice(
      { question: "", apiKey: "sk-forged" },
      authorizedHost({
        runShadow,
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
    expect(runShadow).not.toHaveBeenCalled();
    expect(complete).not.toHaveBeenCalled();
  });

  it("explains a missing permission without starting the shadow or touching the original chat", async () => {
    const runShadow = vi.fn();
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
        runShadow,
      }),
    );
    expect(view.state).toBe("blocked");
    expect(view.label).toBe("被阻止");
    expect(view.summary).toContain("无权");
    expect(view.modelCalled).toBe(false);
    expect(runShadow).not.toHaveBeenCalled();
  });

  it("returns 需补信息 when only a config cap is present, and does not invent compatibility", async () => {
    const runShadow = vi.fn();
    const view = await runEmployeeRuleAdaptationAdvice(
      { question: "上下文太大", targetRef: { agentId: "client-agent" } },
      authorizedHost({
        facts: { currentContextTokens: 32000, configContextTokenCap: 32000 },
        runShadow,
      }),
    );
    expect(view.state).toBe("needs_information");
    expect(view.summary).toMatch(/核准目标|模型窗口/);
    expect(runShadow).not.toHaveBeenCalled();
  });

  it("blocks a denied target even when the employee has a seat", async () => {
    const runShadow = vi.fn();
    const view = await runEmployeeRuleAdaptationAdvice(
      { question: "上下文太大", targetRef: { agentId: "someone-elses-bot" } },
      authorizedHost({
        facts: completeFacts({
          targetAuthorization: "denied",
          approvedTarget: undefined,
          targetAuthorizationReason: "拥有员工席位也不等于有权调整目标机器人的规则。",
        }),
        runShadow,
      }),
    );
    expect(view.state).toBe("blocked");
    expect(view.summary).toContain("拥有员工席位也不等于有权调整目标机器人的规则");
    expect(runShadow).not.toHaveBeenCalled();
  });

  it("calls the official shadow entry directly, never a placeholder contrast turn, and ignores client bindings", async () => {
    const runShadow = vi.fn(async (request, binding) => {
      expect(request.situation.summary).toContain("上下文窗口太大");
      expect(request.situation.scope).toEqual({ type: "personal", id: "agent:personal" });
      expect(JSON.stringify(request)).not.toContain("规则适配建议对照回合");
      expect(JSON.stringify(request)).not.toContain("agent:real-chat");
      expect(binding.view.hostFacts).toMatchObject({
        identity: { principalId: "user:user-server-1", scope: { id: "agent:personal" } },
        authorizationStatus: "authorized",
      });
      expect(binding.model.complete).toBeTypeOf("function");
      return shadowResult();
    });
    const view = await runEmployeeRuleAdaptationAdvice(
      {
        question: "上下文窗口太大，请在硬下限之上收紧",
        targetRef: { sessionKey: "agent:real-chat", agentId: "client-forged-agent" },
        binding: { trigger: true, apiKey: "sk-forged" },
        identity: { principalId: "user:forged" },
      },
      authorizedHost({ runShadow }),
    );
    expect(runShadow).toHaveBeenCalledTimes(1);
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

  it("propagates a client cancel signal to the official shadow entry", async () => {
    const abort = new AbortController();
    abort.abort();
    const runShadow = vi.fn();
    const view = await runEmployeeRuleAdaptationAdvice(
      { question: "上下文太大" },
      authorizedHost({ runShadow, signal: abort.signal }),
    );
    expect(runShadow).not.toHaveBeenCalled();
    expect(view.state).toBe("failed");
    expect(view.outcomeCode).toBe("cancelled");
    expect(view.summary).toContain("已取消");
    expect(view.modelCalled).toBe(false);
  });

  it("aborts an in-flight official shadow call when the host signal is cancelled", async () => {
    const abort = new AbortController();
    let seenSignal: AbortSignal | undefined;
    const runShadow = vi.fn(async (request: { signal?: AbortSignal }) => {
      seenSignal = request.signal;
      abort.abort();
      expect(request.signal?.aborted).toBe(true);
      return shadowResult({ outcomeCode: "cancelled", cancelled: true });
    });
    const view = await runEmployeeRuleAdaptationAdvice(
      { question: "上下文太大" },
      authorizedHost({ runShadow, signal: abort.signal }),
    );
    expect(runShadow).toHaveBeenCalledTimes(1);
    expect(seenSignal?.aborted).toBe(true);
    expect(view.state).toBe("failed");
    expect(view.outcomeCode).toBe("cancelled");
  });

  it("returns an unbound rule explanation without inventing active state or claiming full validation", async () => {
    const runShadow = vi.fn(async (_request, binding) => {
      expect(binding.view.hostFacts.compatibilityRecord).toBeUndefined();
      expect(binding.view.hostFacts.expectedPolicyState).toBeUndefined();
      expect(JSON.stringify(binding.view)).not.toContain("approved_compatible");
      expect(JSON.stringify(binding.view.hostFacts)).not.toContain('"active"');
      return shadowResult({
        outcomeCode: "insufficient_sources",
        reasons: [
          {
            code: "missing_host_fact",
            message: "Host expectedPolicyState is missing.",
            path: "host.expectedPolicyState",
          },
        ],
      });
    });
    const view = await runEmployeeRuleAdaptationAdvice(
      { question: "上下文窗口太大，请在硬下限之上收紧" },
      authorizedHost({
        facts: completeFacts({
          compatibilityRecord: undefined,
          expectedPolicyState: undefined,
          expectedPolicyVersion: undefined,
        }),
        runShadow,
      }),
    );
    expect(runShadow).toHaveBeenCalledTimes(1);
    expect(view.modelCalled).toBe(true);
    expect(view.taskApplicability).toBe("unbound");
    expect(view.proposalFullyValidated).toBe(false);
    expect(view.state).toBe("interpretation_pending");
    expect(view.label).toBe("规则解释／待核验");
    expect(view.state).not.toBe("adjustment_suggested");
    expect(view.label).not.toBe("建议调整");
    expect(view.summary).toContain("不承诺任务适用性的规则解释");
    expect(view.summary).toContain("尚未完整校验");
    expect(view.activationAllowed).toBe(false);
    expect(view.notEffective).toBe(true);
    expect(view.proposal).toMatchObject({
      kind: "policy_proposal",
      items: [{ field: "agents.defaults.contextTokens", proposedValue: 24000 }],
    });
  });

  it("does not show 建议调整 for a structurally illegal proposal when facts are missing", async () => {
    const view = await runEmployeeRuleAdaptationAdvice(
      { question: "上下文窗口太大，请在硬下限之上收紧" },
      authorizedHost({
        facts: completeFacts({
          compatibilityRecord: undefined,
          expectedPolicyState: undefined,
          expectedPolicyVersion: undefined,
        }),
        runShadow: vi.fn(async () =>
          shadowResult({
            outcomeCode: "validator_blocked",
            reasons: [
              {
                code: "structural_invalid_type",
                message: "action is not a defined enum value.",
                path: "proposal.items[0].action",
              },
              {
                code: "structural_missing_binding",
                message: "policy_proposal must bind expectedPolicyVersion.",
                path: "proposal.expectedPolicyVersion",
              },
            ],
          }),
        ),
      }),
    );
    expect(view.state).toBe("blocked");
    expect(view.label).toBe("被阻止");
    expect(view.state).not.toBe("adjustment_suggested");
    expect(view.label).not.toBe("建议调整");
    expect(view.state).not.toBe("interpretation_pending");
    expect(view.outcomeCode).toBe("validator_blocked");
    expect(view.proposalFullyValidated).toBe(false);
    expect(view.activationAllowed).toBe(false);
    expect(view.summary).toContain("action is not a defined enum value");
    expect(view.reasons.some((reason) => reason.code === "unbound_consultation")).toBe(true);
    expect(view.proposal).toMatchObject({
      kind: "policy_proposal",
      items: [{ field: "agents.defaults.contextTokens", proposedValue: 24000 }],
    });
  });

  it("does not show 建议调整 for an unknown rule when facts are missing", async () => {
    const view = await runEmployeeRuleAdaptationAdvice(
      { question: "上下文窗口太大，请在硬下限之上收紧" },
      authorizedHost({
        facts: completeFacts({
          compatibilityRecord: undefined,
          expectedPolicyState: undefined,
          expectedPolicyVersion: undefined,
        }),
        runShadow: vi.fn(async () =>
          shadowResult({
            outcomeCode: "fabricated_rule_id",
            reasons: [
              {
                code: "unknown_rule_id",
                message: "Rule id 'invented.rule' is not in the known catalog.",
                path: "proposal.items[0].ruleId",
              },
            ],
          }),
        ),
      }),
    );
    expect(view.state).toBe("blocked");
    expect(view.label).toBe("被阻止");
    expect(view.state).not.toBe("adjustment_suggested");
    expect(view.label).not.toBe("建议调整");
    expect(view.outcomeCode).toBe("fabricated_rule_id");
    expect(view.proposalFullyValidated).toBe(false);
    expect(view.activationAllowed).toBe(false);
  });

  it("does not show 建议调整 for an out-of-bounds parameter when facts are missing", async () => {
    const view = await runEmployeeRuleAdaptationAdvice(
      { question: "上下文窗口太大，请在硬下限之上收紧" },
      authorizedHost({
        facts: completeFacts({
          compatibilityRecord: undefined,
          expectedPolicyState: undefined,
          expectedPolicyVersion: undefined,
        }),
        runShadow: vi.fn(async () =>
          shadowResult({
            outcomeCode: "hard_rule_conflict",
            reasons: [
              {
                code: "below_hard_min",
                message: "proposedValue 1000 is below hardMin 16000.",
                path: "proposal.items[0].proposedValue",
              },
            ],
          }),
        ),
      }),
    );
    expect(view.state).toBe("blocked");
    expect(view.label).toBe("被阻止");
    expect(view.state).not.toBe("adjustment_suggested");
    expect(view.label).not.toBe("建议调整");
    expect(view.outcomeCode).toBe("hard_rule_conflict");
    expect(view.proposalFullyValidated).toBe(false);
    expect(view.activationAllowed).toBe(false);
  });

  it("keeps a protocol failure as 建议失败 even when a proposal object is present", async () => {
    const view = await runEmployeeRuleAdaptationAdvice(
      { question: "上下文窗口太大，请在硬下限之上收紧" },
      authorizedHost({
        facts: completeFacts({
          compatibilityRecord: undefined,
          expectedPolicyState: undefined,
          expectedPolicyVersion: undefined,
        }),
        runShadow: vi.fn(async () =>
          shadowResult({
            outcomeCode: "protocol_failure",
            reasons: [
              {
                code: "protocol_failure",
                message: "Official completion returned an unusable payload.",
              },
            ],
          }),
        ),
      }),
    );
    expect(view.state).toBe("failed");
    expect(view.label).toBe("建议失败");
    expect(view.state).not.toBe("adjustment_suggested");
    expect(view.label).not.toBe("建议调整");
    expect(view.outcomeCode).toBe("protocol_failure");
    expect(view.activationAllowed).toBe(false);
  });

  it("isolates a shadow failure to the advice result and does not throw into the caller", async () => {
    const view = await runEmployeeRuleAdaptationAdvice(
      { question: "上下文太大" },
      authorizedHost({
        runShadow: vi.fn(async () => {
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
