export const SHADOW_CATEGORIES = [
  "plain_text_qa",
  "skill_dense",
  "no_tools",
  "single_readonly_tool",
  "multi_tool",
  "client_tool",
  "skill_prompt_truncated",
  "tool_policy_rejected",
  "tool_call_loop",
  "concurrent_distinct_run_ids",
] as const;

export type ShadowCategory = (typeof SHADOW_CATEGORIES)[number];

export type ShadowInvariants = {
  sameRunId: boolean;
  eligibleGteInjected: boolean;
  constructedGteAfterPolicy: boolean;
  exposedMatchesAllowlist: boolean;
  stagesMonotonic: boolean;
  latenciesNonNegative: boolean;
  terminalComplete: boolean;
};

export type ShadowSample = {
  category: ShadowCategory;
  terminalKind: "run_completed" | "error_ttl";
  runIdDigest: string;
  sessionKeyHash?: string;
  stages: Record<string, number>;
  skillEligibleCount?: number;
  skillInjectedCount?: number;
  toolConstructedCount?: number;
  toolAfterPolicyCount?: number;
  toolExposedCount?: number;
  expectedAllowlistCount: number;
  latencies: {
    routePrepMs?: number;
    ttftMs?: number;
    totalMs?: number;
  };
  requiredSkillDigests: string[];
  requiredToolDigests: string[];
  injectedSkillDigests: string[];
  exposedToolDigests: string[];
  firstToolDigest?: string;
  firstToolSuccess?: boolean;
  promptTokens?: number;
  invariants: ShadowInvariants;
  privacyHits: string[];
};

export type ShadowMetrics = {
  requiredSkillRecall: number | null;
  requiredToolRecall: number | null;
  ttftMsAvg: number | null;
  promptTokensAvg: number | null;
  firstToolSuccessRate: number | null;
};

export type ShadowMetricsKind = "harness_calculation" | "operational_performance";

export type ShadowSummary = {
  schema: string;
  version: string;
  generatorVersion: string;
  sourceCommit: string;
  observationFlag: string;
  artifactSha256: string;
  productionBlobShas: Record<string, string>;
  collectedAt: string;
  metricsKind: ShadowMetricsKind;
  sampleCount: number;
  completeCount: number;
  errorTtlCount: number;
  memoryFinalSize: number;
  metrics: ShadowMetrics;
  samples: ShadowSample[];
};
