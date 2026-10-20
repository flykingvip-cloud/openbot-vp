/**
 * run-registry.ts — in-process active Worker run handles (M2 cancel channel).
 *
 * Maps supervised taskId → live Worker run so `abort` can call `worker.cancel`.
 * Also indexes by authoritative runId (P0-3) so UI/audit can correlate without
 * mixing stale rounds on retry. Ephemeral (not persisted); `SupervisedTask.activeRun`
 * is the durable snapshot.
 */

import type { Worker, WorkerLogEvent } from "../../fabric/worker/types.js";

export type RegisteredSupervisorRun = {
  taskId: string;
  runId: string;
  workerId: string;
  worker: Pick<Worker, "cancel">;
  onProgress?: (event: WorkerLogEvent) => void;
};

const activeRuns = new Map<string, RegisteredSupervisorRun>();
const runsByRunId = new Map<string, RegisteredSupervisorRun>();

export function registerSupervisorRun(entry: RegisteredSupervisorRun): void {
  activeRuns.set(entry.taskId, entry);
  if (entry.runId.trim()) {
    runsByRunId.set(entry.runId.trim(), entry);
  }
}

export function unregisterSupervisorRun(taskId: string): void {
  const existing = activeRuns.get(taskId.trim());
  activeRuns.delete(taskId.trim());
  if (existing?.runId) {
    runsByRunId.delete(existing.runId.trim());
  }
}

export function getSupervisorRun(taskId: string): RegisteredSupervisorRun | undefined {
  return activeRuns.get(taskId.trim());
}

export function getSupervisorRunByRunId(runId: string): RegisteredSupervisorRun | undefined {
  return runsByRunId.get(runId.trim());
}

export function hasSupervisorRun(taskId: string): boolean {
  return activeRuns.has(taskId.trim());
}

/** Best-effort cancel of the live worker run; false when no in-process run exists. */
export async function cancelSupervisorRun(taskId: string): Promise<boolean> {
  const entry = activeRuns.get(taskId.trim());
  if (!entry) {
    return false;
  }
  try {
    await entry.worker.cancel(entry.runId);
    return true;
  } catch {
    return false;
  }
}

/** Test-only: clear all registered runs. */
export function clearSupervisorRunsForTest(): void {
  activeRuns.clear();
  runsByRunId.clear();
}
