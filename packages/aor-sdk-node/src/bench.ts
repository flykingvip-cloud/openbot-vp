import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { OpenBotBackend, OpenAiCompatGatewayClient } from "@openbot/aor-backend-openbot";
import type {
  BackendCapability,
  BackendEvent,
  BackendRunResult,
  ExecutionBackend,
  FeedbackStore,
  ModelProfile,
  ModelRef,
  PlannedStep,
  RunContext,
  RunHandle,
  SelectionStrategy,
} from "@openbot/aor-core";
import { BanditFeedbackStore, createPersistentBanditFeedbackStore } from "@openbot/aor-core";
import {
  computeOptimizationReport,
  formatOptimizationReportMarkdown,
  type OptimizationReport,
} from "@openbot/aor-core";
import { AorClient } from "./client.js";
import { createObjectiveCodingEvaluator } from "./coding-evaluator.js";
import { resolveWorkspaceObjectiveCommands } from "./workspace-objective.js";

/**
 * Benchmark harness: compares single-fixed-model baselines against AOR's
 * task-aware routing on a mixed workload, scoring every output with a REAL
 * objective check (a `node` process via createCommandProbe). The only fixture
 * is the model output text; swapping the panel for OpenBotBackend turns this
 * into a live-gateway benchmark with zero code changes.
 */

export interface BenchTask {
  id: string;
  goal: string;
  type: "coding.review" | "summarization";
  /** Tokens the produced output must contain to count as "completed". */
  expectTokens: string[];
}

export interface BenchPolicy {
  name: string;
  strategy: SelectionStrategy;
  /** Force a single fixed model (baseline). Omit for AOR auto-routing. */
  fixedModel?: ModelRef;
}

export interface BenchTaskResult {
  taskId: string;
  taskType: string;
  model: string;
  estimatedCostUsd: number;
  completionScore: number;
}

export interface BenchPolicyResult {
  policy: string;
  totalCostUsd: number;
  avgCompletion: number;
  rows: BenchTaskResult[];
}

export type BenchFixtures = Map<string, string>;

export function fixtureKey(taskId: string, model: ModelRef): string {
  return `${taskId}::${model.provider}/${model.id}`;
}

/**
 * Deterministic "panel" backend: returns the canned output registered for the
 * (task, model) pair. Missing entries return empty output (which fails the
 * objective check). This stands in for a real multi-model gateway offline.
 */
export class PanelBackend implements ExecutionBackend {
  readonly id = "panel";
  private activeTaskId = "";
  private activeModel: ModelRef = { provider: "", id: "" };
  constructor(private readonly fixtures: BenchFixtures) {}

  /** The bench loop sets the current task id before each run (runs are serial). */
  setTask(taskId: string): void {
    this.activeTaskId = taskId;
  }

  capabilities(): Promise<BackendCapability> {
    return Promise.resolve({ models: [] });
  }
  run(step: PlannedStep, _ctx: RunContext): Promise<RunHandle> {
    this.activeModel = step.model;
    return Promise.resolve({ runId: step.id });
  }
  async *stream(): AsyncIterable<BackendEvent> {
    yield { kind: "lifecycle", phase: "end" };
  }
  wait(): Promise<BackendRunResult> {
    const text = this.fixtures.get(fixtureKey(this.activeTaskId, this.activeModel)) ?? "";
    return Promise.resolve({ text, usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 } });
  }
  abort(): Promise<void> {
    return Promise.resolve();
  }
}

/** Build a real `node -e` checker with the file path + tokens baked in (no argv). */
function buildCheckScript(outFile: string, tokens: string[]): string {
  return [
    "const fs=require('fs');",
    `const t=fs.readFileSync(${JSON.stringify(outFile)},'utf8');`,
    `const toks=${JSON.stringify(tokens)};`,
    "process.exit(toks.every((x)=>t.includes(x))?0:1);",
  ].join("");
}

export interface RunBenchmarkOptions {
  tasks: BenchTask[];
  policies: BenchPolicy[];
  modelCatalog: ModelProfile[];
  backend: ExecutionBackend;
  /** Workdir for objective-check temp files (defaults to an os temp dir). */
  workdir?: string;
  /** Shared feedback store (for bandit learning across rounds). */
  feedback?: FeedbackStore;
  /** Bandit learning rounds (only for policies with strategy `bandit`). */
  banditRounds?: number;
  /** Persist bandit arms to disk (implies persistent store for bandit policy). */
  banditStatePath?: string;
  /** Use objective coding evaluator (build/test) instead of output token probes. */
  codingWorkspace?: string;
}

export interface RunBenchmarkResult {
  results: BenchPolicyResult[];
  /** Per-round arm snapshots for bandit policies (one entry per round). */
  learningCurve: BanditLearningSnapshot[];
}

export interface BanditLearningSnapshot {
  round: number;
  policy: string;
  arms: Array<{ arm: string; mean: number; trials: number }>;
}

export interface DemoBenchmarkOptions {
  banditRounds?: number;
  banditStatePath?: string;
  /** Use OpenBot HTTP gateway instead of offline panel (requires live gateway). */
  live?: boolean;
  gatewayUrl?: string;
  /** Score tasks with objective build/test evaluator instead of output token checks. */
  coding?: boolean;
  codingWorkspace?: string;
}

function banditStoreSnapshot(
  feedback: FeedbackStore | undefined,
  round: number,
  policy: string,
): BanditLearningSnapshot | undefined {
  if (!feedback || !("learningSnapshot" in feedback)) {
    return undefined;
  }
  const snap = (feedback as BanditFeedbackStore).learningSnapshot();
  return { round, policy, arms: snap };
}

function createBanditFeedback(
  opts: RunBenchmarkOptions,
  policy: BenchPolicy,
): FeedbackStore | undefined {
  if (policy.strategy !== "bandit") {
    return opts.feedback;
  }
  if (opts.feedback) {
    return opts.feedback;
  }
  if (opts.banditStatePath) {
    return createPersistentBanditFeedbackStore(opts.banditStatePath);
  }
  return new BanditFeedbackStore({ rng: () => 0.5 });
}

export async function runBenchmark(opts: RunBenchmarkOptions): Promise<RunBenchmarkResult> {
  const workdir = opts.workdir ?? mkdtempSync(join(tmpdir(), "aor-bench-"));
  const cleanup = !opts.workdir;
  const results: BenchPolicyResult[] = [];
  const learningCurve: BanditLearningSnapshot[] = [];

  try {
    for (const policy of opts.policies) {
      const feedback = createBanditFeedback(opts, policy);
      const rounds = policy.strategy === "bandit" ? (opts.banditRounds ?? 3) : 1;
      const client = new AorClient({
        backend: opts.backend,
        modelCatalog: opts.modelCatalog,
        defaultStrategy: policy.strategy,
        feedback,
      });
      const rows: BenchTaskResult[] = [];

      for (let round = 0; round < rounds; round += 1) {
        for (const task of opts.tasks) {
          if (opts.backend instanceof PanelBackend) {
            opts.backend.setTask(task.id);
          }
          const run = await client
            .agent({
              goal: task.goal,
              type: task.type,
              constraints: policy.fixedModel ? { allowedModels: [policy.fixedModel] } : undefined,
            })
            .run({ strategy: policy.strategy });

          const outFile = join(
            workdir,
            `${task.id}.${policy.name.replace(/[^a-z0-9]/gi, "_")}.r${round}.txt`,
          );
          writeFileSync(outFile, run.output.text, "utf8");

          const evaluator =
            opts.codingWorkspace !== undefined && task.type === "coding.review"
              ? createObjectiveCodingEvaluator({
                  taskType: task.type,
                  cwd: opts.codingWorkspace,
                  ...resolveWorkspaceObjectiveCommands(opts.codingWorkspace),
                })
              : createObjectiveCodingEvaluator({
                  taskType: task.type,
                  test: {
                    command: "node",
                    args: ["-e", buildCheckScript(outFile, task.expectTokens)],
                  },
                });
          const evaluation = await evaluator.evaluate({
            task: { goal: task.goal, type: task.type },
            output: run.output,
            usage: run.usage,
          });

          if (feedback) {
            feedback.record(run.selection.model, task.type, evaluation);
          }

          const snap = banditStoreSnapshot(feedback, round + 1, policy.name);
          if (snap) {
            learningCurve.push(snap);
          }

          if (round === rounds - 1) {
            rows.push({
              taskId: task.id,
              taskType: task.type,
              model: `${run.selection.model.provider}/${run.selection.model.id}`,
              estimatedCostUsd: run.selection.estimatedCostUsd,
              completionScore: evaluation.score,
            });
          }
        }
      }

      const totalCostUsd = rows.reduce((sum, r) => sum + r.estimatedCostUsd, 0);
      const avgCompletion = rows.reduce((sum, r) => sum + r.completionScore, 0) / rows.length;
      results.push({ policy: policy.name, totalCostUsd, avgCompletion, rows });
    }
  } finally {
    if (cleanup) {
      rmSync(workdir, { recursive: true, force: true });
    }
  }

  return { results, learningCurve };
}

/** Create an OpenBot HTTP backend for live-gateway benchmarks. */
export function createLiveBenchBackend(
  gatewayUrl = process.env.AOR_GATEWAY_URL ?? "http://127.0.0.1:18789",
  modelCatalog: ModelProfile[] = demoCatalog(),
): ExecutionBackend {
  return new OpenBotBackend({
    client: new OpenAiCompatGatewayClient({ baseUrl: gatewayUrl }),
    knownModels: modelCatalog.map((m) => m.ref),
  });
}

export function formatLearningCurve(snapshots: BanditLearningSnapshot[]): string {
  if (snapshots.length === 0) {
    return "(no bandit learning snapshots)";
  }
  const lines = ["round  policy        arm                              mean  trials"];
  for (const snap of snapshots) {
    if (snap.arms.length === 0) {
      lines.push(`${String(snap.round).padStart(5)}  ${snap.policy.padEnd(12)}  (no arms yet)`);
      continue;
    }
    for (const arm of snap.arms) {
      lines.push(
        `${String(snap.round).padStart(5)}  ${snap.policy.padEnd(12)}  ${arm.arm.padEnd(32)} ${(arm.mean * 100).toFixed(0).padStart(4)}%  ${String(arm.trials).padStart(6)}`,
      );
    }
  }
  return lines.join("\n");
}

/* --------------------- Default offline demo suite ------------------------- */

export function demoCatalog(): ModelProfile[] {
  return [
    {
      ref: { provider: "anthropic", id: "claude-opus-4-6" },
      cost: { inputPerMtok: 15, outputPerMtok: 75 },
      p50LatencyMs: 4000,
      p95LatencyMs: 9000,
      // Strong at coding; only ok at summarization.
      taskTypeScores: { "coding.review": 0.92, summarization: 0.8 },
    },
    {
      ref: { provider: "openai", id: "gpt-5.4-mini" },
      cost: { inputPerMtok: 0.4, outputPerMtok: 1.6 },
      p50LatencyMs: 1500,
      p95LatencyMs: 3500,
      // Weak at coding; excellent (and cheap) at summarization.
      taskTypeScores: { "coding.review": 0.55, summarization: 0.9 },
    },
  ];
}

const DEMO_CODING_IDS = ["code1", "code2"] as const;
const DEMO_SUMMARY_IDS = ["sum1", "sum2", "sum3", "sum4"] as const;

/**
 * A mixed workload: a couple of coding reviews plus several summarization jobs.
 * Real workloads skew toward cheap, high-volume tasks, which is exactly where
 * task-aware routing compounds savings.
 */
export function demoTasks(): BenchTask[] {
  return [
    ...DEMO_CODING_IDS.map((id) => ({
      id,
      goal: `review ${id}`,
      type: "coding.review" as const,
      expectTokens: ["FIX:"],
    })),
    ...DEMO_SUMMARY_IDS.map((id) => ({
      id,
      goal: `summarize ${id}`,
      type: "summarization" as const,
      expectTokens: ["SUMMARY:"],
    })),
  ];
}

/** Fixtures: strong model solves coding; cheap model fails coding but nails summaries. */
export function demoFixtures(): BenchFixtures {
  const claude: ModelRef = { provider: "anthropic", id: "claude-opus-4-6" };
  const mini: ModelRef = { provider: "openai", id: "gpt-5.4-mini" };
  const f: BenchFixtures = new Map();
  for (const id of DEMO_CODING_IDS) {
    f.set(fixtureKey(id, claude), `FIX: resolve null deref in ${id} and add a regression test`);
    f.set(fixtureKey(id, mini), `looks mostly fine in ${id}`); // misses FIX: -> fails
  }
  for (const id of DEMO_SUMMARY_IDS) {
    f.set(fixtureKey(id, claude), `SUMMARY: ${id} key points captured`);
    f.set(fixtureKey(id, mini), `SUMMARY: ${id} concise and accurate`);
  }
  return f;
}

export function demoPolicies(): BenchPolicy[] {
  return [
    {
      name: "single:claude",
      strategy: "best_quality",
      fixedModel: { provider: "anthropic", id: "claude-opus-4-6" },
    },
    {
      name: "single:mini",
      strategy: "cheapest",
      fixedModel: { provider: "openai", id: "gpt-5.4-mini" },
    },
    { name: "aor:auto", strategy: "best_quality" },
    { name: "aor:bandit", strategy: "bandit" },
  ];
}

export function buildOptimizationReportFromBench(results: BenchPolicyResult[]): {
  report: OptimizationReport;
  markdown: string;
} {
  const baseline = results.find((r) => r.policy === "single:claude");
  const optimized = results.find((r) => r.policy === "aor:auto");
  const bandit = results.find((r) => r.policy === "aor:bandit");
  if (!baseline || !optimized) {
    throw new Error("bench results must include single:claude and aor:auto policies");
  }
  const input = {
    baseline: {
      policy: baseline.policy,
      totalCostUsd: baseline.totalCostUsd,
      avgCompletion: baseline.avgCompletion,
    },
    optimized: {
      policy: optimized.policy,
      totalCostUsd: optimized.totalCostUsd,
      avgCompletion: optimized.avgCompletion,
    },
    bandit: bandit
      ? {
          policy: bandit.policy,
          totalCostUsd: bandit.totalCostUsd,
          avgCompletion: bandit.avgCompletion,
        }
      : undefined,
  };
  const report = computeOptimizationReport(input);
  return { report, markdown: formatOptimizationReportMarkdown(input, report) };
}

function formatTable(results: BenchPolicyResult[]): string {
  const lines = ["policy           completion   total_cost_usd   models"];
  for (const r of results) {
    const models = r.rows.map((row) => row.model.split("/")[1]).join(",");
    lines.push(
      `${r.policy.padEnd(16)} ${(r.avgCompletion * 100).toFixed(0).padStart(8)}%   ${r.totalCostUsd
        .toFixed(4)
        .padStart(12)}   ${models}`,
    );
  }
  return lines.join("\n");
}

export async function runDemoBenchmark(options: DemoBenchmarkOptions = {}): Promise<{
  results: BenchPolicyResult[];
  table: string;
  optimizationMarkdown: string;
  learningCurve: BanditLearningSnapshot[];
  learningCurveText: string;
}> {
  const backend = options.live
    ? createLiveBenchBackend(options.gatewayUrl)
    : new PanelBackend(demoFixtures());
  const { results, learningCurve } = await runBenchmark({
    tasks: demoTasks(),
    policies: demoPolicies(),
    modelCatalog: demoCatalog(),
    backend,
    banditRounds: options.banditRounds ?? 3,
    banditStatePath: options.banditStatePath,
    codingWorkspace: options.coding ? (options.codingWorkspace ?? process.cwd()) : undefined,
  });
  const { markdown: optimizationMarkdown } = buildOptimizationReportFromBench(results);
  return {
    results,
    table: formatTable(results),
    optimizationMarkdown,
    learningCurve,
    learningCurveText: formatLearningCurve(learningCurve),
  };
}
