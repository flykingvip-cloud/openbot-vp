import { resolveCronLedgerTaskId } from "../cron/wake-identity.js";
import { isLongHorizonCronJob } from "./cron-binding.js";
import { isProgressLedgerEnabled, isProgressLedgerProjected } from "./feature.js";
import type { ProgressLedgerConfigReader } from "./feature.js";
import {
  isCronProgressQuiet,
  toHumanGatePendingItem,
  type HumanGatePendingItem,
} from "./human-gate.js";

export type { HumanGatePendingItem } from "./human-gate.js";
import { projectProgress } from "./project.js";
import { createFileLedgerStore, loadFoldedLedger } from "./store.js";
import type { ExecutionLedger, ProgressView, TurnContractSnapshot } from "./types.js";

export type CronProgressJob = {
  id: string;
  name?: string;
  description?: string;
  conversationTaskId?: string;
  ownership?: { tenantId?: string; ownerId?: string };
};

export function inferTurnContractFromLedger(
  ledger: ExecutionLedger,
  options?: { quiet?: boolean },
): TurnContractSnapshot {
  const gate = ledger.currentBlocking;
  if (options?.quiet) {
    return { mode: "quiet", ...(gate ? { blockingGate: gate } : {}) };
  }
  if (!gate) {
    return { mode: "deliver" };
  }
  if (gate.reason === "blocked_user" || gate.reason === "blocked_authorization") {
    return { mode: "ask", blockingGate: gate };
  }
  if (gate.reason === "blocked_external" || gate.reason === "blocked_data") {
    return { mode: "wait", blockingGate: gate };
  }
  return { mode: "deliver", blockingGate: gate };
}

export async function readCronProgressView(params: {
  job: CronProgressJob;
  cronStorePath: string;
  nowMs?: number;
  env?: NodeJS.ProcessEnv;
  readConfig?: ProgressLedgerConfigReader;
  turnContract?: TurnContractSnapshot;
}): Promise<ProgressView | null> {
  const enabled = isProgressLedgerProjected({
    tenantId: params.job.ownership?.tenantId,
    env: params.env ?? process.env,
    readConfig: params.readConfig,
  });
  if (!enabled || !isLongHorizonCronJob(params.job)) {
    return null;
  }
  const ledger = await loadFoldedLedger(
    createFileLedgerStore({
      cronStorePath: params.cronStorePath,
      taskId: resolveCronLedgerTaskId(params.job),
    }),
  );
  if (!ledger) {
    return null;
  }
  const quiet = isCronProgressQuiet(params.job);
  return projectProgress(
    ledger,
    params.turnContract ?? inferTurnContractFromLedger(ledger, { quiet }),
    params.nowMs ?? Date.now(),
  );
}

export async function attachProgressToCronJobs<T extends CronProgressJob>(
  jobs: T[],
  params: {
    cronStorePath: string;
    nowMs?: number;
    env?: NodeJS.ProcessEnv;
    readConfig?: ProgressLedgerConfigReader;
  },
): Promise<Array<T & { progress?: ProgressView }>> {
  const enabled = isProgressLedgerEnabled(params.env ?? process.env, params.readConfig);
  if (!enabled) {
    return jobs;
  }
  const attached = await Promise.all(
    jobs.map(async (job) => {
      const progress = await readCronProgressView({
        job,
        cronStorePath: params.cronStorePath,
        nowMs: params.nowMs,
        ...(params.env ? { env: params.env } : {}),
        ...(params.readConfig ? { readConfig: params.readConfig } : {}),
      });
      return progress ? { ...job, progress } : job;
    }),
  );
  return attached;
}

export type CronHumanGateJob = CronProgressJob & {
  sessionKey?: string;
  ownership?: { tenantId?: string; ownerId?: string };
};

function normalizeIdentity(value: string | null | undefined): string {
  return value?.trim().toLowerCase() ?? "";
}

function cronBelongsToActor(
  job: CronHumanGateJob,
  actorIdentities: Set<string>,
  actorTenantId?: string,
): boolean {
  const ownerId = normalizeIdentity(job.ownership?.ownerId);
  if (!ownerId || !actorIdentities.has(ownerId)) {
    return false;
  }
  const jobTenant = normalizeIdentity(job.ownership?.tenantId);
  const tenant = normalizeIdentity(actorTenantId);
  if (jobTenant && tenant && jobTenant !== tenant) {
    return false;
  }
  return true;
}

export async function listCronHumanGates(params: {
  jobs: readonly CronHumanGateJob[];
  actorIdentities: Iterable<string>;
  actorTenantId?: string;
  cronStorePath: string;
  nowMs?: number;
  env?: NodeJS.ProcessEnv;
  readConfig?: ProgressLedgerConfigReader;
}): Promise<HumanGatePendingItem[]> {
  const enabled = isProgressLedgerEnabled(params.env ?? process.env, params.readConfig);
  if (!enabled) {
    return [];
  }
  const identities = new Set(
    [...params.actorIdentities].map((value) => normalizeIdentity(value)).filter(Boolean),
  );
  const items: HumanGatePendingItem[] = [];
  for (const job of params.jobs) {
    if (!cronBelongsToActor(job, identities, params.actorTenantId)) {
      continue;
    }
    const view = await readCronProgressView({
      job,
      cronStorePath: params.cronStorePath,
      nowMs: params.nowMs,
      ...(params.env ? { env: params.env } : {}),
      ...(params.readConfig ? { readConfig: params.readConfig } : {}),
    });
    if (!view) {
      continue;
    }
    const item = toHumanGatePendingItem(view, { sessionKey: job.sessionKey });
    if (item) {
      items.push(item);
    }
  }
  return items;
}
