import {
  SHADOW_GENERATOR_VERSION,
  SHADOW_SCHEMA,
  digestCatalogId,
  scanForbiddenSubstrings,
} from "./ids.ts";
import type {
  ShadowCategory,
  ShadowInvariants,
  ShadowMetrics,
  ShadowSample,
  ShadowSummary,
} from "./types.ts";

export type ShadowObservationInput = {
  envelope: { runId: string; sessionKeyHash?: string };
  stages: Record<string, number | undefined>;
  skillBaseline?: { eligibleCount: number; injectedCount: number };
  toolBaseline?: { constructedCount: number; afterPolicyCount: number; exposedCount: number };
  latencies: { routePrepMs?: number; ttftMs?: number; totalMs?: number };
};

export type SampleInput = {
  category: ShadowCategory;
  terminalKind: "run_completed" | "error_ttl";
  runId: string;
  observation: ShadowObservationInput;
  expectedAllowlistCount: number;
  requiredSkillNames: string[];
  requiredToolNames: string[];
  injectedSkillNames: string[];
  exposedToolNames: string[];
  firstToolName?: string;
  firstToolSuccess?: boolean;
  promptTokens?: number;
};

function buildInvariants(input: SampleInput): ShadowInvariants {
  const stages = input.observation.stages;
  const skill = input.observation.skillBaseline;
  const tool = input.observation.toolBaseline;
  const latencies = Object.values(input.observation.latencies);
  const notAfter = (left?: number, right?: number) =>
    left == null || right == null || left <= right;
  return {
    sameRunId: input.observation.envelope.runId === input.runId,
    eligibleGteInjected: !skill || skill.eligibleCount >= skill.injectedCount,
    constructedGteAfterPolicy: !tool || tool.constructedCount >= tool.afterPolicyCount,
    exposedMatchesAllowlist: !tool || tool.exposedCount === input.expectedAllowlistCount,
    stagesMonotonic:
      notAfter(stages.inbound_accepted, stages.skill_snapshot_ready) &&
      notAfter(stages.skill_snapshot_ready, stages.tool_set_ready) &&
      notAfter(stages.tool_set_ready, stages.system_prompt_ready) &&
      notAfter(stages.inbound_accepted, stages.model_started) &&
      notAfter(stages.model_started, stages.first_token) &&
      notAfter(stages.inbound_accepted, stages.run_completed) &&
      notAfter(stages.system_prompt_ready, stages.run_completed),
    latenciesNonNegative: latencies.every((value) => typeof value === "number" && value >= 0),
    terminalComplete:
      input.terminalKind !== "run_completed" || typeof stages.run_completed === "number",
  };
}

export function toShadowSample(input: SampleInput): ShadowSample {
  const requiredSkillDigests = input.requiredSkillNames.map((name) =>
    digestCatalogId("skill", name),
  );
  const requiredToolDigests = input.requiredToolNames.map((name) => digestCatalogId("tool", name));
  const injectedSkillDigests = input.injectedSkillNames.map((name) =>
    digestCatalogId("skill", name),
  );
  const exposedToolDigests = input.exposedToolNames.map((name) => digestCatalogId("tool", name));
  const sample: ShadowSample = {
    category: input.category,
    terminalKind: input.terminalKind,
    runIdDigest: digestCatalogId("run", input.runId),
    sessionKeyHash: input.observation.envelope.sessionKeyHash,
    stages: Object.fromEntries(
      Object.entries(input.observation.stages).filter(
        (entry): entry is [string, number] => typeof entry[1] === "number",
      ),
    ),
    skillEligibleCount: input.observation.skillBaseline?.eligibleCount,
    skillInjectedCount: input.observation.skillBaseline?.injectedCount,
    toolConstructedCount: input.observation.toolBaseline?.constructedCount,
    toolAfterPolicyCount: input.observation.toolBaseline?.afterPolicyCount,
    toolExposedCount: input.observation.toolBaseline?.exposedCount,
    expectedAllowlistCount: input.expectedAllowlistCount,
    latencies: { ...input.observation.latencies },
    requiredSkillDigests,
    requiredToolDigests,
    injectedSkillDigests,
    exposedToolDigests,
    ...(input.firstToolName
      ? { firstToolDigest: digestCatalogId("tool", input.firstToolName) }
      : {}),
    ...(input.firstToolSuccess != null ? { firstToolSuccess: input.firstToolSuccess } : {}),
    ...(input.promptTokens != null ? { promptTokens: input.promptTokens } : {}),
    invariants: buildInvariants(input),
    privacyHits: [],
  };
  sample.privacyHits = scanForbiddenSubstrings(JSON.stringify(sample));
  return sample;
}

export function buildMetrics(samples: ShadowSample[]): ShadowMetrics {
  const complete = samples.filter((sample) => sample.terminalKind === "run_completed");
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
  return {
    requiredSkillRecall: skillGold > 0 ? skillHits / skillGold : null,
    requiredToolRecall: toolGold > 0 ? toolHits / toolGold : null,
    ttftMsAvg: ttfts.length > 0 ? ttfts.reduce((a, b) => a + b, 0) / ttfts.length : null,
    promptTokensAvg: tokens.length > 0 ? tokens.reduce((a, b) => a + b, 0) / tokens.length : null,
    firstToolSuccessRate:
      firstTools.length > 0
        ? firstTools.filter((sample) => sample.firstToolSuccess).length / firstTools.length
        : null,
  };
}

export function buildShadowSummary(params: {
  sourceCommit: string;
  artifactSha256: string;
  productionBlobShas: Record<string, string>;
  memoryFinalSize: number;
  samples: ShadowSample[];
}): ShadowSummary {
  const completeCount = params.samples.filter(
    (sample) => sample.terminalKind === "run_completed",
  ).length;
  return {
    schema: SHADOW_SCHEMA,
    version: "1.0.0",
    generatorVersion: SHADOW_GENERATOR_VERSION,
    sourceCommit: params.sourceCommit,
    observationFlag: "OPENBOT_EXECUTION_ROUTER_OBSERVATION=1",
    artifactSha256: params.artifactSha256,
    productionBlobShas: params.productionBlobShas,
    collectedAt: new Date().toISOString(),
    metricsKind: "harness_calculation",
    sampleCount: params.samples.length,
    completeCount,
    errorTtlCount: params.samples.length - completeCount,
    memoryFinalSize: params.memoryFinalSize,
    metrics: buildMetrics(params.samples),
    samples: params.samples,
  };
}
