import fs from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { tmpDir } = vi.hoisted(() => ({
  tmpDir: `/tmp/openbot-ingest-from-run-${Date.now()}`,
}));
vi.mock("../../utils.js", () => ({ CONFIG_DIR: tmpDir }));
vi.mock("../evolution-control/pattern-proposal.js", () => ({
  registerNamedPatternCandidateProposal: vi.fn(),
}));

const { ingestPatternSampleFromRun } = await import("./ingest-from-run.js");
const {
  applyToolsUsedByRunId,
  ingestPatternSample,
  listPatternCandidates,
  listPatternSamples,
  resetPatternDetectionStoreForTests,
  structureHashFromText,
} = await import("./index.js");
const { registerNamedPatternCandidateProposal } =
  await import("../evolution-control/pattern-proposal.js");

describe("ingestPatternSampleFromRun", () => {
  beforeEach(() => {
    resetPatternDetectionStoreForTests();
    fs.mkdirSync(tmpDir, { recursive: true });
    vi.mocked(registerNamedPatternCandidateProposal).mockClear();
  });
  afterEach(() => {
    resetPatternDetectionStoreForTests();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("skips ingest when toolsUsed is empty", () => {
    expect(
      ingestPatternSampleFromRun({
        agentId: "robot-a",
        runId: "run-empty",
        toolsUsed: [],
        success: true,
      }),
    ).toBeNull();
    expect(listPatternSamples()).toHaveLength(0);
  });

  it("records named toolsUsed and promotes a candidate after three runs", () => {
    for (let i = 1; i <= 3; i += 1) {
      const result = ingestPatternSampleFromRun({
        agentId: "robot-a",
        runId: `run-${i}`,
        toolsUsed: ["notes", "read"],
        success: true,
      });
      expect(result?.sample.toolsUsed).toEqual(["notes", "read"]);
    }
    const candidates = listPatternCandidates({ agentId: "robot-a" });
    expect(candidates).toHaveLength(1);
    expect(candidates[0]?.contract.toolsRequired).toEqual(["notes", "read"]);
    expect(registerNamedPatternCandidateProposal).toHaveBeenCalled();
  });

  it("backfills empty toolsUsed on an earlier sample for the same runId", () => {
    const hash = structureHashFromText("# Weekly report\n- a\n- b");
    ingestPatternSample({
      agentId: "robot-a",
      runId: "run-shared",
      inputStructureHash: hash,
      outputStructureHash: hash,
      success: true,
    });
    expect(listPatternSamples()[0]?.toolsUsed ?? null).toBeNull();
    const patched = applyToolsUsedByRunId("run-shared", ["web_search"]);
    expect(patched).toHaveLength(1);
    expect(listPatternSamples()[0]?.toolsUsed).toEqual(["web_search"]);
  });
});
