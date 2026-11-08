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
