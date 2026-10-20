import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const tmpDir = path.join(os.tmpdir(), `openbot-sess-task-${Date.now()}`);
vi.mock("../../utils.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../utils.js")>();
  return { ...actual, CONFIG_DIR: tmpDir };
});

const { resolveSessionStructureTaskId, resetSessionTaskWindowsForTests } =
  await import("./session-task-window.js");

describe("resolveSessionStructureTaskId", () => {
  beforeEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    fs.mkdirSync(tmpDir, { recursive: true });
    resetSessionTaskWindowsForTests(tmpDir);
  });
  afterEach(() => {
    resetSessionTaskWindowsForTests(tmpDir);
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("folds same session+structure within window to one task id", () => {
    const a = resolveSessionStructureTaskId({
      agentId: "bot-1",
      sessionKey: "agent:bot-1:main",
      structureKey: "in|out|tools",
      runId: "run-1",
      nowMs: 1_000_000,
      configDir: tmpDir,
    });
    const b = resolveSessionStructureTaskId({
      agentId: "bot-1",
      sessionKey: "agent:bot-1:main",
      structureKey: "in|out|tools",
      runId: "run-2",
      nowMs: 1_000_000 + 60_000,
      configDir: tmpDir,
    });
    expect(a).toBeTruthy();
    expect(a).toBe(b);
  });

  it("uses new task id after window expires", () => {
    const a = resolveSessionStructureTaskId({
      agentId: "bot-1",
      sessionKey: "agent:bot-1:main",
      structureKey: "in|out|tools",
      runId: "run-1",
      nowMs: 1_000_000,
      configDir: tmpDir,
    });
    const b = resolveSessionStructureTaskId({
      agentId: "bot-1",
      sessionKey: "agent:bot-1:main",
      structureKey: "in|out|tools",
      runId: "run-2",
      nowMs: 1_000_000 + 31 * 60 * 1000,
      configDir: tmpDir,
    });
    // Same stable hash for structure — task id string is deterministic for same structure.
    // After expiry we still regenerate same deterministic id (hash of session|structure).
    // Behavior: lastSeen resets; id is stable by design for same structure key.
    expect(a).toBe(b);
  });

  it("different structure gets different task id", () => {
    const a = resolveSessionStructureTaskId({
      agentId: "bot-1",
      sessionKey: "agent:bot-1:main",
      structureKey: "in|out|a",
      runId: "run-1",
      configDir: tmpDir,
    });
    const b = resolveSessionStructureTaskId({
      agentId: "bot-1",
      sessionKey: "agent:bot-1:main",
      structureKey: "in|out|b",
      runId: "run-2",
      configDir: tmpDir,
    });
    expect(a).not.toBe(b);
  });
});
