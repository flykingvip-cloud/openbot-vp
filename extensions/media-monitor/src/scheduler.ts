import { computeNextDueAt } from "./health.js";
import { readMonitorStore } from "./monitor-store.js";
import type { MonitorTarget } from "./types.js";

/**
 * Select due monitor targets. This is an internal due-check used by the plugin
 * service and/or OpenBot cron-triggered gateway methods — not a user-facing
 * APScheduler replacement.
 */
export async function listDueTargets(params: {
  storePath: string;
  now?: number;
  limit?: number;
  tenantId?: string;
  agentId?: string;
}): Promise<MonitorTarget[]> {
  const now = params.now ?? Date.now();
  const data = await readMonitorStore(params.storePath);
  const due = data.targets
    .filter((target) => target.enabled)
    .filter((target) => !params.tenantId || target.tenantId === params.tenantId)
    .filter((target) => !params.agentId || target.agentId === params.agentId)
    .filter((target) => computeNextDueAt(target, now) <= now)
    .sort((a, b) => computeNextDueAt(a, now) - computeNextDueAt(b, now));
  const limit = params.limit ?? 10;
  return due.slice(0, limit);
}
