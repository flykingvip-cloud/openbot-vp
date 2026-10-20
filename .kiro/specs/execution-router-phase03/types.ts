export const SCENARIO_TYPES = [
  "plain_text_qa",
  "skill_dense_readonly",
  "single_readonly_tool",
  "multi_readonly_tool",
] as const;

export type ScenarioType = (typeof SCENARIO_TYPES)[number];

export type ClockKind = "real_wall_clock" | "test_incrementing" | "fake";
export type UsageProvenance = "model_return" | "constant" | "synthetic" | "missing";

export type PerformanceInvariants = {
  sameRunId: boolean;
  usagePresent: boolean;
  usageFromModel: boolean;
  realClock: boolean;
  latenciesNonNegative: boolean;
  sourceMatchesHead: boolean;
};

export type PerformanceSample = {
  sourceCommit: string;
  runIdDigest: string;
  sessionKeyHash: string;
  scenarioType: ScenarioType;
  providerDigest: string;
  modelDigest: string;
  skillCount: number;
  toolCount: number;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  routePrepMs: number;
  ttftMs: number;
  totalMs: number;
  toolCallCount: number;
  firstToolSuccess: boolean | null;
  fallbackCount: number;
  terminalStatus: "success" | "error";
  errorClass: string | null;
  clockKind: ClockKind;
  usageProvenance: UsageProvenance;
  invariants: PerformanceInvariants;
};

export type PercentileSet = {
  p50: number;
  p95: number;
  avg: number;
};

export type ScenarioMetrics = {
  sampleCount: number;
  ttftMs: PercentileSet;
  routePrepMs: PercentileSet;
  totalMs: PercentileSet;
  promptTokens: PercentileSet;
  totalTokensAvg: number;
  firstToolSuccessRate: number | null;
  toolRetryRate: number | null;
  fallbackRate: number;
};

export type PerformanceSummary = {
  schema: string;
  version: string;
  generatorVersion: string;
  sourceCommit: string;
  productionBlobShas: Record<string, string>;
  artifactSha256: string;
  sampleCount: number;
  scenarioCounts: Record<ScenarioType, number>;
  aggregate: ScenarioMetrics;
  byScenario: Partial<Record<ScenarioType, ScenarioMetrics>>;
  privacy: { hitCount: number; hits: string[] };
  invariants: { ok: boolean; errors: string[] };
  memoryFinalSize: number;
  collectedAt: string;
  metricsKind: "operational_performance" | "harness_calculation";
  samples: PerformanceSample[];
};

export type RawUsageLike = {
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
  input?: number;
  output?: number;
  total?: number;
  inputTokens?: number;
  outputTokens?: number;
  prompt_tokens?: number;
  completion_tokens?: number;
  total_tokens?: number;
};

export type CaptureInput = {
  runId: string;
  sessionKey: string;
  scenarioType: ScenarioType;
  provider: string;
  model: string;
  skillCount: number;
  toolCount: number;
  usage?: RawUsageLike | null;
  usageProvenance?: UsageProvenance;
  clockKind?: ClockKind;
  routePrepMs: number;
  ttftMs: number;
  totalMs: number;
  toolCallCount: number;
  firstToolSuccess?: boolean | null;
  fallbackCount: number;
  terminalStatus: "success" | "error";
  errorClass?: string | null;
  terminalRunId?: string;
};
