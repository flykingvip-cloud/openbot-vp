import { expect, it, vi } from "vitest";
import type { ModelInferenceInput } from "../../model/index.js";
import { createExecutionScope } from "./execution-scope.js";

function setup() {
  const prepare = vi.fn(async (_input: { signal?: AbortSignal }) => ({ kind: "ready" as const }));
  const dispose = vi.fn(async () => {});
  const scope = createExecutionScope({
    prepare,
    dispose,
    infer: async <T>(input: ModelInferenceInput<T>) => {
      await input.run("first", "a", { allowTransientCooldownProbe: true });
      const result = await input.run("second", "b");
      return { result, provider: "second", model: "b", attempts: [] };
    },
  });
  return { scope, prepare, dispose };
}

it("keeps retry identity local to each inference and retains candidate options", async () => {
  const { scope } = setup();
  await scope.prepare({});
  const run = vi.fn(
    async (_provider: string, _model: string, _options: unknown, _retry: boolean) => "done",
  );
  const input = { cfg: {}, provider: "first", model: "a", taskText: "task", run };
  await scope.infer(input);
  await scope.infer(input);
  expect(run.mock.calls.map((args) => args[3])).toEqual([false, true, false, true]);
  expect(run).toHaveBeenCalledWith("first", "a", { allowTransientCooldownProbe: true }, false);
  await scope.dispose();
});

it("retains preparation cancellation even if inference supplies no signal", async () => {
  const { scope } = setup();
  const controller = new AbortController();
  await scope.prepare({ signal: controller.signal });
  const run = vi.fn(async () => {
    controller.abort();
    return "late";
  });
  await expect(
    scope.infer({ cfg: {}, provider: "first", model: "a", taskText: "task", run }),
  ).rejects.toThrow();
  expect(run).toHaveBeenCalledOnce();
  await scope.dispose();
});

it("disposes exactly once and rejects any later preparation", async () => {
  const { scope, prepare, dispose } = setup();
  await scope.prepare({});
  await Promise.all([scope.dispose(), scope.dispose()]);
  await expect(scope.prepare({})).rejects.toThrow(/disposed/);
  expect(prepare).toHaveBeenCalledOnce();
  expect(dispose).toHaveBeenCalledOnce();
});
