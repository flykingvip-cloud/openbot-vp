/**
 * AI Runs Store
 * Storage layer for AI task execution logs.
 */

import type { AiRun, AiRunStatus } from "../shared/types.ts";
import { generateRunId } from "../shared/utils.ts";

// ============================================================================
// In-Memory Store
// ============================================================================

const runsStore = new Map<string, AiRun>();

// ============================================================================
// CRUD Operations
// ============================================================================

export async function createRun(params: Omit<AiRun, "id" | "createdAt">): Promise<AiRun> {
  const run: AiRun = {
    ...params,
    id: generateRunId(),
    createdAt: new Date().toISOString(),
  };
  runsStore.set(run.id, run);
  return run;
}

export async function startRun(assetId: string, taskId: string | null): Promise<AiRun> {
  const now = new Date().toISOString();
  return createRun({
    assetId,
    taskId,
    startTime: now,
    endTime: null,
    durationMs: null,
    status: "running",
    errorCode: null,
    tokensInput: 0,
    tokensOutput: 0,
    cost: 0,
  });
}

export async function completeRun(
  runId: string,
  status: Extract<AiRunStatus, "success" | "failed" | "timeout">,
  params: {
    tokensInput: number;
    tokensOutput: number;
    cost: number;
    errorCode?: string;
  },
): Promise<AiRun | null> {
  const run = runsStore.get(runId);
  if (!run) {
    return null;
  }

  const endTime = new Date().toISOString();
  const durationMs = new Date(endTime).getTime() - new Date(run.startTime).getTime();

  const completed: AiRun = {
    ...run,
    endTime,
    durationMs,
    status,
    tokensInput: params.tokensInput,
    tokensOutput: params.tokensOutput,
    cost: params.cost,
    errorCode: params.errorCode ?? null,
  };

  runsStore.set(runId, completed);
  return completed;
}

export async function getRunById(id: string): Promise<AiRun | null> {
  return runsStore.get(id) ?? null;
}

export async function updateRun(
  id: string,
  updates: Partial<Omit<AiRun, "id" | "createdAt">>,
): Promise<AiRun | null> {
  const run = runsStore.get(id);
  if (!run) {
    return null;
  }
  const updated: AiRun = { ...run, ...updates };
  runsStore.set(id, updated);
  return updated;
}

// ============================================================================
// Query Operations
// ============================================================================

export async function listRunsByAsset(
  assetId: string,
  options: {
    limit?: number;
    after?: string;
    before?: string;
    status?: AiRunStatus;
  } = {},
): Promise<AiRun[]> {
  let runs = Array.from(runsStore.values()).filter((r) => r.assetId === assetId);

  if (options.status) {
    runs = runs.filter((r) => r.status === options.status);
  }

  if (options.after) {
    const afterTime = new Date(options.after).getTime();
    runs = runs.filter((r) => new Date(r.startTime).getTime() >= afterTime);
  }

  if (options.before) {
    const beforeTime = new Date(options.before).getTime();
    runs = runs.filter((r) => new Date(r.startTime).getTime() <= beforeTime);
  }

  // Sort by start time descending
  runs = runs.toSorted((a, b) => new Date(b.startTime).getTime() - new Date(a.startTime).getTime());

  if (options.limit) {
    runs = runs.slice(0, options.limit);
  }

  return runs;
}

export async function getRunsForAggregation(
  assetId: string,
  startTime: string,
  endTime: string,
): Promise<AiRun[]> {
  const runs = Array.from(runsStore.values()).filter((r) => {
    if (r.assetId !== assetId) {
      return false;
    }
    const runStart = new Date(r.startTime).getTime();
    const rangeStart = new Date(startTime).getTime();
    const rangeEnd = new Date(endTime).getTime();
    return runStart >= rangeStart && runStart <= rangeEnd;
  });

  return runs.toSorted((a, b) => new Date(b.startTime).getTime() - new Date(a.startTime).getTime());
}

// ============================================================================
// Statistics Operations
// ============================================================================

export async function getRunStats(
  assetId: string,
  startTime: string,
  endTime: string,
): Promise<{
  total: number;
  success: number;
  failed: number;
  timeout: number;
  running: number;
}> {
  const runs = await getRunsForAggregation(assetId, startTime, endTime);

  return {
    total: runs.length,
    success: runs.filter((r) => r.status === "success").length,
    failed: runs.filter((r) => r.status === "failed").length,
    timeout: runs.filter((r) => r.status === "timeout").length,
    running: runs.filter((r) => r.status === "running").length,
  };
}

// ============================================================================
// Bulk Operations
// ============================================================================

export async function deleteRunsByAsset(assetId: string): Promise<number> {
  let count = 0;
  for (const [id, run] of runsStore) {
    if (run.assetId === assetId) {
      runsStore.delete(id);
      count++;
    }
  }
  return count;
}

export async function getRunningRuns(): Promise<AiRun[]> {
  return Array.from(runsStore.values())
    .filter((r) => r.status === "running")
    .toSorted((a, b) => new Date(b.startTime).getTime() - new Date(a.startTime).getTime());
}

// ============================================================================
// Cleanup Operations
// ============================================================================

export async function cleanupOldRuns(beforeDate: string): Promise<number> {
  const cutoff = new Date(beforeDate).getTime();
  let count = 0;

  for (const [id, run] of runsStore) {
    if (new Date(run.createdAt).getTime() < cutoff) {
      runsStore.delete(id);
      count++;
    }
  }

  return count;
}

// ============================================================================
// Store Management
// ============================================================================

export function clearRunsStore(): void {
  runsStore.clear();
}

export function seedRunsForTesting(runs: AiRun[]): void {
  for (const run of runs) {
    runsStore.set(run.id, run);
  }
}

export function getRunsStoreSize(): number {
  return runsStore.size;
}
