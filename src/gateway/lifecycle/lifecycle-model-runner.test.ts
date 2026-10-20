// @vitest-environment node
import { afterEach, describe, expect, it } from "vitest";
import type { GatedModelRunner } from "./gated-candidate-run.ts";
import { getLifecycleModelRunner, setLifecycleModelRunner } from "./lifecycle-model-runner.ts";

afterEach(() => {
  setLifecycleModelRunner(null);
});

describe("lifecycle model runner seam", () => {
  it("is dormant (null) by default", () => {
    expect(getLifecycleModelRunner()).toBeNull();
  });

  it("can be wired and reset", () => {
    const runner: GatedModelRunner = async () => ({ text: "{}", usageQuantity: 0 });
    setLifecycleModelRunner(runner);
    expect(getLifecycleModelRunner()).toBe(runner);
    setLifecycleModelRunner(null);
    expect(getLifecycleModelRunner()).toBeNull();
  });
});
