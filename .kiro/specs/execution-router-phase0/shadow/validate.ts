import { computeLogicalArtifactDigest } from "./artifact.ts";
import {
  SHADOW_GENERATOR_VERSION,
  SHADOW_SCHEMA,
  isSessionKeyHash,
  scanForbiddenSubstrings,
} from "./ids.ts";
import { SHADOW_CATEGORIES, type ShadowSummary } from "./types.ts";

export type ShadowValidation = {
  ok: boolean;
  errors: string[];
};

function notAfter(left?: number, right?: number): boolean {
  return left == null || right == null || left <= right;
}

function stagesMonotonic(stages: Record<string, number>): boolean {
  const values = Object.values(stages);
  if (values.some((value) => !Number.isFinite(value) || value < 0)) {
    return false;
  }
  // Live order: inbound → model_started (agent-runner) → Skill/Tool/prompt-ready
  // (attempt) → first_token → run_completed. model_started may precede prep.
  return (
    notAfter(stages.inbound_accepted, stages.skill_snapshot_ready) &&
    notAfter(stages.skill_snapshot_ready, stages.tool_set_ready) &&
    notAfter(stages.tool_set_ready, stages.system_prompt_ready) &&
    notAfter(stages.inbound_accepted, stages.model_started) &&
    notAfter(stages.model_started, stages.first_token) &&
    notAfter(stages.inbound_accepted, stages.run_completed) &&
    notAfter(stages.system_prompt_ready, stages.run_completed)
  );
}

export function validateShadowSummary(params: {
  summary: ShadowSummary;
  expectedSourceCommit: string;
  expectedArtifactSha256: string;
  collectorTexts?: Record<string, string>;
}): ShadowValidation {
  const errors: string[] = [];
  const { summary } = params;
  if (summary.schema !== SHADOW_SCHEMA) {
    errors.push(`schema ${summary.schema}`);
  }
  if (summary.generatorVersion !== SHADOW_GENERATOR_VERSION) {
    errors.push(`generatorVersion ${summary.generatorVersion}`);
  }
  if (summary.sourceCommit !== params.expectedSourceCommit) {
    errors.push(`sourceCommit ${summary.sourceCommit} != ${params.expectedSourceCommit}`);
  }
  if (summary.artifactSha256 !== params.expectedArtifactSha256) {
    errors.push("artifactSha256 mismatch");
  }
  if (summary.metricsKind !== "harness_calculation") {
    errors.push(`metricsKind ${summary.metricsKind} is not harness_calculation`);
  }
  if (!summary.productionBlobShas || Object.keys(summary.productionBlobShas).length === 0) {
    errors.push("productionBlobShas missing");
  }
  if (params.collectorTexts) {
    const recomputed = computeLogicalArtifactDigest({
      sourceCommit: summary.sourceCommit,
      collectorTexts: params.collectorTexts,
      productionBlobShas: summary.productionBlobShas,
    });
    if (recomputed !== summary.artifactSha256) {
      errors.push("logical artifact digest not reproducible without collectedAt");
    }
  }
  if (summary.observationFlag !== "OPENBOT_EXECUTION_ROUTER_OBSERVATION=1") {
    errors.push("observation flag not recorded as on");
  }
  if (summary.completeCount < 50) {
    errors.push(`completeCount ${summary.completeCount} < 50`);
  }
  if (summary.errorTtlCount < 5) {
    errors.push(`errorTtlCount ${summary.errorTtlCount} < 5`);
  }
  if (summary.memoryFinalSize !== 0) {
    errors.push(`memoryFinalSize ${summary.memoryFinalSize}`);
  }
  const completeByCategory = new Map<string, number>();
  const runIds = new Set<string>();
  for (const sample of summary.samples) {
    if (runIds.has(sample.runIdDigest)) {
      errors.push(`duplicate runIdDigest ${sample.runIdDigest}`);
    }
    runIds.add(sample.runIdDigest);
    if (sample.sessionKeyHash && !isSessionKeyHash(sample.sessionKeyHash)) {
      errors.push(`${sample.runIdDigest} sessionKeyHash`);
    }
    if (sample.privacyHits.length > 0) {
      errors.push(`${sample.runIdDigest} privacy ${sample.privacyHits.join(",")}`);
    }
    if (!sample.invariants.sameRunId) {
      errors.push(`${sample.runIdDigest} runId association`);
    }
    if (!sample.invariants.eligibleGteInjected) {
      errors.push(`${sample.runIdDigest} eligible < injected`);
    }
    if (!sample.invariants.constructedGteAfterPolicy) {
      errors.push(`${sample.runIdDigest} constructed < afterPolicy`);
    }
    if (!sample.invariants.exposedMatchesAllowlist) {
      errors.push(`${sample.runIdDigest} exposed != allowlist`);
    }
    if (!sample.invariants.latenciesNonNegative) {
      errors.push(`${sample.runIdDigest} negative latency`);
    }
    if (!stagesMonotonic(sample.stages) || !sample.invariants.stagesMonotonic) {
      errors.push(`${sample.runIdDigest} stages not monotonic`);
    }
    if (sample.terminalKind === "run_completed") {
      completeByCategory.set(sample.category, (completeByCategory.get(sample.category) ?? 0) + 1);
      if (!sample.invariants.terminalComplete || sample.stages.run_completed == null) {
        errors.push(`${sample.runIdDigest} missing run_completed`);
      }
    }
  }
  for (const category of SHADOW_CATEGORIES) {
    const count = completeByCategory.get(category) ?? 0;
    if (count < 5) {
      errors.push(`${category} complete ${count} < 5`);
    }
  }
  const metrics = summary.metrics;
  for (const [name, value] of Object.entries(metrics)) {
    if (value != null && (!Number.isFinite(value) || value < 0)) {
      errors.push(`metric ${name}=${value}`);
    }
  }
  const serialized = JSON.stringify(summary);
  const privacyHits = scanForbiddenSubstrings(serialized);
  if (privacyHits.length > 0) {
    errors.push(`summary privacy ${privacyHits.join(",")}`);
  }
  if (/agent:[a-z0-9_-]+:/i.test(serialized)) {
    errors.push("raw sessionKey hit");
  }
  return { ok: errors.length === 0, errors };
}

export function recomputeShadowMetrics(summary: ShadowSummary): ShadowSummary["metrics"] {
  const complete = summary.samples.filter((sample) => sample.terminalKind === "run_completed");
  const skillHits = complete.flatMap((sample) =>
    sample.requiredSkillDigests.filter((id) => sample.injectedSkillDigests.includes(id)),
  ).length;
  const skillGold = complete.reduce((sum, sample) => sum + sample.requiredSkillDigests.length, 0);
  const toolHits = complete.flatMap((sample) =>
    sample.requiredToolDigests.filter((id) => sample.exposedToolDigests.includes(id)),
  ).length;
  const toolGold = complete.reduce((sum, sample) => sum + sample.requiredToolDigests.length, 0);
  const ttfts = complete
    .map((sample) => sample.latencies.ttftMs)
    .filter((value): value is number => typeof value === "number");
  const tokens = complete
    .map((sample) => sample.promptTokens)
    .filter((value): value is number => typeof value === "number");
  const firstTools = complete.filter((sample) => sample.firstToolSuccess != null);
  const firstOk = firstTools.filter((sample) => sample.firstToolSuccess).length;
  return {
    requiredSkillRecall: skillGold > 0 ? skillHits / skillGold : null,
    requiredToolRecall: toolGold > 0 ? toolHits / toolGold : null,
    ttftMsAvg: ttfts.length > 0 ? ttfts.reduce((a, b) => a + b, 0) / ttfts.length : null,
    promptTokensAvg: tokens.length > 0 ? tokens.reduce((a, b) => a + b, 0) / tokens.length : null,
    firstToolSuccessRate: firstTools.length > 0 ? firstOk / firstTools.length : null,
  };
}
