import { beforeEach, expect, it, vi } from "vitest";
import {
  CONTROLLED_EXECUTION_STAGE_ORDER,
  assertControlledExecutionStages,
} from "./controlled-execution.js";
import { createSupervisorWorkItemLifecycle } from "./supervisor-lifecycle.js";

const ports = vi.hoisted(() => ({
  acquire: vi.fn(),
  release: vi.fn(async () => {}),
}));

beforeEach(() => {
  vi.clearAllMocks();
  ports.release.mockResolvedValue(undefined);
});

it("exposes the frozen controlled execution stage order", () => {
  const lifecycle = createSupervisorWorkItemLifecycle(ports);
  expect(lifecycle.stages).toBe(CONTROLLED_EXECUTION_STAGE_ORDER);
  expect(() => assertControlledExecutionStages(lifecycle, "Supervisor host")).not.toThrow();
});

it("denied admission never arms inference or starts a CLI backend candidate", async () => {
  ports.acquire.mockResolvedValue({ status: "denied", message: "quota denied" });
  const backend = vi.fn(async () => "ran");
  const lifecycle = createSupervisorWorkItemLifecycle(ports);
  const prepared = await lifecycle.prepare({
    runId: "sup-deny",
    agentId: "main",
    enterpriseId: "ent-1",
  });
  expect(prepared).toMatchObject({ kind: "denied", message: "quota denied" });
  expect(() =>
    lifecycle.infer({
      cfg: {},
      provider: "codex-cli",
      model: "default",
      taskText: "work",
      run: async () => backend(),
    }),
  ).toThrow(/not prepared/);
  expect(backend).not.toHaveBeenCalled();
  await lifecycle.dispose();
  expect(ports.release).not.toHaveBeenCalled();
});

it("cancel after prepare releases the slot and never starts the CLI backend", async () => {
  ports.acquire.mockResolvedValue({ status: "acquired" });
  const controller = new AbortController();
  const backend = vi.fn(async () => "ran");
  const lifecycle = createSupervisorWorkItemLifecycle(ports);
  await lifecycle.prepare({
    runId: "sup-cancel",
    agentId: "main",
    signal: controller.signal,
  });
  controller.abort();
  let inferError: unknown;
  try {
    await lifecycle.infer({
      cfg: {},
      provider: "codex-cli",
      model: "default",
      taskText: "work",
      signal: controller.signal,
      run: async () => backend(),
    });
  } catch (err) {
    inferError = err;
  }
  expect(inferError).toBeTruthy();
  expect(backend).not.toHaveBeenCalled();
  await lifecycle.dispose();
  expect(ports.release).toHaveBeenCalledOnce();
  expect(ports.release).toHaveBeenCalledWith("sup-cancel");
});

it("disposes exactly once and releases the acquired commercial slot", async () => {
  ports.acquire.mockResolvedValue({ status: "acquired" });
  const lifecycle = createSupervisorWorkItemLifecycle(ports);
  await lifecycle.prepare({ runId: "sup-dispose", agentId: "main", enterpriseId: "ent" });
  await Promise.all([lifecycle.dispose(), lifecycle.dispose()]);
  expect(ports.release).toHaveBeenCalledOnce();
  expect(ports.release).toHaveBeenCalledWith("sup-dispose");
});

it("skipped admission stays ready without a releaseable slot", async () => {
  ports.acquire.mockResolvedValue({ status: "skipped" });
  const backend = vi.fn(async () => "ok");
  const lifecycle = createSupervisorWorkItemLifecycle(ports);
  const prepared = await lifecycle.prepare({ runId: "sup-skip", agentId: "main" });
  expect(prepared.kind).toBe("ready");
  const inferred = await lifecycle.infer({
    cfg: {},
    provider: "codex-cli",
    model: "default",
    taskText: "work",
    run: async () => backend(),
  });
  expect(inferred.result).toBe("ok");
  await lifecycle.dispose();
  expect(ports.release).not.toHaveBeenCalled();
});

it("cancel during admission wait releases the acquired lease exactly once and never starts a backend", async () => {
  const controller = new AbortController();
  const backend = vi.fn(async () => "ran");
  ports.acquire.mockImplementation(async () => {
    controller.abort();
    return { status: "acquired" as const };
  });
  const lifecycle = createSupervisorWorkItemLifecycle(ports);
  let prepareError: unknown;
  try {
    await lifecycle.prepare({
      runId: "sup-wait-cancel",
      agentId: "main",
      enterpriseId: "ent-1",
      signal: controller.signal,
    });
  } catch (err) {
    prepareError = err;
  }
  expect(prepareError).toBeTruthy();
  expect(() =>
    lifecycle.infer({
      cfg: {},
      provider: "codex-cli",
      model: "default",
      taskText: "work",
      signal: controller.signal,
      run: async () => backend(),
    }),
  ).toThrow(/not prepared/);
  expect(backend).not.toHaveBeenCalled();
  await lifecycle.dispose();
  await lifecycle.dispose();
  expect(ports.release).toHaveBeenCalledOnce();
  expect(ports.release).toHaveBeenCalledWith("sup-wait-cancel");
});

it("denied admission after a cancel race still never releases a lease that was not acquired", async () => {
  const controller = new AbortController();
  ports.acquire.mockImplementation(async () => {
    controller.abort();
    return { status: "denied" as const, message: "quota denied" };
  });
  const lifecycle = createSupervisorWorkItemLifecycle(ports);
  let prepareError: unknown;
  try {
    await lifecycle.prepare({
      runId: "sup-deny-cancel",
      agentId: "main",
      signal: controller.signal,
    });
  } catch (err) {
    prepareError = err;
  }
  // Abort wins after acquire resolves denied; no lease was held.
  expect(prepareError).toBeTruthy();
  await lifecycle.dispose();
  expect(ports.release).not.toHaveBeenCalled();
});
