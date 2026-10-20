import { readFileSync } from "node:fs";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import {
  PRODUCTION_OBSERVATION_PATHS,
  TRACKED_SUMMARY_RELPATH,
  TRACKED_SUMMARY_SHA_RELPATH,
  assertProductionIdentity,
  buildLogicalArtifact,
  collectCollectorTexts,
  gitPorcelain,
  isCommitAncestor,
  readHeadCommit,
  readSourceCommit,
  resolveRepoRoot,
} from "../../../../.kiro/specs/execution-router-phase0/shadow/artifact.ts";
import { sha256Hex } from "../../../../.kiro/specs/execution-router-phase0/shadow/ids.ts";
import type { ShadowSummary } from "../../../../.kiro/specs/execution-router-phase0/shadow/types.ts";
import {
  recomputeShadowMetrics,
  validateShadowSummary,
} from "../../../../.kiro/specs/execution-router-phase0/shadow/validate.ts";

describe("Phase 0 accepted shadow summary revalidation", () => {
  const repoRoot = resolveRepoRoot();
  let porcelainBaseline = "";
  let summary: ShadowSummary;
  let serialized: string;

  beforeAll(() => {
    porcelainBaseline = gitPorcelain(repoRoot);
    serialized = readFileSync(path.join(repoRoot, TRACKED_SUMMARY_RELPATH), "utf8");
    summary = JSON.parse(serialized) as ShadowSummary;
  });

  it("matches the current origin/main harness contract", () => {
    const logical = buildLogicalArtifact(repoRoot);
    const fileSha = readFileSync(path.join(repoRoot, TRACKED_SUMMARY_SHA_RELPATH), "utf8").trim();
    const validation = validateShadowSummary({
      summary,
      expectedSourceCommit: logical.sourceCommit,
      expectedArtifactSha256: logical.artifactSha256,
      collectorTexts: collectCollectorTexts(repoRoot),
    });

    expect(summary.metricsKind).toBe("harness_calculation");
    expect(summary.productionBlobShas).toEqual(logical.productionBlobShas);
    expect(Object.keys(summary.productionBlobShas)).toEqual([...PRODUCTION_OBSERVATION_PATHS]);
    expect(summary.sourceCommit).toBe(readSourceCommit(repoRoot));
    expect(summary.sourceCommit).toBe(logical.sourceCommit);
    expect(isCommitAncestor(repoRoot, summary.sourceCommit, readHeadCommit(repoRoot))).toBe(true);
    const identity = assertProductionIdentity(repoRoot, summary.sourceCommit);
    expect(identity.every((row) => row.sourceBlobSha === row.headBlobSha)).toBe(true);
    expect(identity.every((row) => row.headBlobSha === row.worktreeBlobSha)).toBe(true);
    expect(summary.artifactSha256).toBe(logical.artifactSha256);
    expect(summary.completeCount).toBe(50);
    expect(summary.errorTtlCount).toBe(5);
    expect(summary.sampleCount).toBe(55);
    expect(summary.memoryFinalSize).toBe(0);
    expect(summary.samples.every((sample) => sample.privacyHits.length === 0)).toBe(true);
    expect(validation.ok).toBe(true);
    expect(validation.errors).toEqual([]);
    expect(recomputeShadowMetrics(summary)).toEqual(summary.metrics);
    expect(sha256Hex(serialized)).toBe(fileSha);
    expect(gitPorcelain(repoRoot)).toBe(porcelainBaseline);
  });
});
