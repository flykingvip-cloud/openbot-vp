import { beforeEach, expect, it, vi } from "vitest";
import type { ModelInferenceInput } from "../../model/index.js";
import { CONTROLLED_EXECUTION_STAGE_ORDER } from "./controlled-execution.js";

const mocks = vi.hoisted(() => ({
  acquire: vi.fn((..._args: unknown[]): unknown => undefined),
  release: vi.fn(async (..._args: unknown[]) => {}),
  forgetRunModelSet: vi.fn((..._args: unknown[]) => {}),
  rememberRunModelSet: vi.fn((..._args: unknown[]) => {}),
  buildRunModelSetSnapshot: vi.fn((input: Record<string, unknown>) => ({ ...input })),
  snapshotCreditReportingFromGate: vi.fn((..._args: unknown[]) => undefined),
  runWithModelFallback: vi.fn(
    (_input: ModelInferenceInput<string>): Promise<unknown> => Promise.resolve(undefined),
  ),
}));

vi.mock("../../model/command-commercial-gate.js", () => ({
  acquireAgentCommandCommercialRun: (...args: unknown[]) => mocks.acquire(...args),
  releaseAgentCommandCommercialRun: (...args: unknown[]) => mocks.release(...args),
}));

vi.mock("../../../gateway/governance/spawn-snapshot-handoff.js", () => ({
  forgetRunModelSet: (...args: unknown[]) => mocks.forgetRunModelSet(...args),
  rememberRunModelSet: (...args: unknown[]) => mocks.rememberRunModelSet(...args),
  buildRunModelSetSnapshot: (input: Record<string, unknown>) =>
    mocks.buildRunModelSetSnapshot(input),
  snapshotCreditReportingFromGate: (...args: unknown[]) =>
    mocks.snapshotCreditReportingFromGate(...args),
}));

vi.mock("../../../agents/model-fallback.js", () => ({
  runWithModelFallback: (input: ModelInferenceInput<string>) => mocks.runWithModelFallback(input),
}));

import { createCommandExecutionLifecycle } from "./command-lifecycle.js";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.release.mockResolvedValue(undefined);
  mocks.buildRunModelSetSnapshot.mockImplementation((input: Record<string, unknown>) => ({
    ...input,
  }));
});

it("exposes the frozen controlled execution stage order while retaining E2 governance", async () => {
  mocks.acquire.mockResolvedValue({
    status: "acquired",
    enterpriseId: "tenant-e2",
    authorizationDecisionId: "auth-e2",
    modelGate: { tenantId: "tenant-e2", allowlist: ["openai/gpt-5.2"] },
  });
  mocks.runWithModelFallback.mockImplementation(async (input: ModelInferenceInput<string>) => ({
    result: await input.run("openai", "gpt-5.2"),
    provider: "openai",
    model: "gpt-5.2",
    attempts: [],
  }));
  const lifecycle = createCommandExecutionLifecycle({
    runId: "cmd-stages",
    isSubagentLane: false,
    entry: "E2",
  });
  expect(lifecycle.stages).toBe(CONTROLLED_EXECUTION_STAGE_ORDER);
  const prepared = await lifecycle.prepare({
    authorization: { runId: "cmd-stages", sessionAgentId: "main", entry: "E2" },
  });
  expect(prepared.kind).toBe("ready");
  expect(mocks.acquire).toHaveBeenCalledWith(expect.objectContaining({ entry: "E2" }));
  await lifecycle.infer({
    cfg: {},
    provider: "openai",
    model: "gpt-5.2",
    taskText: "t",
    run: async () => "ok",
  });
  expect(mocks.runWithModelFallback).toHaveBeenCalledWith(
    expect.objectContaining({
      governanceContext: expect.objectContaining({ entry: "E2", tenantId: "tenant-e2" }),
      entitlementAllowlist: ["openai/gpt-5.2"],
    }),
  );
  await lifecycle.dispose();
  expect(mocks.release).toHaveBeenCalledOnce();
});

it("denied preparation never arms inference or starts a backend candidate", async () => {
  mocks.acquire.mockResolvedValue({
    status: "denied",
    message: "quota denied",
  });
  const backend = vi.fn(async () => "ran");
  mocks.runWithModelFallback.mockImplementation(async (input: ModelInferenceInput<string>) => ({
    result: await input.run("p", "m"),
    provider: "p",
    model: "m",
    attempts: [],
  }));
  const lifecycle = createCommandExecutionLifecycle({
    runId: "cmd-deny",
    isSubagentLane: false,
    entry: "E3",
  });
  const prepared = await lifecycle.prepare({
    authorization: { runId: "cmd-deny", sessionAgentId: "main", entry: "E3" },
  });
  expect(prepared).toMatchObject({ kind: "denied", message: "quota denied" });
  expect(() =>
    lifecycle.infer({
      cfg: {},
      provider: "p",
      model: "m",
      taskText: "t",
      run: async () => backend(),
    }),
  ).toThrow(/not prepared/);
  expect(backend).not.toHaveBeenCalled();
  expect(mocks.runWithModelFallback).not.toHaveBeenCalled();
  await lifecycle.dispose();
  expect(mocks.release).not.toHaveBeenCalled();
});

it("cancellation after the first fallback candidate prevents the next one", async () => {
  mocks.acquire.mockResolvedValue({ status: "acquired" });
  const controller = new AbortController();
  const backend = vi.fn(
    async (_provider: string, _model: string, _options: unknown, retry: boolean) => {
      if (!retry) {
        controller.abort();
        return "first";
      }
      return "second";
    },
  );
  mocks.runWithModelFallback.mockImplementation(async (input: ModelInferenceInput<string>) => {
    await input.run("first", "a");
    const result = await input.run("second", "b");
    return { result, provider: "second", model: "b", attempts: [] };
  });
  const lifecycle = createCommandExecutionLifecycle({
    runId: "cmd-cancel",
    isSubagentLane: false,
    entry: "E3",
  });
  await lifecycle.prepare({
    authorization: { runId: "cmd-cancel", sessionAgentId: "main", entry: "E3" },
    signal: controller.signal,
  });
  await expect(
    lifecycle.infer({
      cfg: {},
      provider: "first",
      model: "a",
      taskText: "t",
      signal: controller.signal,
      run: backend,
    }),
  ).rejects.toThrow();
  expect(backend.mock.calls.map((call) => call[3])).toEqual([false]);
  await lifecycle.dispose();
  expect(mocks.release).toHaveBeenCalledOnce();
});

it("disposes exactly once through the command authority adapter", async () => {
  mocks.acquire.mockResolvedValue({ status: "acquired" });
  const lifecycle = createCommandExecutionLifecycle({
    runId: "cmd-dispose",
    isSubagentLane: false,
  });
  await lifecycle.prepare({
    authorization: { runId: "cmd-dispose", sessionAgentId: "main" },
  });
  await Promise.all([lifecycle.dispose(), lifecycle.dispose()]);
  expect(mocks.release).toHaveBeenCalledOnce();
});
