import { describe, expect, it } from "vitest";
import { parseBenchCliArgs } from "./bench-cli.js";

describe("parseBenchCliArgs", () => {
  it("parses bandit and live flags", () => {
    const opts = parseBenchCliArgs([
      "node",
      "bench-cli.js",
      "--bandit-state",
      "/tmp/b.json",
      "--bandit-rounds",
      "5",
      "--live",
    ]);
    expect(opts.banditStatePath).toBe("/tmp/b.json");
    expect(opts.banditRounds).toBe(5);
    expect(opts.live).toBe(true);
  });

  it("enables coding + live when coding-archive is set", () => {
    const opts = parseBenchCliArgs([
      "node",
      "bench-cli.js",
      "--coding-archive",
      "/tmp/archive.json",
      "--workspace",
      "/tmp/ws",
    ]);
    expect(opts.codingArchivePath).toBe("/tmp/archive.json");
    expect(opts.coding).toBe(true);
    expect(opts.live).toBe(true);
    expect(opts.codingWorkspace).toBe("/tmp/ws");
  });
});
