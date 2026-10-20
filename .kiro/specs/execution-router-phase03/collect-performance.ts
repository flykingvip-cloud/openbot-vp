import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildLogicalArtifact, resolveRepoRoot } from "./artifact.ts";
import {
  digestId,
  PERF_GENERATOR_VERSION,
  PERF_SCHEMA,
  scanForbiddenSubstrings,
  sha256Hex,
} from "./ids.ts";
import { countScenarios, summarizeByScenario, summarizeSamples } from "./metrics.ts";
import {
  SCENARIO_TYPES,
  type CaptureInput,
  type PerformanceSample,
  type PerformanceSummary,
} from "./types.ts";
import { assertUsageAcceptable, mapModelUsage } from "./usage.ts";
import { validatePerformanceSummary } from "./validate-performance.ts";

export const TRACKED_SUMMARY_RELPATH =
  ".kiro/specs/execution-router-phase03/performance-summary.json";

const liveSamples = new Map<string, PerformanceSample>();

export function collectorMemorySize(): number {
  return liveSamples.size;
}

export function resetCollectorMemory(): void {
  liveSamples.clear();
}

export function isTrackedSummaryPath(repoRoot: string, candidate: string): boolean {
  return path.resolve(candidate) === path.resolve(repoRoot, TRACKED_SUMMARY_RELPATH);
}

export function toPerformanceSample(input: CaptureInput, sourceCommit: string): PerformanceSample {
  const rawPrivacyHits = scanForbiddenSubstrings(
    JSON.stringify({
      runId: input.runId,
      sessionKey: input.sessionKey,
      provider: input.provider,
      model: input.model,
      errorClass: input.errorClass ?? "",
    }),
  );
  if (rawPrivacyHits.length > 0) {
    throw new Error(`privacy ${rawPrivacyHits.join(",")}: sample rejected`);
  }
  const clockKind = input.clockKind ?? "real_wall_clock";
  const usageProvenance = input.usageProvenance ?? "model_return";
  if (clockKind !== "real_wall_clock") {
    throw new Error("clock is not real_wall_clock: sample rejected");
  }
  if (usageProvenance !== "model_return") {
    throw new Error(`forged usage marked ${usageProvenance}: sample rejected`);
  }
  const usage = mapModelUsage(input.usage);
  assertUsageAcceptable({ usage, provenance: usageProvenance });
  const terminalRunId = input.terminalRunId ?? input.runId;
  if (terminalRunId !== input.runId) {
    throw new Error("runId mismatch: sample rejected");
  }
  const latencies = [input.routePrepMs, input.ttftMs, input.totalMs];
  if (latencies.some((value) => !Number.isFinite(value) || value < 0)) {
    throw new Error("negative latency: sample rejected");
  }
  const runIdDigest = digestId("run", input.runId);
  const sample: PerformanceSample = {
    sourceCommit,
    runIdDigest,
    sessionKeyHash: digestId("session", input.sessionKey),
    scenarioType: input.scenarioType,
    providerDigest: digestId("provider", input.provider),
    modelDigest: digestId("model", input.model),
    skillCount: input.skillCount,
    toolCount: input.toolCount,
    promptTokens: usage.promptTokens,
    completionTokens: usage.completionTokens,
    totalTokens: usage.totalTokens,
    routePrepMs: input.routePrepMs,
    ttftMs: input.ttftMs,
    totalMs: input.totalMs,
    toolCallCount: input.toolCallCount,
    firstToolSuccess: input.firstToolSuccess ?? null,
    fallbackCount: input.fallbackCount,
    terminalStatus: input.terminalStatus,
    errorClass: input.errorClass ?? null,
    clockKind,
    usageProvenance,
    invariants: {
      sameRunId: terminalRunId === input.runId,
      usagePresent: true,
      usageFromModel: true,
      realClock: true,
      latenciesNonNegative: true,
      sourceMatchesHead: true,
    },
  };
  const privacyHits = scanForbiddenSubstrings(JSON.stringify(sample));
  if (privacyHits.length > 0) {
    throw new Error(`privacy ${privacyHits.join(",")}: sample rejected`);
  }
  return sample;
}

export function ingestCapture(input: CaptureInput, sourceCommit: string): PerformanceSample {
  const sample = toPerformanceSample(input, sourceCommit);
  if (liveSamples.has(sample.runIdDigest)) {
    throw new Error(`duplicate runId ${sample.runIdDigest}: sample rejected`);
  }
  liveSamples.set(sample.runIdDigest, sample);
  return sample;
}

export function buildPerformanceSummary(params: {
  repoRoot: string;
  samples: PerformanceSample[];
  requireCoverage?: boolean;
}): PerformanceSummary {
  const logical = buildLogicalArtifact(params.repoRoot);
  const samples = params.samples;
  const runIds = new Set<string>();
  for (const sample of samples) {
    if (runIds.has(sample.runIdDigest)) {
      throw new Error(`duplicate runId ${sample.runIdDigest}: sample rejected`);
    }
    runIds.add(sample.runIdDigest);
    if (sample.sourceCommit !== logical.sourceCommit) {
      throw new Error("source/HEAD/worktree identity mismatch");
    }
  }
  const privacyHits = scanForbiddenSubstrings(JSON.stringify(samples));
  const summary: PerformanceSummary = {
    schema: PERF_SCHEMA,
    version: "1.0.0",
    generatorVersion: PERF_GENERATOR_VERSION,
    sourceCommit: logical.sourceCommit,
    productionBlobShas: logical.productionBlobShas,
    artifactSha256: logical.artifactSha256,
    sampleCount: samples.length,
    scenarioCounts: countScenarios(samples),
    aggregate: summarizeSamples(samples),
    byScenario: summarizeByScenario(samples),
    privacy: { hitCount: privacyHits.length, hits: privacyHits },
    invariants: { ok: true, errors: [] },
    memoryFinalSize: 0,
    collectedAt: new Date().toISOString(),
    metricsKind: "operational_performance",
    samples,
  };
  const validation = validatePerformanceSummary({
    summary,
    expectedSourceCommit: logical.sourceCommit,
    expectedArtifactSha256: logical.artifactSha256,
    repoRoot: params.repoRoot,
    requireCoverage: params.requireCoverage ?? true,
  });
  if (!validation.ok) {
    throw new Error(`candidate failed validation:\n${validation.errors.join("\n")}`);
  }
  return summary;
}

export function writePerformanceSummary(params: {
  repoRoot: string;
  output: string;
  samples: PerformanceSample[];
  force?: boolean;
  requireCoverage?: boolean;
}): PerformanceSummary {
  const resolved = path.resolve(params.output);
  if (isTrackedSummaryPath(params.repoRoot, resolved) && !params.force) {
    throw new Error(
      "collect refuses to write the tracked performance-summary.json without --force",
    );
  }
  if (existsSync(resolved) && !params.force) {
    throw new Error(`refusing to overwrite existing file: ${resolved}`);
  }
  const summary = buildPerformanceSummary({
    repoRoot: params.repoRoot,
    samples: params.samples,
    requireCoverage: params.requireCoverage,
  });
  resetCollectorMemory();
  mkdirSync(path.dirname(resolved), { recursive: true });
  const serialized = `${JSON.stringify(summary, null, 2)}\n`;
  writeFileSync(resolved, serialized);
  writeFileSync(`${resolved}.sha256`, `${sha256Hex(serialized)}\n`);
  return summary;
}

function argValue(argv: string[], flag: string): string | undefined {
  const index = argv.indexOf(flag);
  return index < 0 ? undefined : argv[index + 1];
}

export function usageMessage(): string {
  return `Usage:
  pnpm exec tsx .kiro/specs/execution-router-phase03/collect-performance.ts --output <path>
  pnpm exec tsx .kiro/specs/execution-router-phase03/validate-performance.ts --input <path>

P1 refuses to invent live samples. Pass captured JSON via --input only in P2.`;
}

export function main(argv = process.argv, _repoRoot = resolveRepoRoot()): void {
  const output = argValue(argv, "--output");
  if (!output) {
    throw new Error(usageMessage());
  }
  throw new Error(
    [
      "P2 live collection is not accepted yet.",
      `candidate path would be ${path.resolve(output)}.`,
      "This command refuses to write harness or synthetic usage as operational performance.",
      "Provide an isolated gateway, official model selection, and live usage first.",
    ].join(" "),
  );
}

function isDirectRun(): boolean {
  const entry = process.argv[1];
  if (!entry || process.env.VITEST) {
    return false;
  }
  return path.resolve(entry) === fileURLToPath(import.meta.url);
}

if (isDirectRun()) {
  try {
    main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  }
}

void SCENARIO_TYPES;
