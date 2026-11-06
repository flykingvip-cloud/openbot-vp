import { expect, it, vi } from "vitest";
import { runWithModelFallback } from "../../../agents/model-fallback.js";
import { runCommandFallback } from "./command-fallback.js";
vi.mock("../../../agents/model-fallback.js", () => ({ runWithModelFallback: vi.fn() }));
it("keeps retry identity local to each fallback invocation and forwards candidate options", async () => {
  vi.mocked(runWithModelFallback).mockImplementation(async (input) => {
    await input.run("first", "a", { allowTransientCooldownProbe: true });
    const result = await input.run("second", "b");
    return { result, provider: "second", model: "b", attempts: [] };
  });
  const run = vi.fn<Parameters<typeof runCommandFallback<string>>[0]["run"]>(async () => "done");
  const input = { cfg: {}, provider: "first", model: "a", governanceMode: "shadow" as const, run };
  await runCommandFallback(input);
  await runCommandFallback(input);
  expect(run.mock.calls.map((args) => args[3])).toEqual([false, true, false, true]);
  expect(run).toHaveBeenCalledWith("first", "a", { allowTransientCooldownProbe: true }, false);
  expect(runWithModelFallback).toHaveBeenCalledTimes(2);
});
