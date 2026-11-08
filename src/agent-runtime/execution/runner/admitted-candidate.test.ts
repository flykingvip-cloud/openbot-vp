import { beforeEach, describe, expect, it, vi } from "vitest";
import { TaskBudgetExceededError } from "../../../task-outcome/runtime-from-runner.js";
import {
  createAdmittedCandidateInvoker,
  type AdmittedCandidateHost,
} from "./admitted-candidate.js";

const mocks = vi.hoisted(() => ({ cli: vi.fn(), embedded: vi.fn(), event: vi.fn() }));
vi.mock("./cli-run.js", () => ({
  runCliAgent: (...args: unknown[]) => mocks.cli(...args),
}));
vi.mock("./embedded-run.js", () => ({
  runEmbeddedPiAgent: (...args: unknown[]) => mocks.embedded(...args),
}));
vi.mock("../../../gateway/model-entitlement/resolve-agent-run-scope.js", () => ({
  resolveAgentRunEntitlementScope: async () => undefined,
}));
vi.mock("../../../infra/agent-events.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../infra/agent-events.js")>()),
  emitAgentEvent: (...args: unknown[]) => mocks.event(...args),
}));

function setup() {
  const host: AdmittedCandidateHost = {
    assertOriginalTaskCurrent: vi.fn(),
    assertTipBudgetAllowsModelCall: vi.fn(),
    directlySentBlockKeys: new Set(),
    chargeTipBudgetAfterModelCall: vi.fn(),
    notifyAgentRunStart: vi.fn(),
    handlePartialForTyping: vi.fn(async () => undefined),
    normalizeStreamingText: (payload) => ({ text: payload.text, skip: false }),
    normalizeReplyMediaPaths: async (payload) => payload,
    recordGrowthToolResult: vi.fn(),
    recordCommercialToolStart: vi.fn(),
    recordModalityArtifact: vi.fn(),
    markAutoCompactionCompleted: vi.fn(),
    getBootstrapWarnings: () => [],
    setBootstrapWarnings: vi.fn(),
    getModelGate: () => undefined,
    identity: {},
  };
  const params = {
    followupRun: {
      run: {
        agentId: "main",
        config: {},
        provider: "codex-cli",
        sessionId: "session-a",
        sessionFile: "/tmp/candidate-session.jsonl",
        workspaceDir: "/tmp",
        timeoutMs: 1000,
        thinkLevel: "off",
      },
    },
    commandBody: "hello",
    sessionCtx: {},
    getActiveSessionEntry: () => undefined,
    blockReplyPipeline: null,
    opts: {},
    pendingToolTasks: new Set<Promise<void>>(),
  } as unknown as Parameters<typeof createAdmittedCandidateInvoker>[0];
  return { host, invoke: createAdmittedCandidateInvoker(params, "run-a", host) };
}

beforeEach(() => {
  mocks.cli.mockReset();
  mocks.embedded.mockReset();
  mocks.event.mockReset();
});
describe("admitted candidate boundary", () => {
  it("does not invoke either backend when the existing budget port rejects", () => {
    const { host, invoke } = setup();
    vi.mocked(host.assertTipBudgetAllowsModelCall).mockImplementation(() => {
      throw new Error("budget denied");
    });
    expect(() => invoke("codex-cli", "model-a")).toThrow("budget denied");
    expect(mocks.cli).not.toHaveBeenCalled();
    expect(mocks.embedded).not.toHaveBeenCalled();
  });
  it("returns original CLI result and records one successful candidate charge", async () => {
    const { host, invoke } = setup();
    const result = { payloads: [{ text: "result" }], meta: {} };
    mocks.cli.mockResolvedValue(result);
    expect(await invoke("codex-cli", "model-a")).toBe(result);
    expect(host.assertOriginalTaskCurrent).toHaveBeenCalledTimes(1);
    expect(mocks.cli).toHaveBeenCalledTimes(1);
    expect(mocks.embedded).not.toHaveBeenCalled();
    expect(host.chargeTipBudgetAfterModelCall).toHaveBeenCalledTimes(1);
    expect(host.setBootstrapWarnings).toHaveBeenCalledTimes(1);
  });
  it("keeps one failed terminal when post-processing throws after the model response", async () => {
    const { host, invoke } = setup();
    const stages: string[] = [];
    host.observeExecution = (stage) => {
      stages.push(stage);
    };
    host.setBootstrapWarnings = () => {
      throw new Error("bootstrap after model");
    };
    mocks.cli.mockResolvedValue({
      payloads: [{ text: "result" }],
      meta: { agentMeta: { usage: { input: 2, output: 3 } } },
    });
    await expect(invoke("codex-cli", "model-a")).rejects.toThrow("bootstrap after model");
    expect(stages).toEqual(["started", "failed"]);
    expect(host.chargeTipBudgetAfterModelCall).toHaveBeenCalledTimes(1);
  });
  it("keeps one failed terminal when the budget charge rejects the candidate", async () => {
    const { host, invoke } = setup();
    const stages: string[] = [];
    host.observeExecution = (stage) => {
      stages.push(stage);
    };
    host.chargeTipBudgetAfterModelCall = () => {
      throw new TaskBudgetExceededError("task-a", { dimension: "cost", detail: "over" });
    };
    mocks.cli.mockResolvedValue({
      payloads: [{ text: "result" }],
      meta: { agentMeta: { usage: { input: 2, output: 3 } } },
    });
    await expect(invoke("codex-cli", "model-a")).rejects.toBeInstanceOf(TaskBudgetExceededError);
    expect(stages).toEqual(["started", "failed"]);
    expect(stages.filter((stage) => stage === "completed" || stage === "failed")).toEqual([
      "failed",
    ]);
  });
  it("preserves cancellation errors for the original fallback owner", async () => {
    const { host, invoke } = setup();
    const error = new Error("cancelled");
    error.name = "AbortError";
    mocks.cli.mockRejectedValue(error);
    await expect(invoke("codex-cli", "model-a")).rejects.toBe(error);
    expect(host.chargeTipBudgetAfterModelCall).not.toHaveBeenCalled();
  });
});
