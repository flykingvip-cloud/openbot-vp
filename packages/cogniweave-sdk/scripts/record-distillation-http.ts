import { mkdir, writeFile, readFile } from "node:fs/promises";
import { dirname, relative, resolve } from "node:path";
import type { Scope, SourceType } from "../src/models.js";

const DEFAULT_STAGE_ORDER = ["event", "context", "atoms", "relations"] as const;
type StageName = (typeof DEFAULT_STAGE_ORDER)[number];

interface RecordDatasetCase {
  id: string;
  rawInput: string;
  sourceType: SourceType;
}

interface RecordDataset {
  version: string;
  scope: Scope;
  cases: RecordDatasetCase[];
}

interface RecordingSummaryCase {
  id: string;
  bundlePath: string;
  respondedStages: string[];
  missingStages: string[];
  failedStages: string[];
}

interface RecordingSummary {
  dataset: string;
  generatedAt: string;
  caseCount: number;
  endpoint: string;
  stageOrder: string[];
  stageResponseRates: Record<string, number>;
  outputDataset: string;
  outputDir: string;
  cases: RecordingSummaryCase[];
}

function readArg(flag: string): string | undefined {
  const index = process.argv.indexOf(flag);
  if (index === -1 || index + 1 >= process.argv.length) {
    return undefined;
  }
  return process.argv[index + 1];
}

function hasFlag(flag: string): boolean {
  return process.argv.includes(flag);
}

function readNumberArg(flag: string, fallback: number): number {
  const raw = readArg(flag);
  if (!raw) {
    return fallback;
  }
  const value = Number(raw);
  return Number.isFinite(value) ? value : fallback;
}

function parseStageOrder(raw: string | undefined): StageName[] {
  if (!raw) {
    return [...DEFAULT_STAGE_ORDER];
  }
  const parsed = raw
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry): entry is StageName =>
      (DEFAULT_STAGE_ORDER as readonly string[]).includes(entry),
    );
  if (parsed.length === 0) {
    return [...DEFAULT_STAGE_ORDER];
  }
  return [...new Set(parsed)] as StageName[];
}

async function loadDataset(datasetPath: string): Promise<RecordDataset> {
  const content = await readFile(datasetPath, "utf8");
  const parsed = JSON.parse(content) as {
    version?: string;
    scope?: Scope;
    cases?: Array<Record<string, unknown>>;
  };
  if (!parsed.scope || !parsed.cases || parsed.cases.length === 0) {
    throw new Error("Dataset is invalid: scope/cases are required");
  }

  const cases: RecordDatasetCase[] = parsed.cases
    .map((record) => ({
      id: typeof record.id === "string" ? record.id : "",
      rawInput: typeof record.rawInput === "string" ? record.rawInput : "",
      sourceType:
        typeof record.sourceType === "string" ? (record.sourceType as SourceType) : "chat",
    }))
    .filter((record) => record.id.length > 0 && record.rawInput.length > 0);

  if (cases.length === 0) {
    throw new Error("Dataset contains no valid cases");
  }

  return {
    version: typeof parsed.version === "string" ? parsed.version : "unknown",
    scope: parsed.scope,
    cases,
  };
}

async function requestStage(options: {
  endpoint: string;
  apiKey?: string;
  model?: string;
  timeoutMs: number;
  stage: StageName;
  replayCase: RecordDatasetCase;
  scope: Scope;
}): Promise<unknown | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs);
  try {
    const response = await fetch(options.endpoint, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(options.apiKey ? { authorization: `Bearer ${options.apiKey}` } : {}),
      },
      body: JSON.stringify({
        rawInput: options.replayCase.rawInput,
        scope: options.scope,
        sourceType: options.replayCase.sourceType,
        sourceSessionId: `record:${options.replayCase.id}`,
        metadata: {
          __distill_profile: "multi_call",
          __distill_stage: options.stage,
          __recording: "true",
          __recording_case_id: options.replayCase.id,
        },
        forceRebuild: true,
        ...(options.model ? { model: options.model } : {}),
      }),
      signal: controller.signal,
    });
    if (!response.ok) {
      return null;
    }
    return (await response.json()) as unknown;
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

async function main(): Promise<void> {
  const datasetPath = resolve(readArg("--dataset") ?? "datasets/mvp-core-eval.json");
  const outputDir = resolve(readArg("--output-dir") ?? "datasets/replay-http-recordings/generated");
  const outputDataset = resolve(
    readArg("--output-dataset") ?? "datasets/distillation-replay-http-recorded.generated.json",
  );
  const summaryPath = resolve(
    readArg("--summary-output") ?? ".runtime/cogniweave-record-distill-http-summary.json",
  );
  const stageOrder = parseStageOrder(readArg("--stage-order"));
  const limit = Math.max(1, readNumberArg("--limit", Number.MAX_SAFE_INTEGER));
  const timeoutMs = Math.max(1000, readNumberArg("--timeout-ms", 8000));
  const endpoint = readArg("--endpoint") ?? process.env.COGNIWEAVE_LLM_DISTILL_ENDPOINT;
  const apiKey = readArg("--api-key") ?? process.env.COGNIWEAVE_LLM_DISTILL_API_KEY;
  const model = readArg("--model") ?? process.env.COGNIWEAVE_LLM_DISTILL_MODEL;
  const dryRun = hasFlag("--dry-run");

  if (!endpoint && !dryRun) {
    throw new Error(
      "Missing endpoint: provide --endpoint or COGNIWEAVE_LLM_DISTILL_ENDPOINT for recording",
    );
  }

  const dataset = await loadDataset(datasetPath);
  const cases = dataset.cases.slice(0, limit);

  if (dryRun) {
    const dryRunPayload = {
      mode: "dry_run",
      dataset: datasetPath,
      endpoint: endpoint ?? null,
      outputDir,
      outputDataset,
      summaryPath,
      stageOrder,
      caseCount: cases.length,
      caseIds: cases.map((replayCase) => replayCase.id),
    };
    process.stdout.write(`${JSON.stringify(dryRunPayload, null, 2)}\n`);
    return;
  }

  await mkdir(outputDir, { recursive: true });
  await mkdir(dirname(outputDataset), { recursive: true });
  await mkdir(dirname(summaryPath), { recursive: true });

  const summaryCases: RecordingSummaryCase[] = [];
  const stageResponseCounters = new Map<string, number>();
  for (const stage of stageOrder) {
    stageResponseCounters.set(stage, 0);
  }

  for (const replayCase of cases) {
    const bundle: Partial<Record<StageName, unknown | null>> = {};
    const respondedStages: string[] = [];
    const missingStages: string[] = [];
    const failedStages: string[] = [];

    for (const stage of stageOrder) {
      const payload = await requestStage({
        endpoint: endpoint!,
        apiKey,
        model,
        timeoutMs,
        stage,
        replayCase,
        scope: dataset.scope,
      });
      bundle[stage] = payload;
      if (payload === null) {
        missingStages.push(stage);
        failedStages.push(stage);
        continue;
      }
      respondedStages.push(stage);
      stageResponseCounters.set(stage, (stageResponseCounters.get(stage) ?? 0) + 1);
    }

    const bundleFilePath = resolve(outputDir, `${replayCase.id}.json`);
    await writeFile(bundleFilePath, `${JSON.stringify(bundle, null, 2)}\n`, "utf8");

    summaryCases.push({
      id: replayCase.id,
      bundlePath: bundleFilePath,
      respondedStages,
      missingStages,
      failedStages,
    });
  }

  const datasetDir = dirname(outputDataset);
  const generatedDataset = {
    version: `${dataset.version}-http-recorded`,
    scope: dataset.scope,
    stageOrder,
    cases: summaryCases.map((summaryCase) => ({
      id: summaryCase.id,
      rawInput: cases.find((item) => item.id === summaryCase.id)?.rawInput ?? "",
      sourceType: cases.find((item) => item.id === summaryCase.id)?.sourceType ?? "chat",
      stageSnapshotBundle: relative(datasetDir, summaryCase.bundlePath).replaceAll("\\", "/"),
    })),
  };
  await writeFile(outputDataset, `${JSON.stringify(generatedDataset, null, 2)}\n`, "utf8");

  const stageResponseRates: Record<string, number> = {};
  for (const stage of stageOrder) {
    const responded = stageResponseCounters.get(stage) ?? 0;
    stageResponseRates[stage] = cases.length === 0 ? 0 : responded / cases.length;
  }

  const summary: RecordingSummary = {
    dataset: datasetPath,
    generatedAt: new Date().toISOString(),
    caseCount: cases.length,
    endpoint: endpoint!,
    stageOrder: [...stageOrder],
    stageResponseRates,
    outputDataset,
    outputDir,
    cases: summaryCases,
  };
  await writeFile(summaryPath, `${JSON.stringify(summary, null, 2)}\n`, "utf8");
  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
}

await main();
