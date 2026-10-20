import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { formatCliCommand } from "./command-format.js";

describe("command format", () => {
  let originalArgv: string[];

  beforeEach(() => {
    originalArgv = [...process.argv];
  });

  afterEach(() => {
    process.argv = originalArgv;
  });

  it("rewrites legacy command examples to the active cli name", () => {
    process.argv = ["node", "openbot", "--help"];

    expect(formatCliCommand("openclaw doctor --fix")).toBe("openbot doctor --fix");
    expect(formatCliCommand("pnpm openclaw doctor", {})).toBe("pnpm openbot doctor");
  });

  it("falls back to OPENCLAW_PROFILE while emitting the active cli name", () => {
    process.argv = ["node", "openbot", "--help"];

    expect(formatCliCommand("openclaw doctor --fix", { OPENCLAW_PROFILE: "work" })).toBe(
      "openbot --profile work doctor --fix",
    );
  });
});
