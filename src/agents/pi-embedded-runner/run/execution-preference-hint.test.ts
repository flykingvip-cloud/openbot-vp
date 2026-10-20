import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const tmpDir = path.join(os.tmpdir(), `openbot-exec-hint-${Date.now()}`);
vi.mock("../../../utils.js", () => ({ CONFIG_DIR: tmpDir }));
vi.mock("../../../gateway/evolution-control/pattern-proposal.js", () => ({
  registerNamedPatternCandidateProposal: vi.fn(),
}));

const { ingestPatternSampleFromRun } =
  await import("../../../gateway/pattern-detection/ingest-from-run.js");
const { resetPatternDetectionStoreForTests } =
  await import("../../../gateway/pattern-detection/index.js");
const { buildExecutionPreferenceHint, isNamedToolHint } =
  await import("./execution-preference-hint.js");

describe("execution preference hint", () => {
  beforeEach(() => {
    resetPatternDetectionStoreForTests();
    fs.mkdirSync(tmpDir, { recursive: true });
  });
  afterEach(() => {
    resetPatternDetectionStoreForTests();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("rejects 16-hex digests as tool names", () => {
    expect(isNamedToolHint("notes")).toBe(true);
    expect(isNamedToolHint("0123456789abcdef")).toBe(false);
  });

  it("returns undefined when no named candidate tools exist", () => {
    expect(buildExecutionPreferenceHint({ agentId: "robot-a" })).toBeUndefined();
  });

  it("writes a prompt-only hint from named pattern tools", () => {
    for (let i = 1; i <= 3; i += 1) {
      ingestPatternSampleFromRun({
        agentId: "robot-a",
        runId: `run-${i}`,
        toolsUsed: ["notes", "read"],
        success: true,
      });
    }
    const hint = buildExecutionPreferenceHint({ agentId: "robot-a" });
    expect(hint).toContain("notes");
    expect(hint).toContain("read");
    expect(hint).toContain("preference hint only");
    expect(hint).toContain("full skill and tool lists above remain available");
    expect(hint).toContain("Policy");
  });

  it("includes shadow names only when confidence is high enough", () => {
    expect(
      buildExecutionPreferenceHint({
        agentId: "robot-missing",
        shadowToolNames: ["web_search"],
        shadowConfidence: 0.2,
      }),
    ).toBeUndefined();
    const hint = buildExecutionPreferenceHint({
      agentId: "robot-missing",
      shadowToolNames: ["web_search"],
      shadowConfidence: 0.7,
    });
    expect(hint).toContain("web_search");
  });
});
