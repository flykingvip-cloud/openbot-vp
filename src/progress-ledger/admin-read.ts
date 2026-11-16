import { resolveCronLedgerTaskId } from "../cron/wake-identity.js";
import { isProgressLedgerEnabled } from "./feature.js";
import type { ProgressLedgerConfigReader } from "./feature.js";
import { getLedgerMetrics, type LedgerMetrics, type LedgerMetricsSnapshot } from "./metrics.js";
import { attachProgressToCronJobs, type CronProgressJob } from "./read.js";
import type { ProgressView } from "./types.js";

export type AdminProgressJob = CronProgressJob & {
  ownership?: { tenantId?: string; ownerId?: string };
};

export type AdminProgressLedgerItem = {
  taskId: string;
  jobName?: string;
  ownerId?: string;
  progress: ProgressView;
};

export type AdminProgressLedgerResult = {
  projectionKind: "canonical";
  items: AdminProgressLedgerItem[];
  metrics: LedgerMetricsSnapshot;
};

/**
 * Admin / governance read. Uses the same attachProgressToCronJobs + projectProgress
 * path as cron.list. Never writes events.
 */
export async function readAdminProgressLedger(params: {
  jobs: readonly AdminProgressJob[];
  cronStorePath: string;
  nowMs?: number;
  env?: NodeJS.ProcessEnv;
  readConfig?: ProgressLedgerConfigReader;
  metrics?: LedgerMetrics;
  limit?: number;
}): Promise<AdminProgressLedgerResult> {
  const metrics = params.metrics ?? getLedgerMetrics();
  const enabled = isProgressLedgerEnabled(params.env ?? process.env, params.readConfig);
  if (!enabled) {
    return { projectionKind: "canonical", items: [], metrics: metrics.snapshot() };
  }
  const limit = Math.max(1, Math.min(params.limit ?? 100, 200));
  const attached = await attachProgressToCronJobs([...params.jobs], {
    cronStorePath: params.cronStorePath,
    nowMs: params.nowMs,
    ...(params.env ? { env: params.env } : {}),
    ...(params.readConfig ? { readConfig: params.readConfig } : {}),
  });
  const items: AdminProgressLedgerItem[] = [];
  for (const job of attached) {
    if (!job.progress || job.progress.projectionKind !== "canonical") {
      continue;
    }
    items.push({
      taskId: resolveCronLedgerTaskId(job),
      ...(job.name?.trim() ? { jobName: job.name.trim() } : {}),
      ...(job.ownership?.ownerId ? { ownerId: job.ownership.ownerId } : {}),
      progress: job.progress,
    });
    if (items.length >= limit) {
      break;
    }
  }
  return { projectionKind: "canonical", items, metrics: metrics.snapshot() };
}
