import { expect, it, vi } from "vitest";
import { bindAdmittedTurnHost } from "../../wiring/admitted-turn-host.js";
import { createExecutionLifecycle } from "./execution-lifecycle.js";

function setup() {
  const host = bindAdmittedTurnHost();
  host.admission.tryAcquireEnterpriseAgentRun = vi.fn(async () => ({
    acquired: true as const,
    skipped: false as const,
    enterpriseId: "tenant",
  }));
  host.admission.releaseEnterpriseAgentRun = vi.fn(async () => {});
  host.model.forgetRunModelSet = vi.fn();
  host.model.buildRunModelSetSnapshot = vi.fn(() => undefined);
  host.model.runWithModelFallback = vi.fn(async (input) => ({
    result: await input.run("test", "model"),
    provider: "test",
    model: "model",
    attempts: [],
  }));
  const lifecycle = createExecutionLifecycle("run", host);
  const candidate = vi.fn(async () => "result");
  const request = { cfg: {}, provider: "test", model: "model", taskText: "task", run: candidate };
  return { host, lifecycle, candidate, request };
}

it("refuses inference before preparation and after disposal", async () => {
  const { host, lifecycle, request, candidate } = setup();
  expect(() => lifecycle.infer(request)).toThrow(/not prepared/);
  expect((await lifecycle.prepare({ config: {}, authorization: {} })).kind).toBe("ready");
  expect((await lifecycle.infer(request)).result).toBe("result");
  await lifecycle.dispose();
  await lifecycle.dispose();
  expect(() => lifecycle.infer(request)).toThrow(/not prepared/);
  expect(candidate).toHaveBeenCalledOnce();
  expect(host.admission.releaseEnterpriseAgentRun).toHaveBeenCalledOnce();
  expect(host.model.forgetRunModelSet).toHaveBeenCalledOnce();
});

it("denies before routing or provider execution", async () => {
  const { host, lifecycle, request } = setup();
  vi.mocked(host.admission.tryAcquireEnterpriseAgentRun).mockResolvedValue({
    acquired: false as const,
    skipped: false as const,
    reason: "NO_SUBSCRIPTION" as const,
    message: "denied",
  });
  const routing = vi.spyOn(host.model, "resolveExecutionRoutingFromCapabilityPlan");
  expect(await lifecycle.prepare({ config: {}, authorization: {} })).toEqual({
    kind: "denied",
    message: "denied",
  });
  expect(() => lifecycle.infer(request)).toThrow(/not prepared/);
  expect(routing).not.toHaveBeenCalled();
  await lifecycle.dispose();
  expect(host.admission.releaseEnterpriseAgentRun).not.toHaveBeenCalled();
});

it("cancellation during admission prevents model startup and still releases the acquired lease", async () => {
  const { host, lifecycle, request } = setup();
  const controller = new AbortController();
  vi.mocked(host.admission.tryAcquireEnterpriseAgentRun).mockImplementation(async () => {
    controller.abort();
    return { acquired: true as const, skipped: false as const, enterpriseId: "tenant" };
  });
  await expect(
    lifecycle.prepare({ config: {}, authorization: {}, signal: controller.signal }),
  ).rejects.toThrow();
  expect(() => lifecycle.infer(request)).toThrow(/not prepared/);
  await lifecycle.dispose();
  expect(host.admission.releaseEnterpriseAgentRun).toHaveBeenCalledOnce();
  expect(host.model.runWithModelFallback).not.toHaveBeenCalled();
});

it("a failed re-preparation cannot reuse an earlier prepared candidate set", async () => {
  const { host, lifecycle, request } = setup();
  await lifecycle.prepare({ config: {}, authorization: {} });
  vi.spyOn(host.model, "resolveExecutionRoutingFromCapabilityPlan").mockImplementation(() => {
    throw new Error("routing failed");
  });
  await expect(lifecycle.prepare({ config: {}, authorization: {} })).rejects.toThrow(
    /routing failed/,
  );
  expect(() => lifecycle.infer(request)).toThrow(/not prepared/);
  expect(host.admission.tryAcquireEnterpriseAgentRun).toHaveBeenCalledOnce();
  await lifecycle.dispose();
});
