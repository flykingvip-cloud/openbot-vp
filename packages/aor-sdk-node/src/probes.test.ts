import type { EvalInput } from "@openbot/aor-core";
import { describe, expect, it } from "vitest";
import { type CommandRunner, createCommandProbe, createCoverageProbe } from "./probes.js";

const evalInput: EvalInput = {
  task: { goal: "x" },
  output: { text: "ok" },
  usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
};

describe("createCommandProbe", () => {
  it("scores 1 on exit code 0", async () => {
    const runner: CommandRunner = () => Promise.resolve({ code: 0, stdout: "", stderr: "" });
    const probe = createCommandProbe({ name: "build", command: "pnpm", args: ["build"], runner });
    expect(await probe.run(evalInput)).toBe(1);
  });

  it("scores 0 on non-zero exit", async () => {
    const runner: CommandRunner = () => Promise.resolve({ code: 1, stdout: "", stderr: "boom" });
    const probe = createCommandProbe({ name: "test", command: "pnpm", args: ["test"], runner });
    expect(await probe.run(evalInput)).toBe(0);
  });
});

describe("createCoverageProbe", () => {
  it("extracts a coverage percentage", async () => {
    const runner: CommandRunner = () =>
      Promise.resolve({ code: 0, stdout: "All files |   84.2 |", stderr: "" });
    const probe = createCoverageProbe({ command: "pnpm", args: ["test:coverage"], runner });
    expect(await probe.run(evalInput)).toBeCloseTo(0.842, 3);
  });

  it("scores 0 when no coverage line is found", async () => {
    const runner: CommandRunner = () => Promise.resolve({ code: 0, stdout: "no data", stderr: "" });
    const probe = createCoverageProbe({ command: "pnpm", args: ["test:coverage"], runner });
    expect(await probe.run(evalInput)).toBe(0);
  });
});
