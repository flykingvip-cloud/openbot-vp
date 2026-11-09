import { expect, it, vi } from "vitest";
import type { ModelInferenceInput } from "../../model/index.js";
import {
  CONTROLLED_EXECUTION_STAGE_ORDER,
  assertControlledExecutionStages,
  createControlledExecutionUseCase,
} from "./controlled-execution.js";

it("freezes the unique controlled execution stage order", () => {
  expect(CONTROLLED_EXECUTION_STAGE_ORDER).toEqual([
    "prepare",
    "assert_budget",
    "infer",
    "record_usage",
    "dispose",
    "record_execution_outcome",
  ]);
  const useCase = createControlledExecutionUseCase({
    prepare: async () => ({ kind: "ready" as const }),
    infer: vi.fn(),
    dispose: async () => {},
  });
  expect(useCase.stages).toBe(CONTROLLED_EXECUTION_STAGE_ORDER);
});

it("refuses inference before preparation so backends never start", async () => {
  const backend = vi.fn(async () => "ran");
  const useCase = createControlledExecutionUseCase({
    prepare: async () => ({ kind: "ready" as const }),
    dispose: async () => {},
    infer: async <T>(input: ModelInferenceInput<T>) => ({
      result: await input.run("p", "m"),
      provider: "p",
      model: "m",
      attempts: [],
    }),
  });
  expect(() =>
    useCase.infer({
      cfg: {},
      provider: "p",
      model: "m",
      taskText: "t",
      run: async (_p, _m, _o, _retry) => backend(),
    }),
  ).toThrow(/not prepared/);
  expect(backend).not.toHaveBeenCalled();
});

it("denied preparation never arms inference or starts a backend candidate", async () => {
  const backend = vi.fn(async () => "ran");
  const useCase = createControlledExecutionUseCase({
    prepare: async () => ({ kind: "denied" as const }),
    dispose: async () => {},
    infer: async <T>(input: ModelInferenceInput<T>) => ({
      result: await input.run("p", "m"),
      provider: "p",
      model: "m",
      attempts: [],
    }),
  });
  expect(await useCase.prepare({})).toEqual({ kind: "denied" });
  expect(() =>
    useCase.infer({
      cfg: {},
      provider: "p",
      model: "m",
      taskText: "t",
      run: async () => backend(),
    }),
  ).toThrow(/not prepared/);
  expect(backend).not.toHaveBeenCalled();
  await useCase.dispose();
});

it("cancellation after the first candidate prevents the next fallback candidate", async () => {
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
  const useCase = createControlledExecutionUseCase({
    prepare: async () => ({ kind: "ready" as const }),
    dispose: async () => {},
    infer: async <T>(input: ModelInferenceInput<T>) => {
      await input.run("first", "a");
      const result = await input.run("second", "b");
      return { result, provider: "second", model: "b", attempts: [] };
    },
  });
  await useCase.prepare({ signal: controller.signal });
  await expect(
    useCase.infer({
      cfg: {},
      provider: "first",
      model: "a",
      taskText: "t",
      signal: controller.signal,
      run: backend,
    }),
  ).rejects.toThrow();
  expect(backend.mock.calls.map((call) => call[3])).toEqual([false]);
  await useCase.dispose();
});

it("disposes exactly once and keeps later inference disarmed", async () => {
  const dispose = vi.fn(async () => {});
  const useCase = createControlledExecutionUseCase({
    prepare: async () => ({ kind: "ready" as const }),
    dispose,
    infer: async <T>(input: ModelInferenceInput<T>) => ({
      result: await input.run("p", "m"),
      provider: "p",
      model: "m",
      attempts: [],
    }),
  });
  await useCase.prepare({});
  await Promise.all([useCase.dispose(), useCase.dispose()]);
  expect(dispose).toHaveBeenCalledOnce();
  expect(() =>
    useCase.infer({
      cfg: {},
      provider: "p",
      model: "m",
      taskText: "t",
      run: async () => "x",
    }),
  ).toThrow(/not prepared/);
});

it("assertControlledExecutionStages accepts the frozen order and rejects drift", () => {
  const useCase = createControlledExecutionUseCase({
    prepare: async () => ({ kind: "ready" as const }),
    infer: vi.fn(),
    dispose: async () => {},
  });
  expect(() => assertControlledExecutionStages(useCase, "Cron host")).not.toThrow();
  expect(() =>
    assertControlledExecutionStages(
      {
        stages: [
          "prepare",
          "infer",
          "dispose",
        ] as unknown as typeof CONTROLLED_EXECUTION_STAGE_ORDER,
      },
      "Cron host",
    ),
  ).toThrow(/Cron host must consume the frozen controlled execution stage order/);
});
