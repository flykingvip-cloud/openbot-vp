import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { performance } from "node:perf_hooks";
import type { Scope, SourceType, TaskFrame } from "../src/models.js";
import { InMemoryCogniWeaveEngine } from "../src/runtime/in-memory-engine.js";

interface BenchmarkCase {
  id: string;
  rawInput: string;
  sourceType: SourceType;
}

interface BenchmarkDataset {
  version: string;
  scope: Scope;
  cases: BenchmarkCase[];
}

interface LatencyStats {
  min: number;
  avg: number;
  p50: number;
  p95: number;
  max: number;
}

interface BenchmarkReport {
  profile: string;
  dataset: string;
  generatedAt: string;
  warmupIterations: number;
  measureIterations: number;
  totalReasonOps: number;
  totalDistillationOps: number;
  metrics: {
    reasonLatencyMs: LatencyStats;
    graphQueryLatencyMs: LatencyStats;
    distillationLatencyMs: LatencyStats;
    distillationThroughputOpsPerSec: number;
  };
}

interface BenchmarkThresholds {
  maxReasonP95Ms: number;
  maxGraphQueryP95Ms: number;
  minDistillationThroughputOpsPerSec: number;
}

function readArg(flag: string): string | undefined {
  const index = process.argv.indexOf(flag);
  if (index === -1 || index + 1 >= process.argv.length) {
    return undefined;
  }
  return process.argv[index + 1];
}

function readNumberArg(flag: string, fallback: number): number {
  const raw = readArg(flag);
  if (!raw) {
    return fallback;
  }
  const value = Number(raw);
  return Number.isFinite(value) ? value : fallback;
}

function hasFlag(flag: string): boolean {
  return process.argv.includes(flag);
}

function percentile(values: number[], p: number): number {
  if (values.length === 0) {
    return 0;
  }
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[rank]!;
}

function stats(values: number[]): LatencyStats {
  if (values.length === 0) {
    return { min: 0, avg: 0, p50: 0, p95: 0, max: 0 };
  }
  const min = Math.min(...values);
  const max = Math.max(...values);
  const avg = values.reduce((sum, value) => sum + value, 0) / values.length;
  return {
    min,
    avg,
    p50: percentile(values, 50),
    p95: percentile(values, 95),
    max,
  };
}

async function loadDataset(datasetPath: string): Promise<BenchmarkDataset> {
  const file = await readFile(datasetPath, "utf8");
  const dataset = JSON.parse(file) as BenchmarkDataset;
  if (!dataset.scope || !dataset.cases || dataset.cases.length === 0) {
    throw new Error("Dataset is invalid: scope/cases are required");
  }
  return dataset;
}

async function main(): Promise<void> {
  const profile = (readArg("--profile") ?? "mvp").toLowerCase();
  const profileDefaults =
    profile === "longrun" ? { warmup: 30, iterations: 1000 } : { warmup: 5, iterations: 50 };
  const datasetPath = resolve(readArg("--dataset") ?? "datasets/mvp-core-eval.json");
  const outputPath = readArg("--output");
  const warmupIterations = Math.max(0, readNumberArg("--warmup", profileDefaults.warmup));
  const measureIterations = Math.max(1, readNumberArg("--iterations", profileDefaults.iterations));
  const enforceThresholds = hasFlag("--enforce-thresholds");
  const thresholds: BenchmarkThresholds = {
    maxReasonP95Ms: readNumberArg("--max-reason-p95-ms", 200),
    maxGraphQueryP95Ms: readNumberArg("--max-graph-query-p95-ms", 50),
    minDistillationThroughputOpsPerSec: readNumberArg("--min-distill-throughput", 10),
  };

  const dataset = await loadDataset(datasetPath);
  const engine = new InMemoryCogniWeaveEngine({
    environment: "local",
    metadataBackend: "memory",
    graphBackend: "memory",
    evidenceBackend: "memory",
    vectorBackend: "memory",
    defaultScope: dataset.scope,
  });

  for (const testCase of dataset.cases) {
    await engine.writeBack({
      rawInput: testCase.rawInput,
      scope: dataset.scope,
      sourceType: testCase.sourceType,
      sourceSessionId: `bench-seed:${dataset.version}`,
    });
  }

  const taskFrames: TaskFrame[] = [];
  for (const testCase of dataset.cases) {
    taskFrames.push(await engine.frameTask(testCase.rawInput, { scope: dataset.scope }));
  }

  const metadataStore = (
    engine as unknown as {
      metadataStore?: { listRelations?: () => Promise<unknown[]> };
    }
  ).metadataStore;
  if (!metadataStore?.listRelations) {
    throw new Error("Benchmark requires metadataStore.listRelations instrumentation support");
  }

  const relationSamples: number[] = [];
  const originalListRelations = metadataStore.listRelations.bind(metadataStore);
  metadataStore.listRelations = async (): Promise<unknown[]> => {
    const startedAt = performance.now();
    try {
      return await originalListRelations();
    } finally {
      relationSamples.push(performance.now() - startedAt);
    }
  };

  for (let i = 0; i < warmupIterations; i += 1) {
    const taskFrame = taskFrames[i % taskFrames.length]!;
    await engine.reason(taskFrame);
  }

  const reasonLatencies: number[] = [];
  const graphQueryLatencies: number[] = [];

  for (let i = 0; i < measureIterations; i += 1) {
    const taskFrame = taskFrames[i % taskFrames.length]!;
    const relationStart = relationSamples.length;
    const startedAt = performance.now();
    await engine.reason(taskFrame);
    reasonLatencies.push(performance.now() - startedAt);

    const relationDiff = relationSamples.slice(relationStart);
    const relationTotal = relationDiff.reduce((sum, value) => sum + value, 0);
    graphQueryLatencies.push(relationTotal);
  }

  for (let i = 0; i < warmupIterations; i += 1) {
    const testCase = dataset.cases[i % dataset.cases.length]!;
    await engine.distill({
      rawInput: testCase.rawInput,
      scope: dataset.scope,
      sourceType: testCase.sourceType,
      sourceSessionId: `bench-distill-warmup:${i}`,
      forceRebuild: true,
    });
  }

  const distillationLatencies: number[] = [];
  for (let i = 0; i < measureIterations; i += 1) {
    const testCase = dataset.cases[i % dataset.cases.length]!;
    const startedAt = performance.now();
    await engine.distill({
      rawInput: testCase.rawInput,
      scope: dataset.scope,
      sourceType: testCase.sourceType,
      sourceSessionId: `bench-distill:${i}`,
      forceRebuild: true,
    });
    distillationLatencies.push(performance.now() - startedAt);
  }

  const distillationTotalMs = distillationLatencies.reduce((sum, value) => sum + value, 0);
  const distillationThroughputOpsPerSec =
    distillationTotalMs === 0 ? 0 : (measureIterations / distillationTotalMs) * 1000;

  const report: BenchmarkReport = {
    profile,
    dataset: datasetPath,
    generatedAt: new Date().toISOString(),
    warmupIterations,
    measureIterations,
    totalReasonOps: measureIterations,
    totalDistillationOps: measureIterations,
    metrics: {
      reasonLatencyMs: stats(reasonLatencies),
      graphQueryLatencyMs: stats(graphQueryLatencies),
      distillationLatencyMs: stats(distillationLatencies),
      distillationThroughputOpsPerSec,
    },
  };

  const reportJson = JSON.stringify(report, null, 2);
  if (outputPath) {
    await mkdir(dirname(resolve(outputPath)), { recursive: true });
    await writeFile(resolve(outputPath), reportJson, "utf8");
  }
  process.stdout.write(`${reportJson}\n`);

  if (!enforceThresholds) {
    return;
  }

  const failedChecks: string[] = [];
  if (report.metrics.reasonLatencyMs.p95 > thresholds.maxReasonP95Ms) {
    failedChecks.push(
      `reasonLatency p95 ${report.metrics.reasonLatencyMs.p95.toFixed(2)}ms > ${thresholds.maxReasonP95Ms.toFixed(2)}ms`,
    );
  }
  if (report.metrics.graphQueryLatencyMs.p95 > thresholds.maxGraphQueryP95Ms) {
    failedChecks.push(
      `graphQueryLatency p95 ${report.metrics.graphQueryLatencyMs.p95.toFixed(2)}ms > ${thresholds.maxGraphQueryP95Ms.toFixed(2)}ms`,
    );
  }
  if (
    report.metrics.distillationThroughputOpsPerSec < thresholds.minDistillationThroughputOpsPerSec
  ) {
    failedChecks.push(
      `distillation throughput ${report.metrics.distillationThroughputOpsPerSec.toFixed(2)} ops/s < ${thresholds.minDistillationThroughputOpsPerSec.toFixed(2)} ops/s`,
    );
  }

  if (failedChecks.length > 0) {
    process.stderr.write(`CogniWeave benchmark gate failed:\n- ${failedChecks.join("\n- ")}\n`);
    process.exitCode = 1;
  }
}

await main();
