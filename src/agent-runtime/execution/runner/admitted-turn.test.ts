import { beforeEach, expect, it, vi } from "vitest";
import { ContractEndedError } from "../../../gateway/billing/billing-period.js";
import { bindAdmittedTurnHost } from "../../wiring/admitted-turn-host.js";
import { CONTROLLED_EXECUTION_STAGE_ORDER, runAdmittedTurn } from "../index.js";
import { createExecutionLifecycle } from "./execution-lifecycle.js";
import type { AgentTurnExecutionParams } from "./turn-contract.js";
const mocks = vi.hoisted(() => ({ invoke: vi.fn(), create: vi.fn() }));
vi.mock("./admitted-candidate.js", () => ({
  createAdmittedCandidateInvoker: (...args: unknown[]) => {
    mocks.create(...args);
    return mocks.invoke;
  },
}));
function setup() {
  const host = bindAdmittedTurnHost();
  host.admission.tryAcquireEnterpriseAgentRun = vi.fn(async () => ({
    acquired: true as const,
    skipped: false as const,
    enterpriseId: "test",
  }));
  host.admission.releaseEnterpriseAgentRun = vi.fn(async () => {});
  host.model.forgetRunModelSet = vi.fn();
  host.model.rememberRunModelSet = vi.fn();
  host.model.runWithModelFallback = vi.fn(async (options) => ({
    result: await options.run("test", "model"),
    provider: "test",
    model: "model",
    attempts: [],
  }));
  const params = {
    commandBody: "test",
    followupRun: {
      prompt: "test",
      run: {
        config: {},
        provider: "test",
        model: "model",
        sessionId: "session",
        sessionFile: "/tmp/test-session.jsonl",
      },
    },
    sessionCtx: {},
    opts: { runId: "test-turn" },
    isHeartbeat: true,
    getActiveSessionEntry: () => undefined,
  } as AgentTurnExecutionParams;
  return { host, params };
}
beforeEach(() => {
  mocks.invoke.mockReset();
  mocks.create.mockReset();
  mocks.invoke.mockResolvedValue({ payloads: [{ text: "done" }] });
});
it("returns an ended-contract refusal before candidate construction", async () => {
  const { host, params } = setup();
  vi.mocked(host.admission.tryAcquireEnterpriseAgentRun).mockRejectedValue(
    new ContractEndedError("2026-01-01", "2026-11-09"),
  );
  const result = await runAdmittedTurn(params, host);
  expect(result).toMatchObject({
    kind: "final",
    payload: { text: expect.stringContaining("合同已结束") },
  });
  expect(mocks.create).not.toHaveBeenCalled();
  expect(host.model.runWithModelFallback).not.toHaveBeenCalled();
  expect(host.admission.releaseEnterpriseAgentRun).not.toHaveBeenCalled();
});
it("reports missing sandbox identity without model advice or capability-gap mutation", async () => {
  const { host, params } = setup();
  mocks.invoke.mockRejectedValue(
    new Error(
      "Managed multitenant sandbox requires a server-derived account (tenantId and userId).",
    ),
  );
  host.observability.recordHonestCapabilityGap = vi.fn();
  const result = await runAdmittedTurn(params, host);
  expect(result).toMatchObject({
    kind: "final",
    payload: { text: expect.stringContaining("缺少可信") },
  });
  expect(mocks.invoke).toHaveBeenCalledOnce();
  expect(host.observability.recordHonestCapabilityGap).not.toHaveBeenCalled();
});
it("rejects a stale accepted task before outcome creation or commercial admission", async () => {
  const { host, params } = setup();
  params.isHeartbeat = false;
  params.followupRun.run.agentId = "test";
  params.followupRun.run.taskCompletionBinding = {
    taskId: "old-task",
    executionAttempt: "old-attempt",
    deliverableVersion: "old-attempt",
  };
  host.task.isTaskExecutionBindingCurrent = vi.fn(() => false);
  host.task.ensureChatTurnTaskOutcome = vi.fn();
  await expect(runAdmittedTurn(params, host)).rejects.toThrow(/Original task/);
  expect(host.task.ensureChatTurnTaskOutcome).not.toHaveBeenCalled();
  expect(host.admission.tryAcquireEnterpriseAgentRun).not.toHaveBeenCalled();
  expect(mocks.create).not.toHaveBeenCalled();
});
it("denies admission before candidate construction or model fallback", async () => {
  const { host, params } = setup();
  host.admission.tryAcquireEnterpriseAgentRun = vi.fn(async () => ({
    acquired: false as const,
    skipped: false as const,
    reason: "NO_SUBSCRIPTION" as const,
    message: "denied",
  }));
  expect(await runAdmittedTurn(params, host)).toEqual({
    kind: "final",
    payload: { text: "denied" },
  });
  expect(mocks.create).not.toHaveBeenCalled();
  expect(host.model.runWithModelFallback).not.toHaveBeenCalled();
  expect(host.admission.releaseEnterpriseAgentRun).not.toHaveBeenCalled();
  expect(host.model.forgetRunModelSet).not.toHaveBeenCalled();
});
it("runs through original fallback once and releases slot before forgetting its snapshot", async () => {
  const { host, params } = setup();
  expect((await runAdmittedTurn(params, host)).kind).toBe("success");
  expect(host.model.runWithModelFallback).toHaveBeenCalledOnce();
  expect(mocks.invoke).toHaveBeenCalledOnce();
  expect(host.admission.releaseEnterpriseAgentRun).toHaveBeenCalledWith("test-turn");
  expect(host.model.forgetRunModelSet).toHaveBeenCalledWith("test-turn");
  expect(
    vi.mocked(host.admission.releaseEnterpriseAgentRun).mock.invocationCallOrder[0],
  ).toBeLessThan(vi.mocked(host.model.forgetRunModelSet).mock.invocationCallOrder[0]);
});
it("retains slot and snapshot cleanup after a non-retryable provider error", async () => {
  const { host, params } = setup();
  const controller = new AbortController();
  params.opts!.abortSignal = controller.signal;
  mocks.invoke.mockImplementation(async () => {
    controller.abort();
    throw new Error("permission denied");
  });
  expect((await runAdmittedTurn(params, host)).kind).toBe("final");
  expect(host.model.runWithModelFallback).toHaveBeenCalledOnce();
  expect(host.admission.releaseEnterpriseAgentRun).toHaveBeenCalledOnce();
  expect(host.model.forgetRunModelSet).toHaveBeenCalledOnce();
});

it("rejects an admitted request without its task binding before any execution effects", async () => {
  const { host, params } = setup();
  params.isHeartbeat = false;
  params.followupRun.run.agentId = "test";
  params.followupRun.run.executionAdmitted = true;
  host.task.ensureChatTurnTaskOutcome = vi.fn();
  await expect(runAdmittedTurn(params, host)).rejects.toThrow(/binding/i);
  expect(host.task.ensureChatTurnTaskOutcome).not.toHaveBeenCalled();
  expect(host.admission.tryAcquireEnterpriseAgentRun).not.toHaveBeenCalled();
  expect(mocks.create).not.toHaveBeenCalled();
  expect(mocks.invoke).not.toHaveBeenCalled();
});

it("chat lifecycle factory exposes the frozen controlled execution stage order", () => {
  const host = bindAdmittedTurnHost();
  const lifecycle = createExecutionLifecycle("chat-stage-order", host);
  expect(lifecycle.stages).toBe(CONTROLLED_EXECUTION_STAGE_ORDER);
});

it("cancellation after the first fallback candidate never starts the next one", async () => {
  const { host, params } = setup();
  const controller = new AbortController();
  params.opts!.abortSignal = controller.signal;
  const candidates: string[] = [];
  host.model.runWithModelFallback = vi.fn(async (options) => {
    const first = await options.run("primary", "model-a");
    const second = await options.run("fallback", "model-b");
    return {
      result: second ?? first,
      provider: "fallback",
      model: "model-b",
      attempts: [],
    };
  });
  mocks.invoke.mockImplementation(async (provider: string) => {
    candidates.push(provider);
    if (provider === "primary") {
      controller.abort();
      return { payloads: [{ text: "first" }] };
    }
    return { payloads: [{ text: "second" }] };
  });
  const result = await runAdmittedTurn(params, host);
  expect(result.kind).toBe("final");
  expect(candidates).toEqual(["primary"]);
  expect(host.admission.releaseEnterpriseAgentRun).toHaveBeenCalledOnce();
  expect(host.model.forgetRunModelSet).toHaveBeenCalledOnce();
});

it("records execution success separately from delivery via deferred growth commit", async () => {
  const { host, params } = setup();
  const result = await runAdmittedTurn(params, host);
  expect(result.kind).toBe("success");
  if (result.kind !== "success") {
    throw new Error("expected success");
  }
  expect(typeof result.commitGrowthOutcome).toBe("function");
  // Delivery/outcome commit is deferred to the reply adapter; inference already finished.
  expect(mocks.invoke).toHaveBeenCalledOnce();
  expect(host.model.runWithModelFallback).toHaveBeenCalledOnce();
});

it("denied admission still disposes the controlled lifecycle exactly once without backend start", async () => {
  const { host, params } = setup();
  host.admission.tryAcquireEnterpriseAgentRun = vi.fn(async () => ({
    acquired: false as const,
    skipped: false as const,
    reason: "NO_SUBSCRIPTION" as const,
    message: "denied",
  }));
  expect(await runAdmittedTurn(params, host)).toEqual({
    kind: "final",
    payload: { text: "denied" },
  });
  expect(mocks.create).not.toHaveBeenCalled();
  expect(host.model.runWithModelFallback).not.toHaveBeenCalled();
  // Never acquired → lease release/forget remain no-ops; dispose path still ran once.
  expect(host.admission.releaseEnterpriseAgentRun).not.toHaveBeenCalled();
  expect(host.model.forgetRunModelSet).not.toHaveBeenCalled();
});
