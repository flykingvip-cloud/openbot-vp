import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import type {
  DistillationQuality,
  DistillationResult,
  DistillationStageDecision,
  EngineConfig,
  Scope,
  SourceType,
  WritePlan,
} from "../src/models.js";
import {
  mergePreferFilledDistillation,
  readDistillationResult,
} from "../src/runtime/distillation-shape.js";
import { buildDistillationResult } from "../src/runtime/helpers.js";
import { isRecord } from "../src/runtime/json-values.js";
import {
  LlmFallbackDistillationStrategy,
  type DistillationStrategyInput,
  type LlmDistillationProvider,
  type LlmDistillationProviderInput,
} from "../src/runtime/strategies.js";

const REPLAY_STAGES = ["event", "context", "atoms", "relations"] as const;
type ReplayStage = (typeof REPLAY_STAGES)[number];

interface ReplayStagePlan {
  event: boolean;
  context: boolean;
  atoms: boolean;
  relations: boolean;
}

interface ReplayCase {
  id: string;
  rawInput: string;
  sourceType: SourceType;
  stagePlan?: ReplayStagePlan;
  stageSnapshotBundle?: string;
}

interface ReplayDataset {
  version: string;
  scope: Scope;
  stageOrder?: ReplayStage[];
  cases: ReplayCase[];
}

type ReplayStageBundle = Partial<Record<ReplayStage, unknown>>;

interface StageRates {
  llmRespondedRate: number;
  usedLlmRate: number;
  fallbackRate: number;
}

interface ReplayCaseMetric {
  id: string;
  stageCoverage: number;
  stageFallbackRate: number;
  stageDecisions: DistillationStageDecision[];
}

interface ReplayReport {
  dataset: string;
  generatedAt: string;
  caseCount: number;
  metrics: {
    avgStageCoverage: number;
    avgStageFallbackRate: number;
    byStage: Record<string, StageRates>;
  };
  cases: ReplayCaseMetric[];
}

interface ReplayThresholds {
  minStageCoverage: number;
  maxStageFallbackRate: number;
  maxAtomsFallbackRate: number;
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

function average(values: number[]): number {
  if (values.length === 0) {
    return 0;
  }
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function coverageFromStageDecisions(stageDecisions: DistillationStageDecision[]): number {
  if (stageDecisions.length === 0) {
    return 0;
  }
  return (
    stageDecisions.filter((decision) => decision.llmResponded && decision.usedLlmOutput).length /
    stageDecisions.length
  );
}

function fallbackRateFromStageDecisions(stageDecisions: DistillationStageDecision[]): number {
  if (stageDecisions.length === 0) {
    return 0;
  }
  return (
    stageDecisions.filter((decision) => decision.fallbackToRule).length / stageDecisions.length
  );
}

function buildStageQuality(stageDecisions: DistillationStageDecision[]): DistillationQuality {
  return {
    profile: "llm_multi_call",
    stageCoverage: coverageFromStageDecisions(stageDecisions),
    stageFallbackRate: fallbackRateFromStageDecisions(stageDecisions),
    stageDecisions,
  };
}

function withQuality(
  result: DistillationResult,
  stageDecisions: DistillationStageDecision[],
): DistillationResult {
  return {
    ...result,
    quality: buildStageQuality(stageDecisions),
  };
}

function coverageFromPlan(plan: ReplayStagePlan): number {
  const values = [plan.event, plan.context, plan.atoms, plan.relations];
  return values.filter(Boolean).length / values.length;
}

function fallbackFromPlan(plan: ReplayStagePlan): number {
  return 1 - coverageFromPlan(plan);
}

function buildWritePlan(result: DistillationResult): WritePlan {
  return {
    canonicalObjectTypes: result.writePlan.canonicalObjectTypes,
    relationIds: result.relations.map((relation) => relation.id),
    graphNodeIds: [
      result.event.id,
      ...result.atoms.map((atom) => atom.id),
      ...result.entities.map((entity) => entity.id),
      ...result.scenarios.map((scenario) => scenario.id),
      ...result.problems.map((problem) => problem.id),
      ...result.evidence.map((evidence) => evidence.id),
    ],
    graphEdgeIds: result.relations.map((relation) => relation.id),
    vectorDocumentIds: [
      result.event.id,
      ...result.atoms.map((atom) => atom.id),
      ...result.entities.map((entity) => entity.id),
    ],
  };
}

function makeStageDecisions(plan: ReplayStagePlan): DistillationStageDecision[] {
  return [
    {
      stage: "event",
      llmResponded: plan.event,
      usedLlmOutput: plan.event,
      fallbackToRule: !plan.event,
    },
    {
      stage: "context",
      llmResponded: plan.context,
      usedLlmOutput: plan.context,
      fallbackToRule: !plan.context,
    },
    {
      stage: "atoms",
      llmResponded: plan.atoms,
      usedLlmOutput: plan.atoms,
      fallbackToRule: !plan.atoms,
    },
    {
      stage: "relations",
      llmResponded: plan.relations,
      usedLlmOutput: plan.relations,
      fallbackToRule: !plan.relations,
    },
  ];
}

function applyPlanToDistillation(
  base: DistillationResult,
  replayCase: ReplayCase,
): DistillationResult {
  const plan = replayCase.stagePlan!;
  const eventId = `evt_llm_replay_${replayCase.id}`;
  const event = {
    ...base.event,
    id: eventId,
    eventKey: `event_key_llm_replay_${replayCase.id}`,
    goal: plan.event ? `llm:${base.event.goal}` : "",
    context: plan.event ? base.event.context : "",
    constraints: plan.event ? base.event.constraints : [],
    decisions: plan.event ? [...base.event.decisions, "llm_event_stage"] : [],
    turningPoints: plan.event ? base.event.turningPoints : [],
    outcome: plan.event ? base.event.outcome : undefined,
  };

  const entities = plan.context ? base.entities : [];
  const scenarios = plan.context ? base.scenarios : [];
  const problems = plan.context ? base.problems : [];
  const atoms = plan.atoms
    ? base.atoms.map((atom) => ({
        ...atom,
        claim: {
          ...atom.claim,
          statement: `llm:${atom.claim.statement}`,
        },
      }))
    : [];
  const relations = plan.relations ? base.relations : [];
  const evidence = base.evidence;
  const stageDecisions = makeStageDecisions(plan);

  const result: DistillationResult = {
    ...base,
    event: {
      ...event,
      linkedAtoms: atoms.map((atom) => atom.id),
      evidenceRefs: evidence.map((record) => record.id),
    },
    atoms,
    entities,
    scenarios,
    problems,
    relations,
    evidence,
    keys: {
      ...base.keys,
      eventKey: event.eventKey ?? base.keys.eventKey,
      atomDedupKeys: atoms.map((atom) => atom.dedupKey ?? ""),
      entityKeys: entities.map((entity) => entity.entityKey ?? ""),
      scenarioKeys: scenarios.map((scenario) => scenario.scenarioKey ?? ""),
      problemKeys: problems.map((problem) => problem.problemKey ?? ""),
    },
    writePlan: buildWritePlan({
      ...base,
      event: {
        ...event,
        linkedAtoms: atoms.map((atom) => atom.id),
        evidenceRefs: evidence.map((record) => record.id),
      },
      atoms,
      entities,
      scenarios,
      problems,
      relations,
      evidence,
    }),
    quality: buildStageQuality(stageDecisions),
  };

  return result;
}

class ReplayLlmDistillationProvider implements LlmDistillationProvider {
  private readonly casesBySessionId = new Map<string, ReplayCase>();
  private readonly config: EngineConfig;
  private readonly scope: Scope;
  private readonly datasetRoot: string;
  private readonly stageOrder: ReplayStage[];
  private readonly bundleCache = new Map<string, ReplayStageBundle | null>();

  constructor(dataset: ReplayDataset, config: EngineConfig, datasetRoot: string) {
    this.config = config;
    this.scope = dataset.scope;
    this.datasetRoot = datasetRoot;
    this.stageOrder =
      dataset.stageOrder && dataset.stageOrder.length > 0 ? dataset.stageOrder : [...REPLAY_STAGES];
    for (const replayCase of dataset.cases) {
      this.casesBySessionId.set(`replay:${replayCase.id}`, replayCase);
    }
  }

  private async loadStageBundle(relativePath: string): Promise<ReplayStageBundle | null> {
    const absolutePath = resolve(this.datasetRoot, relativePath);
    if (this.bundleCache.has(absolutePath)) {
      return this.bundleCache.get(absolutePath) ?? null;
    }

    try {
      const content = await readFile(absolutePath, "utf8");
      const parsed = JSON.parse(content) as unknown;
      if (!isRecord(parsed)) {
        this.bundleCache.set(absolutePath, null);
        return null;
      }
      const bundle: ReplayStageBundle = {};
      for (const stage of REPLAY_STAGES) {
        bundle[stage] = parsed[stage];
      }
      this.bundleCache.set(absolutePath, bundle);
      return bundle;
    } catch {
      this.bundleCache.set(absolutePath, null);
      return null;
    }
  }

  private async distillFromSnapshotBundle(
    replayCase: ReplayCase,
  ): Promise<DistillationResult | null> {
    const bundlePath = replayCase.stageSnapshotBundle;
    if (!bundlePath) {
      return null;
    }
    const bundle = await this.loadStageBundle(bundlePath);
    if (!bundle) {
      return null;
    }

    const stageDecisions: DistillationStageDecision[] = [];
    let merged: DistillationResult | null = null;

    for (const stage of this.stageOrder) {
      const snapshot = bundle[stage];
      const stageResult = readDistillationResult(snapshot);
      if (!stageResult) {
        stageDecisions.push({
          stage,
          llmResponded: false,
          usedLlmOutput: false,
          fallbackToRule: true,
        });
        continue;
      }

      stageDecisions.push({
        stage,
        llmResponded: true,
        usedLlmOutput: true,
        fallbackToRule: false,
      });
      const normalized = withQuality(stageResult, [
        {
          stage,
          llmResponded: true,
          usedLlmOutput: true,
          fallbackToRule: false,
        },
      ]);
      merged = merged
        ? mergePreferFilledDistillation(merged, normalized, normalized.quality)
        : normalized;
    }

    if (!merged) {
      return null;
    }
    return withQuality(merged, stageDecisions);
  }

  async distill(input: LlmDistillationProviderInput): Promise<DistillationResult | null> {
    const replayCase = input.sourceSessionId
      ? this.casesBySessionId.get(input.sourceSessionId)
      : undefined;
    if (!replayCase) {
      return null;
    }

    if (replayCase.stageSnapshotBundle) {
      const replayFromBundle = await this.distillFromSnapshotBundle(replayCase);
      if (replayFromBundle) {
        return replayFromBundle;
      }
    }

    if (!replayCase.stagePlan) {
      return null;
    }

    const base = buildDistillationResult({
      rawInput: replayCase.rawInput,
      config: this.config,
      scopeInput: input.scope ?? this.scope,
      sourceType: replayCase.sourceType,
      sourceSessionId: input.sourceSessionId,
      sourceTurnRange: input.sourceTurnRange,
      metadata: input.metadata,
    });

    return applyPlanToDistillation(base, replayCase);
  }
}

async function loadDataset(datasetPath: string): Promise<ReplayDataset> {
  const file = await readFile(datasetPath, "utf8");
  const dataset = JSON.parse(file) as ReplayDataset;
  if (!dataset.scope || !dataset.cases || dataset.cases.length === 0) {
    throw new Error("Dataset is invalid: scope/cases are required");
  }
  return dataset;
}

function buildStageRates(caseMetrics: ReplayCaseMetric[]): Record<string, StageRates> {
  const stageNames = new Set(
    caseMetrics.flatMap((caseMetric) =>
      caseMetric.stageDecisions.map((decision) => decision.stage),
    ),
  );
  const byStage: Record<string, StageRates> = {};

  for (const stage of stageNames) {
    const decisions = caseMetrics
      .flatMap((caseMetric) => caseMetric.stageDecisions)
      .filter((decision) => decision.stage === stage);
    byStage[stage] = {
      llmRespondedRate: average(decisions.map((decision) => (decision.llmResponded ? 1 : 0))),
      usedLlmRate: average(decisions.map((decision) => (decision.usedLlmOutput ? 1 : 0))),
      fallbackRate: average(decisions.map((decision) => (decision.fallbackToRule ? 1 : 0))),
    };
  }

  return byStage;
}

async function main(): Promise<void> {
  const datasetPath = resolve(
    readArg("--dataset") ?? "datasets/distillation-replay-multi-call.json",
  );
  const outputPath = readArg("--output");
  const enforceThresholds = hasFlag("--enforce-thresholds");
  const thresholds: ReplayThresholds = {
    minStageCoverage: readNumberArg("--min-stage-coverage", 0.7),
    maxStageFallbackRate: readNumberArg("--max-stage-fallback-rate", 0.3),
    maxAtomsFallbackRate: readNumberArg("--max-atoms-fallback-rate", 0.5),
  };

  const dataset = await loadDataset(datasetPath);
  const config: EngineConfig = {
    environment: "local",
    metadataBackend: "memory",
    graphBackend: "memory",
    evidenceBackend: "memory",
    vectorBackend: "memory",
    defaultScope: dataset.scope,
  };
  const llmProvider = new ReplayLlmDistillationProvider(dataset, config, dirname(datasetPath));
  const strategy = new LlmFallbackDistillationStrategy({ llmProvider });

  const caseMetrics: ReplayCaseMetric[] = [];

  for (const replayCase of dataset.cases) {
    const strategyInput: DistillationStrategyInput = {
      rawInput: replayCase.rawInput,
      config,
      scope: dataset.scope,
      sourceType: replayCase.sourceType,
      sourceSessionId: `replay:${replayCase.id}`,
    };
    const result = await strategy.distill(strategyInput);
    caseMetrics.push({
      id: replayCase.id,
      stageCoverage: result.quality.stageCoverage,
      stageFallbackRate: result.quality.stageFallbackRate,
      stageDecisions: result.quality.stageDecisions,
    });
  }

  const report: ReplayReport = {
    dataset: datasetPath,
    generatedAt: new Date().toISOString(),
    caseCount: caseMetrics.length,
    metrics: {
      avgStageCoverage: average(caseMetrics.map((metric) => metric.stageCoverage)),
      avgStageFallbackRate: average(caseMetrics.map((metric) => metric.stageFallbackRate)),
      byStage: buildStageRates(caseMetrics),
    },
    cases: caseMetrics,
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
  if (report.metrics.avgStageCoverage < thresholds.minStageCoverage) {
    failedChecks.push(
      `avgStageCoverage ${report.metrics.avgStageCoverage.toFixed(4)} < ${thresholds.minStageCoverage.toFixed(4)}`,
    );
  }
  if (report.metrics.avgStageFallbackRate > thresholds.maxStageFallbackRate) {
    failedChecks.push(
      `avgStageFallbackRate ${report.metrics.avgStageFallbackRate.toFixed(4)} > ${thresholds.maxStageFallbackRate.toFixed(4)}`,
    );
  }
  const atomsFallbackRate = report.metrics.byStage.atoms?.fallbackRate ?? 1;
  if (atomsFallbackRate > thresholds.maxAtomsFallbackRate) {
    failedChecks.push(
      `atomsFallbackRate ${atomsFallbackRate.toFixed(4)} > ${thresholds.maxAtomsFallbackRate.toFixed(4)}`,
    );
  }

  if (failedChecks.length > 0) {
    process.stderr.write(
      `CogniWeave distillation replay gate failed:\n- ${failedChecks.join("\n- ")}\n`,
    );
    process.exitCode = 1;
  }
}

await main();
