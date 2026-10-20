import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import type { DistillationResult, Scope, SourceType } from "../src/models.js";
import { InMemoryCogniWeaveEngine } from "../src/runtime/in-memory-engine.js";

interface EvalCase {
  id: string;
  rawInput: string;
  sourceType: SourceType;
  expectedTaskType: string;
  expectedAtomTypes: string[];
}

interface EvalDataset {
  version: string;
  scope: Scope;
  cases: EvalCase[];
}

interface CaseMetric {
  id: string;
  expectedTaskType: string;
  predictedTaskType: string;
  taskTypeMatched: boolean;
  atomPrecision: number;
  atomRecall: number;
  schemaCorrectness: number;
  stageCoverage: number;
  stageFallbackRate: number;
  reasoningHit: boolean;
  explainabilityReady: boolean;
}

interface EvalReport {
  dataset: string;
  generatedAt: string;
  caseCount: number;
  metrics: {
    taskTypeAccuracy: number;
    atomPrecision: number;
    atomRecall: number;
    atomSchemaCorrectness: number;
    distillationStageCoverage: number;
    distillationStageFallbackRate: number;
    reasoningHitRate: number;
    explainabilityCoverage: number;
  };
  cases: CaseMetric[];
}

interface EvalThresholds {
  taskTypeAccuracy: number;
  atomPrecision: number;
  atomRecall: number;
  atomSchemaCorrectness: number;
  minDistillationStageCoverage: number;
  maxDistillationStageFallbackRate: number;
  reasoningHitRate: number;
  explainabilityCoverage: number;
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

function scoreAtomTypes(
  expected: string[],
  predicted: string[],
): { precision: number; recall: number } {
  const expectedSet = new Set(expected);
  const predictedSet = new Set(predicted);
  const intersectionSize = [...predictedSet].filter((type) => expectedSet.has(type)).length;

  const precision = predictedSet.size === 0 ? 0 : intersectionSize / predictedSet.size;
  const recall = expectedSet.size === 0 ? 1 : intersectionSize / expectedSet.size;

  return { precision, recall };
}

function scoreAtomSchema(distillation: DistillationResult): number {
  if (distillation.atoms.length === 0) {
    return 0;
  }

  const validCount = distillation.atoms.filter((atom) => {
    const hasClaim = atom.claim.statement.trim().length > 0;
    const hasTrigger = atom.trigger.conditions.length > 0;
    const hasApplicability =
      Array.isArray(atom.applicability.include) && Array.isArray(atom.applicability.exclude);
    const hasProvenance = atom.provenance.sourceEventIds.length > 0;
    return hasClaim && hasTrigger && hasApplicability && hasProvenance;
  }).length;

  return validCount / distillation.atoms.length;
}

async function loadDataset(datasetPath: string): Promise<EvalDataset> {
  const file = await readFile(datasetPath, "utf8");
  const dataset = JSON.parse(file) as EvalDataset;
  if (!dataset.scope || !dataset.cases || dataset.cases.length === 0) {
    throw new Error("Dataset is invalid: scope/cases are required");
  }
  return dataset;
}

async function main(): Promise<void> {
  const datasetPath = resolve(readArg("--dataset") ?? "datasets/mvp-core-eval.json");
  const outputPath = readArg("--output");
  const enforceThresholds = hasFlag("--enforce-thresholds");
  const thresholds: EvalThresholds = {
    taskTypeAccuracy: readNumberArg("--min-task-type-accuracy", 0.8),
    atomPrecision: readNumberArg("--min-atom-precision", 0.75),
    atomRecall: readNumberArg("--min-atom-recall", 0.5),
    atomSchemaCorrectness: readNumberArg("--min-atom-schema-correctness", 0.9),
    minDistillationStageCoverage: readNumberArg("--min-distillation-stage-coverage", 0.5),
    maxDistillationStageFallbackRate: readNumberArg("--max-distillation-stage-fallback-rate", 0.8),
    reasoningHitRate: readNumberArg("--min-reasoning-hit-rate", 0.7),
    explainabilityCoverage: readNumberArg("--min-explainability-coverage", 0.7),
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

  const caseMetrics: CaseMetric[] = [];

  for (const testCase of dataset.cases) {
    const distillation = await engine.distill({
      rawInput: testCase.rawInput,
      scope: dataset.scope,
      sourceType: testCase.sourceType,
      sourceSessionId: `eval:${dataset.version}`,
    });

    await engine.writeBack({
      rawInput: testCase.rawInput,
      scope: dataset.scope,
      sourceType: testCase.sourceType,
      sourceSessionId: `eval:${dataset.version}`,
    });

    const taskFrame = await engine.frameTask(testCase.rawInput, { scope: dataset.scope });
    const packageResult = await engine.reason(taskFrame, {
      includeExplainability: true,
      includeOptionalEvidenceRefs: true,
    });

    const atomTypes = distillation.atoms.map((atom) => atom.atomType);
    const atomScore = scoreAtomTypes(testCase.expectedAtomTypes, atomTypes);
    const schemaCorrectness = scoreAtomSchema(distillation);

    caseMetrics.push({
      id: testCase.id,
      expectedTaskType: testCase.expectedTaskType,
      predictedTaskType: taskFrame.taskType,
      taskTypeMatched: taskFrame.taskType === testCase.expectedTaskType,
      atomPrecision: atomScore.precision,
      atomRecall: atomScore.recall,
      schemaCorrectness,
      stageCoverage: distillation.quality.stageCoverage,
      stageFallbackRate: distillation.quality.stageFallbackRate,
      reasoningHit: packageResult.supportingAtoms.length > 0,
      explainabilityReady:
        packageResult.why.summary.trim().length > 0 && packageResult.reasoningPath.length > 0,
    });
  }

  const report: EvalReport = {
    dataset: datasetPath,
    generatedAt: new Date().toISOString(),
    caseCount: caseMetrics.length,
    metrics: {
      taskTypeAccuracy: average(caseMetrics.map((item) => (item.taskTypeMatched ? 1 : 0))),
      atomPrecision: average(caseMetrics.map((item) => item.atomPrecision)),
      atomRecall: average(caseMetrics.map((item) => item.atomRecall)),
      atomSchemaCorrectness: average(caseMetrics.map((item) => item.schemaCorrectness)),
      distillationStageCoverage: average(caseMetrics.map((item) => item.stageCoverage)),
      distillationStageFallbackRate: average(caseMetrics.map((item) => item.stageFallbackRate)),
      reasoningHitRate: average(caseMetrics.map((item) => (item.reasoningHit ? 1 : 0))),
      explainabilityCoverage: average(
        caseMetrics.map((item) => (item.explainabilityReady ? 1 : 0)),
      ),
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
  const metrics = report.metrics;
  if (metrics.taskTypeAccuracy < thresholds.taskTypeAccuracy) {
    failedChecks.push(
      `taskTypeAccuracy ${metrics.taskTypeAccuracy.toFixed(4)} < ${thresholds.taskTypeAccuracy.toFixed(4)}`,
    );
  }
  if (metrics.atomPrecision < thresholds.atomPrecision) {
    failedChecks.push(
      `atomPrecision ${metrics.atomPrecision.toFixed(4)} < ${thresholds.atomPrecision.toFixed(4)}`,
    );
  }
  if (metrics.atomRecall < thresholds.atomRecall) {
    failedChecks.push(
      `atomRecall ${metrics.atomRecall.toFixed(4)} < ${thresholds.atomRecall.toFixed(4)}`,
    );
  }
  if (metrics.atomSchemaCorrectness < thresholds.atomSchemaCorrectness) {
    failedChecks.push(
      `atomSchemaCorrectness ${metrics.atomSchemaCorrectness.toFixed(4)} < ${thresholds.atomSchemaCorrectness.toFixed(4)}`,
    );
  }
  if (metrics.distillationStageCoverage < thresholds.minDistillationStageCoverage) {
    failedChecks.push(
      `distillationStageCoverage ${metrics.distillationStageCoverage.toFixed(4)} < ${thresholds.minDistillationStageCoverage.toFixed(4)}`,
    );
  }
  if (metrics.distillationStageFallbackRate > thresholds.maxDistillationStageFallbackRate) {
    failedChecks.push(
      `distillationStageFallbackRate ${metrics.distillationStageFallbackRate.toFixed(4)} > ${thresholds.maxDistillationStageFallbackRate.toFixed(4)}`,
    );
  }
  if (metrics.reasoningHitRate < thresholds.reasoningHitRate) {
    failedChecks.push(
      `reasoningHitRate ${metrics.reasoningHitRate.toFixed(4)} < ${thresholds.reasoningHitRate.toFixed(4)}`,
    );
  }
  if (metrics.explainabilityCoverage < thresholds.explainabilityCoverage) {
    failedChecks.push(
      `explainabilityCoverage ${metrics.explainabilityCoverage.toFixed(4)} < ${thresholds.explainabilityCoverage.toFixed(4)}`,
    );
  }

  if (failedChecks.length > 0) {
    process.stderr.write(`CogniWeave MVP gate failed:\n- ${failedChecks.join("\n- ")}\n`);
    process.exitCode = 1;
  }
}

await main();
