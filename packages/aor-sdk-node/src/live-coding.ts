import { writeFileSync } from "node:fs";
import { OpenAiCompatGatewayClient } from "@openbot/aor-backend-openbot";
import type { AorRunResult } from "@openbot/aor-core";
import { createCodingClient, resolveToolsHttpBaseUrl } from "./client.js";
import type { ObjectiveCommandSpec, ObjectiveCoverageSpec } from "./coding-evaluator.js";
import { resolveWorkspaceObjectiveCommands } from "./workspace-objective.js";

/** JSON-serializable live coding run archive (production / gateway evidence). */
export interface LiveCodingArchiveRecord {
  archivedAt: string;
  gatewayUrl: string;
  workspace: string;
  goal: string;
  mode: "live-gateway" | "mock-gateway";
  result: {
    runId: string;
    taskType: string;
    model: string;
    evaluationScore?: number;
    evaluationSignals?: Record<string, number>;
    totalTokens: number;
    costUsd?: number;
    latencyMs: number;
    outputPreview: string;
  };
}

export interface LiveCodingArchiveOptions {
  goal?: string;
  workspace?: string;
  gatewayUrl?: string;
  apiKey?: string;
  banditStatePath?: string;
  /** Override workspace-resolved build command (tests only). */
  build?: ObjectiveCommandSpec;
  /** Override workspace-resolved test command (tests only). */
  test?: ObjectiveCommandSpec;
  /** Override workspace-resolved coverage command (tests only). */
  coverage?: ObjectiveCoverageSpec;
  /** Inject gateway fetch for tests (live HTTP otherwise). */
  fetchImpl?: typeof fetch;
}

function numericSignals(
  signals: Record<string, number | boolean> | undefined,
): Record<string, number> | undefined {
  if (!signals) {
    return undefined;
  }
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(signals)) {
    if (typeof v === "number") {
      out[k] = v;
    }
  }
  return out;
}

function summarizeResult(result: AorRunResult): LiveCodingArchiveRecord["result"] {
  return {
    runId: result.runId,
    taskType: result.taskType,
    model: `${result.selection.model.provider}/${result.selection.model.id}`,
    evaluationScore: result.evaluation?.score,
    evaluationSignals: numericSignals(result.evaluation?.signals),
    totalTokens: result.usage.totalTokens,
    costUsd: result.usage.costUsd,
    latencyMs: result.latencyMs,
    outputPreview: result.output.text.slice(0, 500),
  };
}

/**
 * Run a single coding.review against a live (or mocked) Gateway with the objective
 * build/test evaluator — archives structured evidence for Stage 4 acceptance.
 */
export async function runLiveCodingArchive(
  options: LiveCodingArchiveOptions = {},
): Promise<LiveCodingArchiveRecord> {
  const workspace = options.workspace ?? process.cwd();
  const gatewayUrl = options.gatewayUrl ?? resolveToolsHttpBaseUrl({});
  const goal = options.goal ?? "review this codebase and suggest improvements";
  const mode = options.fetchImpl ? "mock-gateway" : "live-gateway";

  const objective = resolveWorkspaceObjectiveCommands(workspace, {
    build: options.build,
    test: options.test,
    coverage: options.coverage,
  });

  const client = createCodingClient({
    baseUrl: gatewayUrl,
    apiKey: options.apiKey,
    workspace,
    banditStatePath: options.banditStatePath,
    build: objective.build,
    test: objective.test,
    coverage: objective.coverage,
    gatewayClient: options.fetchImpl
      ? new OpenAiCompatGatewayClient({ baseUrl: gatewayUrl, fetchImpl: options.fetchImpl })
      : undefined,
  });

  const result = await client.agent({ goal, type: "coding.review" }).run({ strategy: "balanced" });

  return {
    archivedAt: new Date().toISOString(),
    gatewayUrl,
    workspace,
    goal,
    mode,
    result: summarizeResult(result),
  };
}

export function writeLiveCodingArchive(path: string, record: LiveCodingArchiveRecord): void {
  writeFileSync(path, `${JSON.stringify(record, null, 2)}\n`, "utf8");
}

/** Convenience: live archive using an injectable backend (unit tests). */
export async function runLiveCodingArchiveWithBackend(params: {
  backend: import("@openbot/aor-core").ExecutionBackend;
  workspace?: string;
  goal?: string;
}): Promise<LiveCodingArchiveRecord> {
  const { AorClient } = await import("./client.js");
  const { createObjectiveCodingEvaluator } = await import("./coding-evaluator.js");
  const workspace = params.workspace ?? process.cwd();
  const goal = params.goal ?? "review module";
  const objective = resolveWorkspaceObjectiveCommands(workspace);
  const evaluators = new Map([
    [
      "coding.review",
      createObjectiveCodingEvaluator({
        taskType: "coding.review",
        cwd: workspace,
        build: objective.build,
        test: objective.test,
        coverage: objective.coverage,
      }),
    ],
  ]);
  const client = new AorClient({ backend: params.backend, evaluators });
  const result = await client.agent({ goal, type: "coding.review" }).run();
  return {
    archivedAt: new Date().toISOString(),
    gatewayUrl: "stub://offline",
    workspace,
    goal,
    mode: "mock-gateway",
    result: summarizeResult(result),
  };
}
