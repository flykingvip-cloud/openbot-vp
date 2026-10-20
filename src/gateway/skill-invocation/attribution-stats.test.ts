import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const tmpDir = path.join(os.tmpdir(), `openbot-attr-stats-${Date.now()}`);
vi.mock("../../utils.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../utils.js")>();
  return { ...actual, CONFIG_DIR: tmpDir };
});

const { readAttributionStats, recordAttributionOutcome, resetAttributionStatsForTests } =
  await import("./attribution-stats.js");

describe("attribution stats", () => {
  beforeEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    fs.mkdirSync(tmpDir, { recursive: true });
    resetAttributionStatsForTests();
  });
  afterEach(() => {
    resetAttributionStatsForTests();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("counts attributed vs unattributed outcomes", () => {
    recordAttributionOutcome("unique_owner");
    recordAttributionOutcome("identity_tool_name");
    recordAttributionOutcome("none");
    recordAttributionOutcome(null);
    const snap = readAttributionStats(tmpDir);
    expect(snap.counts.unique_owner).toBe(1);
    expect(snap.counts.identity_tool_name).toBe(1);
    expect(snap.counts.none).toBe(2);
    expect(snap.totalAttributed).toBe(2);
    expect(snap.totalUnattributed).toBe(2);
  });
});
