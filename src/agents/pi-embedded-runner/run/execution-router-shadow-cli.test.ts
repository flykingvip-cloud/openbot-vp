import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import {
  TRACKED_SUMMARY_RELPATH,
  TRACKED_SUMMARY_SHA_RELPATH,
  buildLogicalArtifact,
  gitPorcelain,
  resolveRepoRoot,
} from "../../../../.kiro/specs/execution-router-phase0/shadow/artifact.ts";
import {
  runAccept,
  runCollect,
  runCollectPerf,
} from "../../../../.kiro/specs/execution-router-phase0/shadow/cli.ts";
import {
  SHADOW_GENERATOR_VERSION,
  SHADOW_SCHEMA,
} from "../../../../.kiro/specs/execution-router-phase0/shadow/ids.ts";
import type { ShadowSummary } from "../../../../.kiro/specs/execution-router-phase0/shadow/types.ts";

const repoRoot = resolveRepoRoot();

function trackedEvidence(): string {
  return [TRACKED_SUMMARY_RELPATH, TRACKED_SUMMARY_SHA_RELPATH]
    .map((relPath) => readFileSync(path.join(repoRoot, relPath), "utf8"))
    .join("\n---\n");
}

function baseCandidate(): ShadowSummary {
  const logical = buildLogicalArtifact(repoRoot);
  return {
    schema: SHADOW_SCHEMA,
    version: "1.0.0",
    generatorVersion: SHADOW_GENERATOR_VERSION,
    sourceCommit: logical.sourceCommit,
    observationFlag: "OPENBOT_EXECUTION_ROUTER_OBSERVATION=1",
    artifactSha256: logical.artifactSha256,
    productionBlobShas: logical.productionBlobShas,
    collectedAt: "2026-09-06T00:00:00.000Z",
    metricsKind: "harness_calculation",
    sampleCount: 0,
    completeCount: 0,
    errorTtlCount: 0,
    memoryFinalSize: 0,
    metrics: {
      requiredSkillRecall: null,
      requiredToolRecall: null,
      ttftMsAvg: null,
      promptTokensAvg: null,
      firstToolSuccessRate: null,
    },
    samples: [],
  };
}

function writeTempCandidate(mutate: (summary: ShadowSummary) => void): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), "openbot-shadow-cli-"));
  const dest = path.join(dir, "candidate.json");
  const summary = baseCandidate();
  mutate(summary);
  writeFileSync(dest, `${JSON.stringify(summary, null, 2)}\n`);
  return dest;
}

describe("Phase 0 shadow collect/accept CLI", () => {
  const tempPaths: string[] = [];
  let porcelainBaseline = "";
  let evidenceBaseline = "";

  beforeAll(() => {
    porcelainBaseline = gitPorcelain(repoRoot);
    evidenceBaseline = trackedEvidence();
  });

  afterEach(() => {
    while (tempPaths.length > 0) {
      const target = tempPaths.pop();
      if (target) {
        rmSync(target, { recursive: true, force: true });
      }
    }
    expect(trackedEvidence()).toBe(evidenceBaseline);
    expect(gitPorcelain(repoRoot)).toBe(porcelainBaseline);
  });

  it("collect refuses the tracked summary path", () => {
    expect(() =>
      runCollect({
        repoRoot,
        output: path.join(repoRoot, TRACKED_SUMMARY_RELPATH),
      }),
    ).toThrow(/tracked summary\.json/);
  });

  it("collect refuses to overwrite by default", () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "openbot-shadow-cli-"));
    tempPaths.push(dir);
    const output = path.join(dir, "existing.json");
    writeFileSync(output, "{}\n");
    expect(() => runCollect({ repoRoot, output })).toThrow(/refusing to overwrite/);
  });

  it("accept refuses a wrong source SHA", () => {
    const input = writeTempCandidate((summary) => {
      summary.sourceCommit = "0000000000000000000000000000000000000000";
    });
    tempPaths.push(path.dirname(input));
    expect(() => runAccept({ repoRoot, input })).toThrow(/sourceCommit/);
  });

  it("accept refuses a wrong artifact digest", () => {
    const input = writeTempCandidate((summary) => {
      summary.artifactSha256 = "0".repeat(64);
    });
    tempPaths.push(path.dirname(input));
    expect(() => runAccept({ repoRoot, input })).toThrow(/artifactSha256/);
  });

  it("accept refuses a privacy hit", () => {
    const input = writeTempCandidate((summary) => {
      summary.collectedAt = "agent:main:privacy-hit";
    });
    tempPaths.push(path.dirname(input));
    expect(() => runAccept({ repoRoot, input })).toThrow(/privacy/);
  });

  it("accept only accepts harness_calculation", () => {
    const input = writeTempCandidate((summary) => {
      summary.metricsKind = "operational_performance";
    });
    tempPaths.push(path.dirname(input));
    expect(() => runAccept({ repoRoot, input })).toThrow(/harness_calculation/);
  });

  it("collect-perf stays fail closed", () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "openbot-shadow-cli-"));
    tempPaths.push(dir);
    const output = path.join(dir, "perf.json");
    expect(() => runCollectPerf({ output })).toThrow(/not accepted yet/);
    expect(() => runCollectPerf({ output, force: true })).toThrow(/not accepted yet/);
  });
});
