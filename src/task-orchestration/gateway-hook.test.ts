import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { OpenBotConfig } from "../config/config.js";
import {
  considerDispatchFromEnv,
  getLastOrchShadowObservation,
  resetOrchShadowObservation,
} from "./dispatch.js";
import { WEB_READ_SHADOW_ENV } from "./feature.js";
import { ORCH_REASON } from "./reason-codes.js";
import { ORCHESTRATION_LIVE_INVOKE } from "./types.js";
import type { WebReadShadowEvalInput, WebReadShadowPrediction } from "./web-read-shadow-eval.js";

const evalMocks = vi.hoisted(() => ({
  calls: [] as WebReadShadowEvalInput[],
  throwNext: false,
}));

vi.mock("./web-read-shadow-eval.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./web-read-shadow-eval.js")>();
  return {
    ...actual,
    evaluateWebReadShadow: (input: WebReadShadowEvalInput): WebReadShadowPrediction => {
      if (evalMocks.throwNext) {
        evalMocks.throwNext = false;
        throw new Error("predictor boom");
      }
      evalMocks.calls.push(input);
      return actual.evaluateWebReadShadow(input);
    },
  };
});

const { observeOrchestrationConsider, observeWebReadShadowFromChat } =
  await import("./gateway-hook.js");
type SafeWebReadShadowObservation = import("./gateway-hook.js").SafeWebReadShadowObservation;
type WebReadShadowChatInput = import("./gateway-hook.js").WebReadShadowChatInput;

const ORCH_SHADOW = "OPENBOT_CONVERSATION_TASK_ORCH_SHADOW";
const ORCH_DISPATCH = "OPENBOT_CONVERSATION_TASK_ORCH_DISPATCH";
const ORCH_NODE = "OPENBOT_CONVERSATION_TASK_ORCH_NODE";
const ORCH_BROWSER = "OPENBOT_CONVERSATION_TASK_ORCH_BROWSER";
const SECURITY_PROFILE = "OPENBOT_SECURITY_PROFILE";

const SAFE_KEYS = [
  "schemaVersion",
  "profileLabel",
  "decisionClass",
  "kind",
  "reasonCodes",
  "policyGap",
  "evidenceGap",
  "humanGate",
  "predictorCalled",
  "latencyBucketMs",
  "invoke",
  "enqueue",
  "wroteLedger",
  "invokedTool",
  "tenantPresent",
  "utteranceEmpty",
] as const;

const FORBIDDEN_SINK_KEYS = [
  "utterance",
  "url",
  "tenantId",
  "requesterId",
  "conversationId",
  "sessionKey",
  "messageId",
  "caseId",
  "prediction",
  "text",
] as const;

function personalCfg(): OpenBotConfig {
  return { data: { mode: "local" } } as OpenBotConfig;
}

function managedCfg(): OpenBotConfig {
  return {
    data: { mode: "managed" },
    gateway: {
      security: {
        profile: "managed_enterprise",
        tenantExecutionBoundary: "dedicated",
        tenantsRootConfigured: true,
      },
    },
  } as OpenBotConfig;
}

function baseInput(overrides: Partial<WebReadShadowChatInput> = {}): WebReadShadowChatInput {
  return {
    cfg: personalCfg(),
    tenantId: null,
    messageId: "msg-b2-1",
    utterance: "检索公开网页公告",
    ...overrides,
  };
}

function clearFlags(): void {
  delete process.env[ORCH_SHADOW];
  delete process.env[ORCH_DISPATCH];
  delete process.env[ORCH_NODE];
  delete process.env[ORCH_BROWSER];
  delete process.env[WEB_READ_SHADOW_ENV];
  delete process.env.OPENBOT_CONVERSATION_TASK_ACTIVATION;
  delete process.env.OPENBOT_CONVERSATION_TASK_ORCH_TENANT_ALLOWLIST;
  delete process.env[SECURITY_PROFILE];
  delete process.env.OPENBOT_TENANT_EXECUTION_BOUNDARY;
  delete process.env.OPENBOT_TENANTS_ROOT;
}

function enableBothFlags(): void {
  process.env[ORCH_SHADOW] = "1";
  process.env[WEB_READ_SHADOW_ENV] = "1";
}

function enableManagedEnv(): void {
  process.env[SECURITY_PROFILE] = "managed_enterprise";
  process.env.OPENBOT_TENANT_EXECUTION_BOUNDARY = "dedicated";
  process.env.OPENBOT_TENANTS_ROOT = "/var/empty/tenants-placeholder";
}

function assertSafeWhitelist(obs: SafeWebReadShadowObservation): void {
  expect(Object.keys(obs).toSorted()).toEqual([...SAFE_KEYS].toSorted());
  for (const key of FORBIDDEN_SINK_KEYS) {
    expect(obs).not.toHaveProperty(key);
  }
  expect(obs.invoke).toBe(false);
  expect(obs.enqueue).toBe(false);
  expect(obs.wroteLedger).toBe(false);
  expect(obs.invokedTool).toBe(false);
  const serialized = JSON.stringify(obs);
  for (const bad of [
    "https://",
    "tenant-",
    "session:",
    "requester",
    "conversation",
    "caseId",
    "messageId",
  ]) {
    expect(serialized.includes(bad)).toBe(false);
  }
}

describe("observeOrchestrationConsider choke-point", () => {
  afterEach(() => {
    clearFlags();
    resetOrchShadowObservation();
  });

  it("does not throw when flags are OFF", () => {
    expect(() => observeOrchestrationConsider()).not.toThrow();
  });

  it("does not throw when identity is present and flags are OFF", () => {
    expect(() =>
      observeOrchestrationConsider({
        tenantId: "t-int",
        requesterId: "user-1",
        conversationId: "conv-1",
        messageId: "msg-1",
      }),
    ).not.toThrow();
  });

  it("does not throw when orch flags are mistakenly on", () => {
    process.env[ORCH_SHADOW] = "1";
    process.env[ORCH_DISPATCH] = "1";
    process.env.OPENBOT_CONVERSATION_TASK_ACTIVATION = "1";
    expect(() =>
      observeOrchestrationConsider({
        tenantId: "t-int",
        conversationId: "conv-1",
      }),
    ).not.toThrow();
  });

  it("stays dormant: invokedTool false even if dispatch flag is on", () => {
    process.env[ORCH_DISPATCH] = "1";
    process.env.OPENBOT_CONVERSATION_TASK_ACTIVATION = "1";
    const result = considerDispatchFromEnv({
      intent: "recall_memory",
      flags: {
        shadowEnabled: false,
        dispatchEnabled: true,
        nodeEnabled: false,
        browserEnabled: false,
      },
      allowlistEmpty: true,
      tenantId: "t-int",
      requesterId: "user-1",
      conversationId: "conv-1",
      messageId: "msg-1",
    });
    expect(result.invokedTool).toBe(false);
    expect(result.job).toBeNull();
    expect(result.wroteLedger).toBe(false);
    expect(result.createdConversationTask).toBe(false);
    expect(result.tenantId).toBe("t-int");
    expect(result.conversationId).toBe("conv-1");
    expect(result.messageId).toBe("msg-1");
  });

  it("scores routeStep under ORCH_SHADOW only and still does not invoke", () => {
    process.env[ORCH_SHADOW] = "1";
    const result = considerDispatchFromEnv({
      intent: "read_web",
      flags: {
        shadowEnabled: true,
        dispatchEnabled: false,
        nodeEnabled: false,
        browserEnabled: false,
      },
      allowlistEmpty: true,
      tenantId: "t-int",
      conversationId: "conv-1",
      messageId: "msg-1",
    });
    expect(ORCHESTRATION_LIVE_INVOKE).toBe(false);
    expect(result.shadowObserved).toBe(true);
    expect(result.decision.kind).toBe("selected");
    expect(result.decision.surface).toBe("web_read");
    expect(result.loggedReasonCodes).toContain(ORCH_REASON.LADDER_WEB_READ);
    expect(result.invokedTool).toBe(false);
    expect(result.wroteLedger).toBe(false);
    expect(result.job).toBeNull();
    expect(result.decision.invoke).toBe(false);
    expect(result.decision.enqueue).toBe(false);
  });
});

describe("observeWebReadShadowFromChat B2 adapter", () => {
  beforeEach(() => {
    clearFlags();
    resetOrchShadowObservation();
    evalMocks.calls = [];
    evalMocks.throwNext = false;
  });

  afterEach(() => {
    clearFlags();
    resetOrchShadowObservation();
    evalMocks.calls = [];
    evalMocks.throwNext = false;
  });

  it("B2#1 ORCH OFF / child OFF → predictor 0 and legacy probe 0", () => {
    const sink = vi.fn();
    observeWebReadShadowFromChat(baseInput(), sink);
    expect(evalMocks.calls).toHaveLength(0);
    expect(sink).not.toHaveBeenCalled();

    observeOrchestrationConsider({ tenantId: "t-1", messageId: "m-1" });
    expect(getLastOrchShadowObservation()).toBeNull();
  });

  it("B2#2 ORCH ON / child OFF → legacy probe continues; predictor 0", () => {
    process.env[ORCH_SHADOW] = "1";
    const sink = vi.fn();
    observeWebReadShadowFromChat(baseInput(), sink);
    expect(evalMocks.calls).toHaveLength(0);
    expect(sink).not.toHaveBeenCalled();

    observeOrchestrationConsider({ tenantId: "t-1", messageId: "m-legacy" });
    const legacy = getLastOrchShadowObservation();
    expect(legacy).not.toBeNull();
    expect(legacy?.invoke).toBe(false);
    expect(legacy?.enqueue).toBe(false);
  });

  it("B2#3 ORCH ON / child ON → predictor exactly 1; legacy probe still runs", () => {
    enableBothFlags();
    const sink = vi.fn();
    observeWebReadShadowFromChat(baseInput(), sink);
    expect(evalMocks.calls).toHaveLength(1);
    expect(sink).toHaveBeenCalledTimes(1);
    expect(sink.mock.calls[0][0].predictorCalled).toBe(true);

    observeOrchestrationConsider({ tenantId: "t-1", messageId: "m-legacy" });
    expect(getLastOrchShadowObservation()).not.toBeNull();
  });

  it("B2#4 ORCH OFF / child ON → predictor 0 (combination gate)", () => {
    process.env[WEB_READ_SHADOW_ENV] = "1";
    const sink = vi.fn();
    observeWebReadShadowFromChat(baseInput(), sink);
    expect(evalMocks.calls).toHaveLength(0);
    expect(sink).not.toHaveBeenCalled();
  });

  it("B2#5 Profile A + tenant null → observe; echo null; no forged tenant", () => {
    enableBothFlags();
    process.env[SECURITY_PROFILE] = "personal_local";
    const sink = vi.fn();
    observeWebReadShadowFromChat(
      baseInput({ cfg: personalCfg(), tenantId: "forged-tenant-must-be-forced-null" }),
      sink,
    );
    expect(evalMocks.calls).toHaveLength(1);
    const evalInput = evalMocks.calls[0];
    expect(evalInput.profile).toBe("A");
    expect(evalInput.tenantId).toBeNull();
    const obs = sink.mock.calls[0][0] as SafeWebReadShadowObservation;
    expect(obs.profileLabel).toBe("A");
    expect(obs.tenantPresent).toBe(false);
    expect(obs.predictorCalled).toBe(true);
    assertSafeWhitelist(obs);
  });

  it("B2#6 Profile B + missing tenant → safe reject; ONLY FAIL_CLOSED/HUMAN_GATE; predictor 0", () => {
    enableBothFlags();
    enableManagedEnv();
    const sink = vi.fn();
    observeWebReadShadowFromChat(
      baseInput({ cfg: managedCfg(), tenantId: null, utterance: "检索公开网页" }),
      sink,
    );
    expect(evalMocks.calls).toHaveLength(0);
    expect(sink).toHaveBeenCalledTimes(1);
    const obs = sink.mock.calls[0][0] as SafeWebReadShadowObservation;
    expect(obs.profileLabel).toBe("B");
    expect(obs.kind).toBe("reject");
    expect(obs.predictorCalled).toBe(false);
    expect(obs.tenantPresent).toBe(false);
    for (const code of obs.reasonCodes) {
      expect([ORCH_REASON.FAIL_CLOSED, ORCH_REASON.HUMAN_GATE]).toContain(code);
    }
    expect(obs.reasonCodes).toContain(ORCH_REASON.FAIL_CLOSED);
    assertSafeWhitelist(obs);

    sink.mockClear();
    observeWebReadShadowFromChat(baseInput({ cfg: managedCfg(), tenantId: "   " }), sink);
    expect(evalMocks.calls).toHaveLength(0);
    expect(sink.mock.calls[0][0].kind).toBe("reject");
  });

  it("B2#7 server Profile not client-overridable", () => {
    enableBothFlags();
    enableManagedEnv();
    const sink = vi.fn();
    // Client-looking cfg still loses to env managed_enterprise.
    observeWebReadShadowFromChat(
      baseInput({
        cfg: {
          data: { mode: "local" },
          gateway: { security: { profile: "personal_local" } },
        } as OpenBotConfig,
        tenantId: "tenant-server-1",
      }),
      sink,
    );
    expect(evalMocks.calls).toHaveLength(1);
    expect(evalMocks.calls[0].profile).toBe("B");
    expect(sink.mock.calls[0][0].profileLabel).toBe("B");
  });

  it("B2#9 adapter input surface excludes ctx/sessionKey/requesterId/conversationId", () => {
    enableBothFlags();
    const sink = vi.fn();
    const input = baseInput();
    observeWebReadShadowFromChat(input, sink);
    expect(Object.keys(input).toSorted()).toEqual(
      ["cfg", "messageId", "tenantId", "utterance"].toSorted(),
    );
    expect(input).not.toHaveProperty("sessionKey");
    expect(input).not.toHaveProperty("requesterId");
    expect(input).not.toHaveProperty("conversationId");
    expect(input).not.toHaveProperty("ctx");
  });

  it("B2#10 predictor throw is swallowed; no tools; no ledger", () => {
    enableBothFlags();
    evalMocks.throwNext = true;
    const sink = vi.fn();
    expect(() => observeWebReadShadowFromChat(baseInput(), sink)).not.toThrow();
    expect(sink).not.toHaveBeenCalled();
    expect(evalMocks.calls).toHaveLength(0);
  });

  it("B2#11 sink throw does not affect chat", () => {
    enableBothFlags();
    const sink = vi.fn(() => {
      throw new Error("sink boom");
    });
    expect(() => observeWebReadShadowFromChat(baseInput(), sink)).not.toThrow();
    expect(evalMocks.calls).toHaveLength(1);
  });

  it("B2#12 no injected sink → no-throw + predictor once + static safety boundaries", async () => {
    enableBothFlags();
    expect(() => observeWebReadShadowFromChat(baseInput())).not.toThrow();
    expect(evalMocks.calls).toHaveLength(1);
    // No tool / ledger side effects: predictor ran in-process only; no production store.
    expect(ORCHESTRATION_LIVE_INVOKE).toBe(false);
    // Static safety: module must not expose a readable last-observation API.
    const gatewayHook = await import("./gateway-hook.js");
    expect(gatewayHook).not.toHaveProperty("__testing");
    expect(gatewayHook).not.toHaveProperty("getLastSafeDebugObservation");
    expect(gatewayHook).not.toHaveProperty("lastSafeDebugObservation");
    expect(Object.keys(gatewayHook).filter((k) => /last.*observation|safeDebug/i.test(k))).toEqual(
      [],
    );
  });

  it("B2#13 sink whitelist forbids ids/text/urls/prediction", () => {
    enableBothFlags();
    const sink = vi.fn();
    observeWebReadShadowFromChat(
      baseInput({
        utterance: "打开 https://evil.example/secret 只读",
        tenantId: null,
        messageId: "msg-secret-id",
      }),
      sink,
    );
    const obs = sink.mock.calls[0][0] as SafeWebReadShadowObservation;
    assertSafeWhitelist(obs);
    const raw = JSON.stringify(obs);
    expect(raw).not.toMatch(/https?:\/\//);
    expect(raw).not.toContain("evil.example");
    expect(raw).not.toContain("msg-secret-id");
    expect(raw).not.toContain("打开");
  });

  it("B2#14 side-effect fields always false", () => {
    enableBothFlags();
    const sink = vi.fn();
    observeWebReadShadowFromChat(baseInput(), sink);
    const obs = sink.mock.calls[0][0] as SafeWebReadShadowObservation;
    expect(obs.invoke).toBe(false);
    expect(obs.enqueue).toBe(false);
    expect(obs.wroteLedger).toBe(false);
    expect(obs.invokedTool).toBe(false);
  });

  it("B2#15 interleaved A/B requests have no shared mutable sink state", () => {
    enableBothFlags();
    const sinkA = vi.fn();
    const sinkB = vi.fn();
    process.env[SECURITY_PROFILE] = "personal_local";
    observeWebReadShadowFromChat(baseInput({ cfg: personalCfg(), tenantId: null }), sinkA);
    enableManagedEnv();
    observeWebReadShadowFromChat(
      baseInput({ cfg: managedCfg(), tenantId: "tenant-b-1", messageId: "msg-b" }),
      sinkB,
    );
    expect(sinkA).toHaveBeenCalledTimes(1);
    expect(sinkB).toHaveBeenCalledTimes(1);
    expect(sinkA.mock.calls[0][0].profileLabel).toBe("A");
    expect(sinkB.mock.calls[0][0].profileLabel).toBe("B");
    expect(sinkA.mock.calls[0][0]).not.toBe(sinkB.mock.calls[0][0]);
  });

  it("B2#15b no injected sink + interleaved A/B → no module-level last-observation API", async () => {
    enableBothFlags();
    const gatewayHook = await import("./gateway-hook.js");
    expect(gatewayHook).not.toHaveProperty("__testing");
    expect(gatewayHook).not.toHaveProperty("getLastSafeDebugObservation");
    expect(gatewayHook).not.toHaveProperty("resetSafeDebugObservation");
    expect(gatewayHook).not.toHaveProperty("lastSafeDebugObservation");

    // Continuously interleaved A/B with no injected sink — must not throw and must
    // leave no readable module-level last observation (no production store for tests).
    for (let i = 0; i < 8; i++) {
      if (i % 2 === 0) {
        process.env[SECURITY_PROFILE] = "personal_local";
        delete process.env.OPENBOT_TENANT_EXECUTION_BOUNDARY;
        delete process.env.OPENBOT_TENANTS_ROOT;
        expect(() =>
          observeWebReadShadowFromChat(
            baseInput({
              cfg: personalCfg(),
              tenantId: null,
              messageId: `msg-a-${i}`,
            }),
          ),
        ).not.toThrow();
      } else {
        enableManagedEnv();
        expect(() =>
          observeWebReadShadowFromChat(
            baseInput({
              cfg: managedCfg(),
              tenantId: `tenant-b-${i}`,
              messageId: `msg-b-${i}`,
            }),
          ),
        ).not.toThrow();
      }
    }
    // 8 interleaved calls with both gates on → predictor for each (A null-tenant + B valid tenant).
    expect(evalMocks.calls).toHaveLength(8);
    expect(ORCHESTRATION_LIVE_INVOKE).toBe(false);
    // Re-assert: still no readable last-observation surface after interleaved traffic.
    expect(
      Object.keys(gatewayHook).some((k) => /last.*observation|safeDebug|__testing/i.test(k)),
    ).toBe(false);
  });

  it("B2#16 p95 adapter overhead ≤ 10ms", () => {
    enableBothFlags();
    const samples: number[] = [];
    for (let i = 0; i < 40; i++) {
      const sink = vi.fn();
      const t0 = performance.now();
      observeWebReadShadowFromChat(baseInput({ messageId: `msg-p-${i}` }), sink);
      samples.push(performance.now() - t0);
      expect(sink).toHaveBeenCalledTimes(1);
    }
    const sorted = [...samples].toSorted((a, b) => a - b);
    const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil(0.95 * sorted.length) - 1));
    const p50 =
      sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(0.5 * sorted.length) - 1))];
    const p95 = sorted[idx];
    console.log(JSON.stringify({ adapterLatencySamples: samples.length, p50, p95 }));
    expect(p95).toBeLessThanOrEqual(10);
  });

  it("B2#17 kill switch: child off stops predictor; parent off returns to baseline", () => {
    process.env[ORCH_SHADOW] = "1";
    process.env[WEB_READ_SHADOW_ENV] = "1";
    const sink = vi.fn();
    observeWebReadShadowFromChat(baseInput(), sink);
    expect(evalMocks.calls).toHaveLength(1);

    evalMocks.calls = [];
    sink.mockClear();
    process.env[WEB_READ_SHADOW_ENV] = "0";
    observeWebReadShadowFromChat(baseInput(), sink);
    expect(evalMocks.calls).toHaveLength(0);

    process.env[WEB_READ_SHADOW_ENV] = "1";
    delete process.env[ORCH_SHADOW];
    observeWebReadShadowFromChat(baseInput(), sink);
    expect(evalMocks.calls).toHaveLength(0);
  });

  it("B2#18 legacy recall_memory Gate C probe has no regression when child OFF", () => {
    process.env[ORCH_SHADOW] = "1";
    // child intentionally OFF
    observeOrchestrationConsider({
      tenantId: "t-legacy",
      conversationId: "c-1",
      messageId: "m-1",
    });
    const legacy = getLastOrchShadowObservation();
    expect(legacy).not.toBeNull();
    expect(legacy?.surface).toBe("memory");
    expect(legacy?.invoke).toBe(false);
    expect(legacy?.enqueue).toBe(false);
  });

  it("P3 reads this turn's text instead of a hardcoded recall_memory intent", () => {
    process.env[ORCH_SHADOW] = "1";
    observeOrchestrationConsider({
      tenantId: "t-1",
      messageId: "m-web",
      text: "检索公开网页公告",
    });
    expect(getLastOrchShadowObservation()?.surface).toBe("web_read");
    expect(getLastOrchShadowObservation()?.enqueue).toBe(false);
    expect(getLastOrchShadowObservation()?.invoke).toBe(false);
  });

  it("B2#19 fail-closed reason codes ⊆ {FAIL_CLOSED, HUMAN_GATE}", () => {
    enableBothFlags();
    enableManagedEnv();
    const sink = vi.fn();
    observeWebReadShadowFromChat(baseInput({ cfg: managedCfg(), tenantId: null }), sink);
    const codes = sink.mock.calls[0][0].reasonCodes as string[];
    expect(codes.length).toBeGreaterThan(0);
    for (const code of codes) {
      expect([ORCH_REASON.FAIL_CLOSED, ORCH_REASON.HUMAN_GATE]).toContain(code);
    }
  });

  it("B2 managed Profile B with valid tenant calls predictor once", () => {
    enableBothFlags();
    enableManagedEnv();
    const sink = vi.fn();
    observeWebReadShadowFromChat(
      baseInput({ cfg: managedCfg(), tenantId: "tenant-acme", utterance: "检索公开白皮书" }),
      sink,
    );
    expect(evalMocks.calls).toHaveLength(1);
    expect(evalMocks.calls[0].tenantId).toBe("tenant-acme");
    expect(evalMocks.calls[0].profile).toBe("B");
    expect(sink.mock.calls[0][0].tenantPresent).toBe(true);
  });
});
