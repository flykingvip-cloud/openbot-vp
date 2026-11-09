/**
 * askOutcome P1 / PR90-A: attempt end-of-run attribution honesty + pattern null chain.
 */
import fs from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { patternTmp } = vi.hoisted(() => ({
  patternTmp: `/tmp/openbot-r90-attr-${Date.now()}`,
}));

vi.mock("../utils.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../utils.js")>();
  // pattern-detection and skill-invocation both resolve CONFIG_DIR from utils.
  // Prefer patternTmp for pattern tests; skill tests recreate under skillTmp via save path.
  return { ...actual, CONFIG_DIR: patternTmp };
});

vi.mock("../gateway/evolution-control/pattern-proposal.js", () => ({
  registerNamedPatternCandidateProposal: vi.fn(),
}));

const { resolveAttemptEndOfRunAttribution } = await import("../agent-runtime/execution/index.js");
const { ingestPatternSampleFromRun, namedToolsFromList } =
  await import("../gateway/pattern-detection/ingest-from-run.js");
const {
  ingestPatternSample,
  listPatternCandidates,
  listPatternSamples,
  resetPatternDetectionStoreForTests,
} = await import("../gateway/pattern-detection/index.js");
const { structureHashFromIo, structureHashFromToolTrace } =
  await import("../gateway/pattern-detection/structure-hash.js");
const { recordLifecycleSkillsLoadedOnRun } = await import("../gateway/skill-invocation/index.js");

describe("R90-A wiring: resolveAttemptEndOfRunAttribution", () => {
  it("normal end → pattern null + skill outcome null (no invented success)", () => {
    const r = resolveAttemptEndOfRunAttribution({
      aborted: false,
      timedOut: false,
      promptError: undefined,
      lastAssistantErrorMessage: null,
    });
    expect(r.runFailed).toBe(false);
    expect(r.patternSuccess).toBeNull();
    expect(r.skillOutcome).toBeNull();
  });

  it("abort/timeout/promptError → pattern false + skill failure", () => {
    expect(
      resolveAttemptEndOfRunAttribution({
        aborted: true,
        timedOut: false,
        promptError: undefined,
      }).patternSuccess,
    ).toBe(false);
    expect(
      resolveAttemptEndOfRunAttribution({
        aborted: false,
        timedOut: true,
        promptError: undefined,
      }).skillOutcome,
    ).toBe("failure");
    expect(
      resolveAttemptEndOfRunAttribution({
        aborted: false,
        timedOut: false,
        promptError: new Error("boom"),
      }).runFailed,
    ).toBe(true);
    expect(
      resolveAttemptEndOfRunAttribution({
        aborted: false,
        timedOut: false,
        promptError: undefined,
        lastAssistantErrorMessage: "model error",
      }).patternSuccess,
    ).toBe(false);
  });
});

describe("R90-A wiring: skill record keeps tools, skips unconfirmed run success", () => {
  const prev = process.env.OPENBOT_PROMPT_NAMED_USE_ATTRIBUTION;

  beforeEach(() => {
    process.env.OPENBOT_PROMPT_NAMED_USE_ATTRIBUTION = "1";
  });

  afterEach(() => {
    if (prev === undefined) {
      delete process.env.OPENBOT_PROMPT_NAMED_USE_ATTRIBUTION;
    } else {
      process.env.OPENBOT_PROMPT_NAMED_USE_ATTRIBUTION = prev;
    }
  });

  it("outcome null does not invent prompt_named_use success", () => {
    const events = recordLifecycleSkillsLoadedOnRun({
      agentId: "bot-r90",
      runId: "run-r90-skill",
      skillNames: ["demo-skill"],
      outcome: null,
      toolsUsed: [{ toolName: "read", success: true, toolCallId: "tc-1" }],
      assistantTexts: ["please use demo-skill"],
    });
    expect(Array.isArray(events)).toBe(true);
    expect(
      events.filter((e) => e.businessOutcome === "prompt_named_use" && e.outcome === "success"),
    ).toHaveLength(0);
  });

  it("known failure path still accepted by recorder", () => {
    expect(() =>
      recordLifecycleSkillsLoadedOnRun({
        agentId: "bot-r90",
        runId: "run-r90-fail",
        skillNames: ["demo-skill"],
        outcome: "failure",
        toolsUsed: [{ toolName: "read", success: false, toolCallId: "tc-2" }],
        assistantTexts: [],
      }),
    ).not.toThrow();
  });
});

describe("R90-A downstream: pattern null full chain", () => {
  beforeEach(() => {
    fs.mkdirSync(patternTmp, { recursive: true });
    resetPatternDetectionStoreForTests();
  });

  afterEach(() => {
    resetPatternDetectionStoreForTests();
    fs.rmSync(patternTmp, { recursive: true, force: true });
  });

  it("ingest from run with success null stores null; hash ≠ ok/error", () => {
    const tools = namedToolsFromList(["read_file", "write_file"]);
    const unknown = ingestPatternSampleFromRun({
      agentId: "bot-r90",
      runId: "run-unknown-1",
      toolsUsed: tools,
      success: null,
    });
    expect(unknown?.sample.success).toBeNull();
    const ok = ingestPatternSampleFromRun({
      agentId: "bot-r90",
      runId: "run-ok-1",
      toolsUsed: tools,
      success: true,
    });
    const err = ingestPatternSampleFromRun({
      agentId: "bot-r90",
      runId: "run-err-1",
      toolsUsed: tools,
      success: false,
    });
    // unknown must not join the judged ok/error cluster (those two historically share shape).
    expect(unknown?.sample.outputStructureHash).not.toBe(ok?.sample.outputStructureHash);
    expect(unknown?.sample.outputStructureHash).not.toBe(err?.sample.outputStructureHash);
  });

  it("null samples stay as clues but do not raise success count or judged denominator", () => {
    const tools = ["tool_a", "tool_b"];
    const inputH = structureHashFromIo("# tools\n- tool_a\n- tool_b", "input");
    const unknownH = structureHashFromIo("# run-outcome-unknown", "output");
    const okH = structureHashFromIo("ok", "output");
    const trace = structureHashFromToolTrace(tools);

    for (let i = 0; i < 3; i++) {
      ingestPatternSample({
        agentId: "bot-r90",
        runId: `run-u-${i}`,
        inputStructureHash: inputH,
        outputStructureHash: unknownH,
        toolTraceHash: trace,
        toolsUsed: tools,
        success: null,
      });
    }
    for (let i = 0; i < 3; i++) {
      ingestPatternSample({
        agentId: "bot-r90",
        runId: `run-s-${i}`,
        inputStructureHash: inputH,
        outputStructureHash: okH,
        toolTraceHash: trace,
        toolsUsed: tools,
        success: true,
      });
    }

    const samples = listPatternSamples().filter((s) => s.agentId === "bot-r90");
    expect(samples.filter((s) => s.success === null)).toHaveLength(3);
    expect(samples.filter((s) => s.success === true)).toHaveLength(3);

    const candidates = listPatternCandidates({ agentId: "bot-r90" });
    const okCandidate = candidates.find((c) => c.lineage.structureKey.includes(okH));
    expect(okCandidate).toBeTruthy();
    expect(okCandidate!.contract.quality.successRate).toBe(1);
    expect(okCandidate!.independentTaskCount).toBe(3);

    const unknownCandidate = candidates.find((c) => c.lineage.structureKey.includes(unknownH));
    if (unknownCandidate) {
      expect(unknownCandidate.contract.quality.successRate).toBeNull();
    }
  });

  it("attempt helper null maps through ingestPatternSampleFromRun", () => {
    const attr = resolveAttemptEndOfRunAttribution({
      aborted: false,
      timedOut: false,
      promptError: undefined,
    });
    const result = ingestPatternSampleFromRun({
      agentId: "bot-r90",
      runId: "run-wire-null",
      toolsUsed: ["read"],
      success: attr.patternSuccess,
    });
    expect(result?.sample.success).toBeNull();
  });
});
