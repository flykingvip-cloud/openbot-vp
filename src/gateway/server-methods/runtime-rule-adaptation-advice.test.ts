import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { INVENTORY_PIN } from "../../agent-runtime/contracts/rule-adaptation-shadow.js";
import {
  createEmployeeAdvicePolicyFactSource,
  createOfficialEmployeeAdvicePolicyFactSource,
  resolveEmployeeAdviceProductionFacts,
  resolveEmployeeAdviceSessionFile,
} from "./runtime-rule-adaptation-advice-facts.ts";
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

function configWithKnownAgent(agentId = "personal-bot") {
  return {
    agents: {
      defaults: { contextTokens: 32000 },
      list: [{ id: agentId }],
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

function viewOnlyAccess(agentId = "personal-bot") {
  return async (input: { agentId: string }) => {
    if (input.agentId !== agentId) {
      return { ok: false as const, denied: true, reason: "目标访问被拒绝。" };
    }
    return {
      ok: true as const,
      agentId,
      tenantId: "tenant-1",
      userId: "employee-server",
      activationAuthorized: false,
    };
  };
}

function readablePolicyFacts(agentId = "personal-bot") {
  return createEmployeeAdvicePolicyFactSource([
    {
      tenantId: "tenant-1",
      agentId,
      facts: {
        compatibilityRecord: {
          status: "approved_compatible",
          boundImplementationVersion: INVENTORY_PIN,
          boundExpectedPolicyVersion: POLICY_VERSION,
        },
        expectedPolicyState: "active",
        expectedPolicyVersion: POLICY_VERSION,
        hardMinContextTokens: 16000,
        activationAuthorized: false,
      },
    },
  ]);
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
    expect((await defaultResolveApprovedTarget()).targetAuthorization).toBe("unknown");
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

describe("production fact resolver on the gateway handler", () => {
  it("enters the official shadow entry when the production resolver reads view access and real policy facts", async () => {
    const runShadow = vi.fn(async (request, binding) => {
      expect(request.situation.scope).toEqual({ type: "personal", id: "personal-bot" });
      expect(JSON.stringify(request)).not.toContain("client-agent");
      expect(binding.view.hostFacts.compatibilityRecord).toEqual({
        status: "approved_compatible",
        boundImplementationVersion: INVENTORY_PIN,
        boundExpectedPolicyVersion: POLICY_VERSION,
      });
      expect(binding.view.hostFacts.expectedPolicyState).toBe("active");
      expect(binding.view.effectivePolicy[0]?.currentEffectiveValue).toBe(32000);
      return {
        outcomeCode: "shadow_recorded",
        activationAllowed: false,
        reasons: [],
        proposal: { kind: "policy_proposal", items: [] },
      } as never;
    });

    const advice = await handleRuntimeRuleAdaptationAdvice(
      { question: "上下文窗口太大", targetRef: { sessionKey: "agent:personal-bot:chat" } },
      client(),
      {
        loadConfig: () => configWithKnownAgent(),
        resolveTrustedContext: async () => seatedContext,
        resolveOfficialModel: () => official,
        checkAgentAccess: viewOnlyAccess(),
        policyFactSource: readablePolicyFacts(),
        runShadow,
      },
    );

    expect(runShadow).toHaveBeenCalledTimes(1);
    expect(advice.state).toBe("adjustment_suggested");
    expect(advice.activationAllowed).toBe(false);
    expect(advice.notEffective).toBe(true);
    expect(advice.modelCalled).toBe(true);
  });

  it("returns 需补信息 and does not call the model when the effective window is missing", async () => {
    const runShadow = vi.fn();
    const advice = await handleRuntimeRuleAdaptationAdvice(
      { question: "上下文窗口太大", targetRef: { agentId: "personal-bot" } },
      client(),
      {
        loadConfig: () =>
          ({
            agents: { defaults: { contextTokens: 32000 }, list: [{ id: "personal-bot" }] },
          }) as never,
        resolveTrustedContext: async () => seatedContext,
        resolveOfficialModel: () => official,
        checkAgentAccess: viewOnlyAccess(),
        runShadow,
      },
    );
    expect(runShadow).not.toHaveBeenCalled();
    expect(advice.state).toBe("needs_information");
    expect(advice.modelCalled).toBe(false);
    expect(advice.summary).toMatch(/模型窗口/);
    expect(JSON.stringify(advice)).not.toContain("approved_compatible");
  });

  it("blocks when the employee has no view access to the target", async () => {
    const runShadow = vi.fn();
    const advice = await handleRuntimeRuleAdaptationAdvice(
      { question: "上下文太大", targetRef: { agentId: "personal-bot" } },
      client(),
      {
        loadConfig: () => configWithKnownAgent(),
        resolveTrustedContext: async () => seatedContext,
        resolveOfficialModel: () => official,
        checkAgentAccess: async () => ({
          ok: false,
          denied: true,
          reason: "当前账号没有查看该目标并请求建议的权限。",
        }),
        policyFactSource: readablePolicyFacts(),
        runShadow,
      },
    );
    expect(runShadow).not.toHaveBeenCalled();
    expect(advice.state).toBe("blocked");
    expect(advice.summary).toContain("查看该目标并请求建议的权限");
    expect(advice.modelCalled).toBe(false);
  });

  it("still requests advice when the employee can view the target but may not activate or modify rules", async () => {
    const runShadow = vi.fn(
      async () =>
        ({
          outcomeCode: "shadow_recorded",
          activationAllowed: false,
          reasons: [],
          proposal: { kind: "policy_proposal", items: [] },
        }) as never,
    );
    const advice = await handleRuntimeRuleAdaptationAdvice(
      { question: "上下文窗口太大", targetRef: { agentId: "personal-bot" } },
      client(),
      {
        loadConfig: () => configWithKnownAgent(),
        resolveTrustedContext: async () => seatedContext,
        resolveOfficialModel: () => official,
        checkAgentAccess: viewOnlyAccess(),
        policyFactSource: readablePolicyFacts(),
        runShadow,
      },
    );
    expect(runShadow).toHaveBeenCalledTimes(1);
    expect(advice.state).toBe("adjustment_suggested");
    expect(advice.activationAllowed).toBe(false);
    expect(advice.notEffective).toBe(true);
  });

  it("does not invent approved_compatible or active; it copies only facts from the readable source", async () => {
    const facts = await resolveEmployeeAdviceProductionFacts({
      identity: {
        employeeId: "employee-server",
        principalId: "user:employee-server",
        tenantId: "tenant-1",
        seatId: "seat-1",
        authorizationStatus: "authorized",
      },
      targetRef: { agentId: "personal-bot" },
      config: configWithKnownAgent(),
      officialModel: official,
      checkAgentAccess: viewOnlyAccess(),
      policyFactSource: createEmployeeAdvicePolicyFactSource([
        {
          tenantId: "tenant-1",
          agentId: "personal-bot",
          facts: {
            compatibilityRecord: {
              status: "unapproved",
              boundImplementationVersion: INVENTORY_PIN,
              boundExpectedPolicyVersion: POLICY_VERSION,
            },
            expectedPolicyState: "expired",
            expectedPolicyVersion: POLICY_VERSION,
          },
        },
      ]),
    });
    expect(facts.compatibilityRecord?.status).toBe("unapproved");
    expect(facts.expectedPolicyState).toBe("expired");
    expect(facts.currentContextTokens).toBe(32000);
    expect(facts.modelContextWindow).toBe(64000);
    expect(facts.targetAuthorization).toBe("approved");
  });

  it("resolves an approved target through the default production resolver when view access exists", async () => {
    const resolved = await defaultResolveApprovedTarget({
      identity: {
        employeeId: "employee-server",
        principalId: "user:employee-server",
        tenantId: "tenant-1",
        authorizationStatus: "authorized",
      },
      targetRef: { sessionKey: "agent:personal-bot:chat", agentId: "personal-bot" },
      config: configWithKnownAgent(),
      checkAgentAccess: viewOnlyAccess(),
    });
    expect(resolved.targetAuthorization).toBe("approved");
    expect(resolved.approvedTarget).toEqual({
      agentId: "personal-bot",
      scopeId: "personal-bot",
      sessionKey: "agent:personal-bot:chat",
    });
  });
});

describe("createEmployeeAdviceAbortRegistry", () => {
  it("isolates keys by trusted tenant, employee, and requestId", () => {
    const registry = createEmployeeAdviceAbortRegistry();
    const first = new AbortController();
    const second = new AbortController();
    expect(
      registry.register(
        { tenantId: "tenant-a", employeeId: "employee-1", requestId: "req-1" },
        first,
      ),
    ).toEqual({ accepted: true });
    expect(
      registry.register(
        { tenantId: "tenant-b", employeeId: "employee-1", requestId: "req-1" },
        second,
      ),
    ).toEqual({ accepted: true });
    expect(
      registry.cancel({ tenantId: "tenant-a", employeeId: "employee-1", requestId: "req-1" }),
    ).toBe(true);
    expect(first.signal.aborted).toBe(true);
    expect(second.signal.aborted).toBe(false);
  });

  it("rejects a duplicate in-flight requestId without replacing the running controller", () => {
    const registry = createEmployeeAdviceAbortRegistry();
    const first = new AbortController();
    const second = new AbortController();
    const key = { tenantId: "tenant-1", employeeId: "employee-1", requestId: "req-1" };
    expect(registry.register(key, first)).toEqual({ accepted: true });
    expect(registry.register(key, second)).toEqual({
      accepted: false,
      reason: "duplicate_in_flight",
    });
    expect(first.signal.aborted).toBe(false);
    expect(second.signal.aborted).toBe(false);
    expect(registry.cancel(key)).toBe(true);
    expect(first.signal.aborted).toBe(true);
    expect(second.signal.aborted).toBe(false);
  });

  it("bounds unmatched early-cancel reservations by a cap and evicts the oldest", () => {
    const registry = createEmployeeAdviceAbortRegistry({
      now: () => 1_000,
      reservedLimit: 2,
      reservedTtlMs: 60_000,
    });
    expect(registry.cancel({ tenantId: "tenant-1", employeeId: "e", requestId: "r1" })).toBe(true);
    expect(registry.cancel({ tenantId: "tenant-1", employeeId: "e", requestId: "r2" })).toBe(true);
    expect(registry.cancel({ tenantId: "tenant-1", employeeId: "e", requestId: "r3" })).toBe(true);
    const first = new AbortController();
    const third = new AbortController();
    expect(
      registry.register({ tenantId: "tenant-1", employeeId: "e", requestId: "r1" }, first),
    ).toEqual({ accepted: true });
    expect(first.signal.aborted).toBe(false);
    expect(
      registry.register({ tenantId: "tenant-1", employeeId: "e", requestId: "r3" }, third),
    ).toEqual({ accepted: true, alreadyCancelled: true });
    expect(third.signal.aborted).toBe(true);
  });

  it("expires early-cancel reservations by TTL without a scheduler", () => {
    let now = 1_000;
    const registry = createEmployeeAdviceAbortRegistry({
      now: () => now,
      reservedLimit: 8,
      reservedTtlMs: 100,
    });
    expect(registry.cancel({ tenantId: "tenant-1", employeeId: "e", requestId: "late" })).toBe(
      true,
    );
    now = 1_250;
    const controller = new AbortController();
    expect(
      registry.register({ tenantId: "tenant-1", employeeId: "e", requestId: "late" }, controller),
    ).toEqual({ accepted: true });
    expect(controller.signal.aborted).toBe(false);
  });

  it("refuses to register or cancel without a trusted tenant", () => {
    const registry = createEmployeeAdviceAbortRegistry();
    const controller = new AbortController();
    expect(
      registry.register({ tenantId: "  ", employeeId: "e", requestId: "r1" }, controller),
    ).toEqual({ accepted: false, reason: "missing_identity" });
    expect(registry.cancel({ tenantId: "", employeeId: "e", requestId: "r1" })).toBe(false);
  });
});

describe("default handler with official board facts and HTTP boundary only", () => {
  const tmpDirs: string[] = [];
  const previousStateDir = process.env.OPENBOT_STATE_DIR;
  const previousOperatorId = process.env.OPENBOT_OPERATOR_ID;

  afterEach(() => {
    vi.unstubAllGlobals();
    if (previousStateDir === undefined) {
      delete process.env.OPENBOT_STATE_DIR;
    } else {
      process.env.OPENBOT_STATE_DIR = previousStateDir;
    }
    if (previousOperatorId === undefined) {
      delete process.env.OPENBOT_OPERATOR_ID;
    } else {
      process.env.OPENBOT_OPERATOR_ID = previousOperatorId;
    }
    for (const dir of tmpDirs.splice(0)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  function isolateStateDir(): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "t66-advice-state-"));
    tmpDirs.push(dir);
    process.env.OPENBOT_STATE_DIR = dir;
    delete process.env.OPENBOT_OPERATOR_ID;
    return dir;
  }

  function taskBoardPath(sessionFile: string): string {
    return `${sessionFile}.task-board.json`;
  }

  function writeTaskBoard(sessionFile: string, board: unknown): void {
    fs.writeFileSync(taskBoardPath(sessionFile), `${JSON.stringify(board, null, 2)}\n`, "utf8");
  }

  function officialProposalOutput(): string {
    return JSON.stringify({
      protocolVersion: "runtime-rule-adaptation-shadow/v1",
      intent: "policy_proposal",
      proposal: {
        kind: "policy_proposal",
        scope: { type: "personal", id: "personal-bot" },
        implementationVersion: "9b65109f41dee30b892a6faff493e46e735cab8d",
        expectedPolicyVersion: {
          policyHash: "board-policy-hash-aaaa",
          protocolVersion: "1.1",
          compilerRevision: "1.2.0",
        },
        items: [
          {
            ruleId: "model.context_window.guard",
            field: "agents.defaults.contextTokens",
            action: "tune",
            proposedValue: 24000,
          },
        ],
      },
    });
  }

  function stubOfficialHttp(): ReturnType<typeof vi.fn> {
    const fetchMock = vi.fn(async () => {
      return new Response(
        JSON.stringify({
          choices: [{ message: { content: officialProposalOutput() } }],
          usage: { prompt_tokens: 10, completion_tokens: 20 },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    });
    vi.stubGlobal("fetch", fetchMock);
    return fetchMock;
  }

  const BOARD_POLICY_VERSION = {
    policyHash: "board-policy-hash-aaaa",
    protocolVersion: "1.1",
    compilerRevision: "1.2.0",
  };

  it("returns a consultative suggestion when official board records are readable, without inventing approval", async () => {
    isolateStateDir();
    const sessionKey = "agent:personal-bot:chat";
    const sessionFile = resolveEmployeeAdviceSessionFile({
      agentId: "personal-bot",
      sessionKey,
    });
    expect(sessionFile).toBeTruthy();
    fs.mkdirSync(path.dirname(sessionFile!), { recursive: true });
    fs.writeFileSync(sessionFile!, "", "utf8");
    const boardBefore = {
      current: {
        taskId: "task:existing-1",
        title: "Existing work",
        goalText: "Already admitted",
        unfinished: true,
        stop: { summary: "stop", workspacePaths: [] },
        createdAtMs: 1,
      },
      parked: [],
      focusRevision: 1,
      writeEpoch: 3,
      scope: { tenantId: "tenant-1", userId: "employee-server", sessionId: "chat" },
      runtimeRuleAdaptationByTaskId: {
        "task:existing-1": {
          current: {
            status: "effective",
            operation: "activate",
            taskId: "task:existing-1",
            policyHash: BOARD_POLICY_VERSION.policyHash,
            protocolVersion: BOARD_POLICY_VERSION.protocolVersion,
            compilerRevision: BOARD_POLICY_VERSION.compilerRevision,
            implementationVersion: "9b65109f41dee30b892a6faff493e46e735cab8d",
          },
          history: [],
        },
      },
    };
    writeTaskBoard(sessionFile!, boardBefore);
    const boardBytes = fs.readFileSync(taskBoardPath(sessionFile!), "utf8");
    const fetchMock = stubOfficialHttp();

    const officialFacts = createOfficialEmployeeAdvicePolicyFactSource();
    const copied = await officialFacts.read({
      tenantId: "tenant-1",
      employeeId: "employee-server",
      agentId: "personal-bot",
      sessionKey,
    });
    expect(copied?.expectedPolicyVersion).toEqual(BOARD_POLICY_VERSION);
    expect(copied?.compatibilityRecord).toBeUndefined();
    expect(copied?.expectedPolicyState).toBeUndefined();

    const advice = await handleRuntimeRuleAdaptationAdvice(
      { question: "上下文窗口太大，请在硬下限之上收紧", targetRef: { sessionKey } },
      client(),
      {
        loadConfig: () => configWithKnownAgent(),
        resolveTrustedContext: async () => seatedContext,
        resolveOfficialModel: () => official,
        checkAgentAccess: viewOnlyAccess(),
        env: { DEEPSEEK_API_KEY: "host-key", DEEPSEEK_BASE_URL: "https://api.deepseek.com" },
      },
    );

    expect(fetchMock).toHaveBeenCalled();
    const [, request] = fetchMock.mock.calls[0] as unknown as [string, { body?: string }];
    expect(String(request.body)).toContain("board-policy-hash-aaaa");
    expect(String(request.body)).not.toContain("approved_compatible");
    expect(advice.modelCalled).toBe(true);
    expect(advice.activationAllowed).toBe(false);
    expect(advice.notEffective).toBe(true);
    expect(advice.proposalFullyValidated).toBe(false);
    expect(advice.taskApplicability).toBe("unbound");
    expect(advice.state).toBe("interpretation_pending");
    expect(advice.label).toBe("规则解释／待核验");
    expect(advice.state).not.toBe("adjustment_suggested");
    expect(advice.summary).toContain("不承诺任务适用性的规则解释");
    expect(advice.summary).toContain("尚未完整校验");
    expect(JSON.stringify(advice)).not.toContain("approved_compatible");
    expect(fs.readFileSync(taskBoardPath(sessionFile!), "utf8")).toBe(boardBytes);
  });

  it("does not create a task for an unbound consultation when no board record exists", async () => {
    isolateStateDir();
    const sessionKey = "agent:personal-bot:chat";
    const sessionFile = resolveEmployeeAdviceSessionFile({
      agentId: "personal-bot",
      sessionKey,
    });
    expect(sessionFile).toBeTruthy();
    const fetchMock = stubOfficialHttp();
    const advice = await handleRuntimeRuleAdaptationAdvice(
      {
        question: "上下文窗口太大，请在硬下限之上收紧",
        targetRef: { sessionKey, agentId: "personal-bot" },
      },
      client(),
      {
        loadConfig: () => configWithKnownAgent(),
        resolveTrustedContext: async () => seatedContext,
        resolveOfficialModel: () => official,
        checkAgentAccess: viewOnlyAccess(),
        env: { DEEPSEEK_API_KEY: "host-key", DEEPSEEK_BASE_URL: "https://api.deepseek.com" },
      },
    );
    expect(fetchMock).toHaveBeenCalled();
    expect(advice.modelCalled).toBe(true);
    expect(advice.taskApplicability).toBe("unbound");
    expect(advice.proposalFullyValidated).toBe(false);
    expect(advice.state).toBe("interpretation_pending");
    expect(advice.label).toBe("规则解释／待核验");
    expect(advice.state).not.toBe("adjustment_suggested");
    expect(advice.activationAllowed).toBe(false);
    expect(sessionFile && fs.existsSync(taskBoardPath(sessionFile))).toBe(false);
  });

  it("does not show 建议调整 when the official path returns a structurally illegal proposal without task facts", async () => {
    const runShadow = vi.fn(
      async () =>
        ({
          outcomeCode: "validator_blocked",
          activationAllowed: false,
          reasons: [
            {
              code: "structural_invalid_type",
              message: "action is not a defined enum value.",
              path: "proposal.items[0].action",
            },
          ],
          proposal: {
            kind: "policy_proposal",
            items: [
              { field: "agents.defaults.contextTokens", action: "tighten", proposedValue: 24000 },
            ],
          },
        }) as never,
    );
    const advice = await handleRuntimeRuleAdaptationAdvice(
      { question: "上下文窗口太大，请在硬下限之上收紧", targetRef: { agentId: "personal-bot" } },
      client(),
      {
        loadConfig: () => configWithKnownAgent(),
        resolveTrustedContext: async () => seatedContext,
        resolveOfficialModel: () => official,
        checkAgentAccess: viewOnlyAccess(),
        runShadow,
      },
    );
    expect(runShadow).toHaveBeenCalledTimes(1);
    expect(advice.state).toBe("blocked");
    expect(advice.label).toBe("被阻止");
    expect(advice.state).not.toBe("adjustment_suggested");
    expect(advice.label).not.toBe("建议调整");
    expect(advice.outcomeCode).toBe("validator_blocked");
    expect(advice.proposalFullyValidated).toBe(false);
    expect(advice.taskApplicability).toBe("unbound");
    expect(advice.activationAllowed).toBe(false);
    expect(advice.modelCalled).toBe(true);
  });

  it("returns 需补信息 and does not call the model when required window facts are missing", async () => {
    isolateStateDir();
    const fetchMock = stubOfficialHttp();
    const advice = await handleRuntimeRuleAdaptationAdvice(
      { question: "上下文窗口太大", targetRef: { agentId: "personal-bot" } },
      client(),
      {
        loadConfig: () =>
          ({
            agents: { defaults: { contextTokens: 32000 }, list: [{ id: "personal-bot" }] },
          }) as never,
        resolveTrustedContext: async () => seatedContext,
        resolveOfficialModel: () => official,
        checkAgentAccess: viewOnlyAccess(),
        env: { DEEPSEEK_API_KEY: "host-key", DEEPSEEK_BASE_URL: "https://api.deepseek.com" },
      },
    );
    expect(fetchMock).not.toHaveBeenCalled();
    expect(advice.state).toBe("needs_information");
    expect(advice.modelCalled).toBe(false);
    expect(advice.summary).toMatch(/模型窗口/);
  });
});
