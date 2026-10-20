import {
  buildLogicalArtifact,
  collectCollectorTexts,
  computeLogicalArtifactDigest,
} from "./artifact.ts";
import {
  isHexDigest16,
  PERF_GENERATOR_VERSION,
  PERF_SCHEMA,
  scanForbiddenSubstrings,
} from "./ids.ts";
import { summarizeSamples } from "./metrics.ts";
import { SCENARIO_TYPES, type PerformanceSample, type PerformanceSummary } from "./types.ts";

export type PerformanceValidation = {
  ok: boolean;
  errors: string[];
};

const MIN_SUCCESS_SAMPLES = 20;
const MIN_PER_SCENARIO = 5;

function sampleErrors(sample: PerformanceSample, sourceCommit: string): string[] {
  const errors: string[] = [];
  if (sample.sourceCommit !== sourceCommit) {
    errors.push(`${sample.runIdDigest} sourceCommit mismatch`);
  }
  if (!isHexDigest16(sample.runIdDigest)) {
    errors.push(`${sample.runIdDigest} runIdDigest`);
  }
  if (!isHexDigest16(sample.sessionKeyHash)) {
    errors.push(`${sample.runIdDigest} sessionKeyHash`);
  }
  if (!isHexDigest16(sample.providerDigest) || !isHexDigest16(sample.modelDigest)) {
    errors.push(`${sample.runIdDigest} model digest`);
  }
  if (sample.clockKind !== "real_wall_clock" || !sample.invariants.realClock) {
    errors.push(`${sample.runIdDigest} clock is not real_wall_clock`);
  }
  if (sample.usageProvenance !== "model_return" || !sample.invariants.usageFromModel) {
    errors.push(`${sample.runIdDigest} usage is not model_return`);
  }
  if (!sample.invariants.usagePresent) {
    errors.push(`${sample.runIdDigest} missing usage`);
  }
  if (!sample.invariants.sameRunId) {
    errors.push(`${sample.runIdDigest} runId mismatch`);
  }
  const latencies = [sample.routePrepMs, sample.ttftMs, sample.totalMs];
  if (
    latencies.some((value) => !Number.isFinite(value) || value < 0) ||
    !sample.invariants.latenciesNonNegative
  ) {
    errors.push(`${sample.runIdDigest} negative latency`);
  }
  if (
    !Number.isFinite(sample.promptTokens) ||
    !Number.isFinite(sample.ttftMs) ||
    !Number.isFinite(sample.totalMs)
  ) {
    errors.push(`${sample.runIdDigest} missing promptTokens/TTFT/totalMs`);
  }
  return errors;
}

export function validatePerformanceSummary(params: {
  summary: PerformanceSummary;
  expectedSourceCommit: string;
  expectedArtifactSha256: string;
  repoRoot?: string;
  requireCoverage?: boolean;
}): PerformanceValidation {
  const errors: string[] = [];
  const { summary } = params;
  const requireCoverage = params.requireCoverage ?? true;
  if (summary.schema !== PERF_SCHEMA) {
    errors.push(`schema ${summary.schema}`);
  }
  if (summary.generatorVersion !== PERF_GENERATOR_VERSION) {
    errors.push(`generatorVersion ${summary.generatorVersion}`);
  }
  if (summary.metricsKind !== "operational_performance") {
    errors.push(`metricsKind ${summary.metricsKind}`);
  }
  if (summary.sourceCommit !== params.expectedSourceCommit) {
    errors.push(`sourceCommit ${summary.sourceCommit} != ${params.expectedSourceCommit}`);
  }
  if (summary.artifactSha256 !== params.expectedArtifactSha256) {
    errors.push("hash mismatch");
  }
  if (params.repoRoot) {
    const recomputed = computeLogicalArtifactDigest({
      sourceCommit: summary.sourceCommit,
      collectorTexts: collectCollectorTexts(params.repoRoot),
      productionBlobShas: summary.productionBlobShas,
    });
    if (recomputed !== summary.artifactSha256) {
      errors.push("hash mismatch");
    }
  }
  if (summary.memoryFinalSize !== 0) {
    errors.push(`memoryFinalSize ${summary.memoryFinalSize}`);
  }
  const runIds = new Set<string>();
  const samples = summary.samples;
  for (const sample of samples) {
    if (runIds.has(sample.runIdDigest)) {
      errors.push(`duplicate runId ${sample.runIdDigest}`);
    }
    runIds.add(sample.runIdDigest);
    errors.push(...sampleErrors(sample, summary.sourceCommit));
  }
  if (requireCoverage) {
    if (summary.sampleCount < MIN_SUCCESS_SAMPLES || samples.length < MIN_SUCCESS_SAMPLES) {
      errors.push(`sampleCount ${summary.sampleCount} < ${MIN_SUCCESS_SAMPLES}`);
    }
    for (const type of SCENARIO_TYPES) {
      const count = summary.scenarioCounts[type] ?? 0;
      if (count < MIN_PER_SCENARIO) {
        errors.push(`${type} coverage ${count} < ${MIN_PER_SCENARIO}`);
      }
    }
  }
  if (samples.length > 0) {
    const recomputed = summarizeSamples(samples);
    if (JSON.stringify(recomputed) !== JSON.stringify(summary.aggregate)) {
      errors.push("aggregate metrics not reproducible");
    }
  }
  const privacyHits = scanForbiddenSubstrings(JSON.stringify(summary));
  if (privacyHits.length > 0 || summary.privacy.hitCount !== privacyHits.length) {
    errors.push(`privacy ${privacyHits.join(",") || "count mismatch"}`);
  }
  if (/agent:[a-z0-9_-]+:/i.test(JSON.stringify(summary))) {
    errors.push("privacy raw session identity");
  }
  return { ok: errors.length === 0, errors };
}

export function validateAgainstRepo(
  repoRoot: string,
  summary: PerformanceSummary,
  options?: { requireCoverage?: boolean },
): PerformanceValidation {
  const logical = buildLogicalArtifact(repoRoot, summary.sourceCommit);
  return validatePerformanceSummary({
    summary,
    expectedSourceCommit: logical.sourceCommit,
    expectedArtifactSha256: logical.artifactSha256,
    repoRoot,
    requireCoverage: options?.requireCoverage,
  });
}
