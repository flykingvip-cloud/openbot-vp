import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { gitPorcelain, readSourceCommit, resolveRepoRoot } from "./artifact.ts";
import {
  collectorMemorySize,
  ingestCapture,
  isTrackedSummaryPath,
  main as collectMain,
  resetCollectorMemory,
  toPerformanceSample,
  writePerformanceSummary,
} from "./collect-performance.ts";
import { SCENARIO_TYPES, type CaptureInput, type ScenarioType } from "./types.ts";
import { mapModelUsage } from "./usage.ts";
import { validateAgainstRepo, validatePerformanceSummary } from "./validate-performance.ts";

const repoRoot = resolveRepoRoot();

function capture(overrides: Partial<CaptureInput> = {}): CaptureInput {
  return {
    runId: overrides.runId ?? `run-${Math.random().toString(16).slice(2)}`,
    sessionKey: overrides.sessionKey ?? `session-${Math.random().toString(16).slice(2)}`,
    scenarioType: overrides.scenarioType ?? "plain_text_qa",
    provider: overrides.provider ?? "openai",
    model: overrides.model ?? "gpt-test-1",
    skillCount: overrides.skillCount ?? 0,
    toolCount: overrides.toolCount ?? 0,
    usage:
      overrides.usage === undefined
        ? { promptTokens: 11, completionTokens: 7, totalTokens: 18 }
        : overrides.usage,
    usageProvenance: overrides.usageProvenance ?? "model_return",
    clockKind: overrides.clockKind ?? "real_wall_clock",
    routePrepMs: overrides.routePrepMs ?? 12,
    ttftMs: overrides.ttftMs ?? 40,
    totalMs: overrides.totalMs ?? 90,
    toolCallCount: overrides.toolCallCount ?? 0,
    firstToolSuccess: overrides.firstToolSuccess ?? null,
    fallbackCount: overrides.fallbackCount ?? 0,
    terminalStatus: overrides.terminalStatus ?? "success",
    errorClass: overrides.errorClass ?? null,
    terminalRunId: overrides.terminalRunId,
  };
}

function twentyCaptures(): CaptureInput[] {
  const types: ScenarioType[] = [
    ...SCENARIO_TYPES,
    ...SCENARIO_TYPES,
    ...SCENARIO_TYPES,
    ...SCENARIO_TYPES,
    ...SCENARIO_TYPES,
  ];
  return types.map((scenarioType, index) =>
    capture({
      runId: `run-${index}`,
      sessionKey: `session-${index}`,
      scenarioType,
      usage: {
        promptTokens: 10 + index,
        completionTokens: 4 + (index % 3),
        totalTokens: 14 + index + (index % 3),
      },
      ttftMs: 30 + index,
      totalMs: 80 + index * 2,
      toolCallCount: scenarioType.includes("tool") ? 1 + (index % 2) : 0,
      firstToolSuccess: scenarioType.includes("tool") ? true : null,
    }),
  );
}

describe("Phase 0.3 performance evidence P1", () => {
  let porcelainBaseline = "";
  const temps: string[] = [];

  beforeAll(() => {
    porcelainBaseline = gitPorcelain(repoRoot);
  });

  afterEach(() => {
    resetCollectorMemory();
    while (temps.length > 0) {
      const target = temps.pop();
      if (target) {
        rmSync(target, { recursive: true, force: true });
      }
    }
    expect(gitPorcelain(repoRoot)).toBe(porcelainBaseline);
  });

  it("maps real model usage fields", () => {
    expect(mapModelUsage({ prompt_tokens: 21, completion_tokens: 9, total_tokens: 30 })).toEqual({
      promptTokens: 21,
      completionTokens: 9,
      totalTokens: 30,
      provenance: "model_return",
    });
  });

  it("rejects a sample with missing usage", () => {
    expect(() => toPerformanceSample(capture({ usage: null }), readSourceCommit(repoRoot))).toThrow(
      /missing usage/,
    );
    expect(() =>
      toPerformanceSample(capture({ usage: { promptTokens: 3 } }), readSourceCommit(repoRoot)),
    ).toThrow(/missing usage/);
  });

  it("rejects constant or synthetic usage marks", () => {
    const sourceCommit = readSourceCommit(repoRoot);
    expect(() =>
      toPerformanceSample(capture({ usageProvenance: "constant" }), sourceCommit),
    ).toThrow(/forged usage marked constant/);
    expect(() =>
      toPerformanceSample(capture({ usageProvenance: "synthetic" }), sourceCommit),
    ).toThrow(/forged usage marked synthetic/);
  });

  it("rejects runId mismatch between usage terminal and capture", () => {
    expect(() =>
      toPerformanceSample(
        capture({ runId: "run-a", terminalRunId: "run-b" }),
        readSourceCommit(repoRoot),
      ),
    ).toThrow(/runId mismatch/);
  });

  it("rejects source/HEAD/worktree identity mismatch", () => {
    const relPath = "src/gateway/execution-router-observation.ts";
    const original = readFileSync(path.join(repoRoot, relPath), "utf8");
    writeFileSync(path.join(repoRoot, relPath), `${original}\n// phase03-identity-probe\n`);
    try {
      expect(() =>
        writePerformanceSummary({
          repoRoot,
          output: path.join(os.tmpdir(), "should-not-write.json"),
          samples: [],
          requireCoverage: false,
        }),
      ).toThrow(/source\/HEAD\/worktree identity mismatch/);
    } finally {
      writeFileSync(path.join(repoRoot, relPath), original);
    }
  });

  it("rejects negative latency", () => {
    expect(() => toPerformanceSample(capture({ ttftMs: -1 }), readSourceCommit(repoRoot))).toThrow(
      /negative latency/,
    );
  });

  it("rejects duplicate runId", () => {
    const sourceCommit = readSourceCommit(repoRoot);
    const first = capture({ runId: "dup-run" });
    ingestCapture(first, sourceCommit);
    expect(() => ingestCapture(first, sourceCommit)).toThrow(/duplicate runId/);
  });

  it("rejects privacy fields", () => {
    expect(() =>
      toPerformanceSample(
        capture({
          model: "sk-secret-model",
        }),
        readSourceCommit(repoRoot),
      ),
    ).toThrow(/privacy/);
  });

  it("rejects insufficient sample count and scenario coverage", () => {
    const sourceCommit = readSourceCommit(repoRoot);
    const samples = [toPerformanceSample(capture({ runId: "only-one" }), sourceCommit)];
    expect(() =>
      writePerformanceSummary({
        repoRoot,
        output: path.join(mkdtempSync(path.join(os.tmpdir(), "phase03-cov-")), "out.json"),
        samples,
        requireCoverage: true,
      }),
    ).toThrow(/sampleCount|coverage/);
  });

  it("rejects a hash mismatch", () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "phase03-hash-"));
    temps.push(dir);
    const sourceCommit = readSourceCommit(repoRoot);
    const samples = twentyCaptures().map((input) => toPerformanceSample(input, sourceCommit));
    const output = path.join(dir, "summary.json");
    const summary = writePerformanceSummary({
      repoRoot,
      output,
      samples,
      requireCoverage: true,
    });
    summary.artifactSha256 = "0".repeat(64);
    const result = validatePerformanceSummary({
      summary,
      expectedSourceCommit: sourceCommit,
      expectedArtifactSha256: "1".repeat(64),
      repoRoot,
      requireCoverage: true,
    });
    expect(result.ok).toBe(false);
    expect(result.errors.some((error) => /hash mismatch/.test(error))).toBe(true);
  });

  it("does not overwrite an existing file by default", () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "phase03-ow-"));
    temps.push(dir);
    const output = path.join(dir, "summary.json");
    writeFileSync(output, "{}\n");
    const sourceCommit = readSourceCommit(repoRoot);
    expect(() =>
      writePerformanceSummary({
        repoRoot,
        output,
        samples: twentyCaptures().map((input) => toPerformanceSample(input, sourceCommit)),
        requireCoverage: true,
      }),
    ).toThrow(/refusing to overwrite/);
    expect(readFileSync(output, "utf8")).toBe("{}\n");
    expect(
      isTrackedSummaryPath(
        repoRoot,
        path.join(repoRoot, ".kiro/specs/execution-router-phase03/performance-summary.json"),
      ),
    ).toBe(true);
  });

  it("writes a sanitized candidate, leaves collector memory at 0, and keeps the worktree clean", () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "phase03-ok-"));
    temps.push(dir);
    const sourceCommit = readSourceCommit(repoRoot);
    const samples = twentyCaptures().map((input) => toPerformanceSample(input, sourceCommit));
    const output = path.join(dir, "performance-summary.json");
    for (const sample of samples) {
      ingestCapture(
        capture({
          runId: `live-${sample.runIdDigest}`,
          sessionKey: `sess-${sample.runIdDigest}`,
          scenarioType: sample.scenarioType,
          usage: {
            promptTokens: sample.promptTokens,
            completionTokens: sample.completionTokens,
            totalTokens: sample.totalTokens,
          },
        }),
        sourceCommit,
      );
    }
    expect(collectorMemorySize()).toBe(20);
    const summary = writePerformanceSummary({
      repoRoot,
      output,
      samples,
      requireCoverage: true,
    });
    expect(collectorMemorySize()).toBe(0);
    expect(existsSync(output)).toBe(true);
    expect(summary.privacy.hitCount).toBe(0);
    expect(summary.memoryFinalSize).toBe(0);
    expect(validateAgainstRepo(repoRoot, summary).ok).toBe(true);
    expect(gitPorcelain(repoRoot)).toBe(porcelainBaseline);
  });

  it("CLI collect-performance refuses to invent live samples", () => {
    expect(() =>
      collectMain(
        ["node", "collect-performance.ts", "--output", "/tmp/phase03-nope.json"],
        repoRoot,
      ),
    ).toThrow(/P2 live collection is not accepted yet/);
  });
});
