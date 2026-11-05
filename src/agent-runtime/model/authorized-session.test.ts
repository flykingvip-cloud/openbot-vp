import { expect, it, vi } from "vitest";
import { bindAdmittedTurnHost } from "../wiring/admitted-turn-host.js";
import { createAuthorizedModelSession } from "./index.js";

function setup() {
  const host = bindAdmittedTurnHost();
  host.admission.tryAcquireEnterpriseAgentRun = vi.fn(async () => ({
    acquired: true as const,
    skipped: false as const,
    enterpriseId: "tenant",
    authorizationDecisionId: "auth",
    subscriptionId: "subscription",
  }));
  host.admission.releaseEnterpriseAgentRun = vi.fn(async () => {});
  host.model.forgetRunModelSet = vi.fn();
  host.model.buildRunModelSetSnapshot = vi.fn(() => undefined);
  host.model.rememberRunModelSet = vi.fn();
  host.task.ensureChatTurnTaskOutcome = vi.fn();
  const session = createAuthorizedModelSession("model-call", host);
  const routing = host.model.resolveExecutionRoutingFromCapabilityPlan({});
  return { host, session, routing };
}
it("requires authorization before preparing model candidates, without creating a task", async () => {
  const { host, session, routing } = setup();
  expect(() => session.prepareModelSet({ config: {}, routing })).toThrow(/authorized/);
  await session.authorize({ agentId: "bot" });
  session.prepareModelSet({ config: {}, routing });
  expect(session.billing.authorizationDecisionId).toBe("auth");
  expect(host.task.ensureChatTurnTaskOutcome).not.toHaveBeenCalled();
  await session.authorize({ agentId: "bot" });
  expect(host.admission.tryAcquireEnterpriseAgentRun).toHaveBeenCalledOnce();
  session.dispose();
  session.dispose();
  expect(host.admission.releaseEnterpriseAgentRun).toHaveBeenCalledOnce();
  expect(host.model.forgetRunModelSet).toHaveBeenCalledOnce();
  expect(() => session.prepareModelSet({ config: {}, routing })).toThrow(/authorized/);
  await expect(session.authorize({})).rejects.toThrow(/disposed/);
});
it("denial never prepares candidates or releases an unheld slot", async () => {
  const { host, session, routing } = setup();
  vi.mocked(host.admission.tryAcquireEnterpriseAgentRun).mockResolvedValue({
    acquired: false,
    skipped: false,
    reason: "NO_SUBSCRIPTION",
    message: "denied",
  });
  expect((await session.authorize({})).acquired).toBe(false);
  expect(() => session.prepareModelSet({ config: {}, routing })).toThrow(/authorized/);
  session.dispose();
  expect(host.model.buildRunModelSetSnapshot).not.toHaveBeenCalled();
  expect(host.admission.releaseEnterpriseAgentRun).not.toHaveBeenCalled();
});
it("preserves skipped admission retry and does not invent billing", async () => {
  const { host, session, routing } = setup();
  vi.mocked(host.admission.tryAcquireEnterpriseAgentRun).mockResolvedValueOnce({
    acquired: false,
    skipped: true,
  });
  await session.authorize({});
  expect(session.held).toBe(false);
  expect(session.billing.subscriptionId).toBeUndefined();
  session.prepareModelSet({ config: {}, routing });
  await session.authorize({});
  expect(session.held).toBe(true);
  expect(host.admission.tryAcquireEnterpriseAgentRun).toHaveBeenCalledTimes(2);
  session.dispose();
});

it("runs inference only through the prepared governed session", async () => {
  const { host, session, routing } = setup();
  host.model.runWithModelFallback = vi.fn(async (options) => ({
    result: await options.run("test", "model"),
    provider: "test",
    model: "model",
    attempts: [],
  }));
  const run = vi.fn(async () => ({ kind: "reply", text: "你好" }));
  const request = { cfg: {}, provider: "test", model: "model", taskText: "你好", run };
  await expect(session.infer(request)).rejects.toThrow(/prepared/);
  expect(run).not.toHaveBeenCalled();
  await session.authorize({});
  await expect(session.infer(request)).rejects.toThrow(/prepared/);
  session.prepareModelSet({ config: {}, routing });
  const result = await session.infer(request);
  expect(result.result).toEqual({ kind: "reply", text: "你好" });
  expect(run).toHaveBeenCalledOnce();
  expect(host.model.runWithModelFallback).toHaveBeenCalledWith(
    expect.objectContaining({
      runId: "model-call",
      governanceMode: expect.any(String),
      runtimeAdmission: { taskText: "你好" },
    }),
  );
  expect(host.task.ensureChatTurnTaskOutcome).not.toHaveBeenCalled();
  session.dispose();
  await expect(session.infer(request)).rejects.toThrow(/prepared/);
});

it("rejects late inference after cancellation without scheduling execution", async () => {
  const { host, session, routing } = setup();
  host.model.runWithModelFallback = vi.fn(async (options) => ({
    result: await options.run("test", "model"),
    provider: "test",
    model: "model",
    attempts: [],
  }));
  await session.authorize({});
  session.prepareModelSet({ config: {}, routing });
  const controller = new AbortController();
  const run = vi.fn(async () => {
    controller.abort();
    return "late";
  });
  await expect(
    session.infer({
      cfg: {},
      provider: "test",
      model: "model",
      taskText: "hello",
      signal: controller.signal,
      run,
    }),
  ).rejects.toThrow();
  expect(run).toHaveBeenCalledOnce();
  expect(host.task.ensureChatTurnTaskOutcome).not.toHaveBeenCalled();
  session.dispose();
});
