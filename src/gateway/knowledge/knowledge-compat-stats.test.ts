// @vitest-environment node
import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { tmpDir } = vi.hoisted(() => ({
  tmpDir: `/tmp/openbot-kb-compat-stats-${Math.random().toString(36).slice(2)}`,
}));

vi.mock("../../utils.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../utils.js")>();
  return {
    ...actual,
    CONFIG_DIR: tmpDir,
  };
});

const {
  readKnowledgeCompatWarningStats,
  recordKnowledgeCompatWarning,
  resetKnowledgeCompatWarningStatsForTests,
} = await import("./knowledge-compat-stats.js");

describe("knowledge-compat-stats", () => {
  beforeEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    fs.mkdirSync(path.join(tmpDir, "knowledge"), { recursive: true });
    resetKnowledgeCompatWarningStatsForTests();
  });

  afterEach(() => {
    resetKnowledgeCompatWarningStatsForTests();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("increments warning counters independently", () => {
    recordKnowledgeCompatWarning("implicit_personal_inbox");
    recordKnowledgeCompatWarning("implicit_personal_inbox");
    recordKnowledgeCompatWarning("source_bind_visibility_ignored");

    const stats = readKnowledgeCompatWarningStats();
    expect(stats.implicit_personal_inbox).toBe(2);
    expect(stats.source_bind_visibility_ignored).toBe(1);
    expect(stats.lastUpdatedAtMs).toBeGreaterThan(0);
  });
});
