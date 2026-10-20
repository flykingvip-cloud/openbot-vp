/**
 * Usage Ledger store（append-only，Credits 任务级审计）。
 * 落盘：`CONFIG_DIR/openbot-usage-ledger.json`。
 */

import { randomUUID } from "node:crypto";
import path from "node:path";
import { createAsyncLock, readJsonFile, writeJsonAtomic } from "../../infra/json-files.js";
import { CONFIG_DIR, resolveUserPath } from "../../utils.js";
import type { UsageLedgerEntry } from "../package-entitlement/types.js";
import { canonicalizeTenantId } from "../tenant-canonicalization.js";
import { listActiveSubscriptions } from "./subscriptions-store.js";

const STORE_VERSION = 1;

type Store = {
  version: number;
  entries: UsageLedgerEntry[];
};

function createEmptyStore(): Store {
  return { version: STORE_VERSION, entries: [] };
}

export function resolveDefaultUsageLedgerStorePath(): string {
  return path.join(CONFIG_DIR, "openbot-usage-ledger.json");
}

const withLock = createAsyncLock();

function tenant(enterpriseId: string): string {
  return canonicalizeTenantId(enterpriseId) ?? enterpriseId;
}

async function loadStore(storePath?: string): Promise<Store> {
  const resolvedPath = resolveUserPath(storePath?.trim() || resolveDefaultUsageLedgerStorePath());
  const parsed = await readJsonFile<Partial<Store>>(resolvedPath);
  if (!parsed) {
    return createEmptyStore();
  }
  return {
    version: STORE_VERSION,
    entries: Array.isArray(parsed.entries) ? parsed.entries : [],
  };
}

async function saveStore(store: Store, storePath?: string): Promise<void> {
  const resolvedPath = resolveUserPath(storePath?.trim() || resolveDefaultUsageLedgerStorePath());
  await writeJsonAtomic(resolvedPath, store);
}

export type AppendLedgerResult = {
  entry: UsageLedgerEntry;
  appended: boolean;
};

/** 按 (enterpriseId, taskId) 幂等：重复 taskId 不追加。 */
export async function appendUsageLedgerEntry(
  input: Omit<UsageLedgerEntry, "id" | "occurredAt"> & { occurredAt?: string },
  storePath?: string,
): Promise<AppendLedgerResult> {
  const entId = tenant(input.enterpriseId);
  const taskId = input.taskId.trim();
  if (!taskId) {
    throw new Error("taskId is required");
  }
  return withLock(async () => {
    const store = await loadStore(storePath);
    const existing = store.entries.find(
      (e) => tenant(e.enterpriseId) === entId && e.taskId === taskId,
    );
    if (existing) {
      return { entry: existing, appended: false };
    }
    const entry: UsageLedgerEntry = {
      id: randomUUID(),
      enterpriseId: entId,
      taskId,
      modelId: input.modelId.trim(),
      ...(input.source ? { source: input.source } : {}),
      ...(input.billingOwner ? { billingOwner: input.billingOwner } : {}),
      tier: input.tier.trim(),
      policyId: input.policyId.trim(),
      creditsCharged: Math.max(0, Math.floor(input.creditsCharged)),
      ...(input.includedCredits !== undefined
        ? { includedCredits: Math.max(0, Math.floor(input.includedCredits)) }
        : {}),
      ...(input.overageCredits !== undefined
        ? { overageCredits: Math.max(0, Math.floor(input.overageCredits)) }
        : {}),
      ...(input.overageAmountCents !== undefined
        ? { overageAmountCents: Math.max(0, Math.floor(input.overageAmountCents)) }
        : {}),
      providerCostCents: Math.max(0, Math.floor(input.providerCostCents)),
      tenantRevenueCents: Math.max(0, Math.floor(input.tenantRevenueCents)),
      ...(input.planId?.trim() ? { planId: input.planId.trim() } : {}),
      ...(input.planVersionId?.trim() ? { planVersionId: input.planVersionId.trim() } : {}),
      ...(input.subscriptionSnapshotId?.trim()
        ? { subscriptionSnapshotId: input.subscriptionSnapshotId.trim() }
        : {}),
      ...(input.subscriptionId?.trim() ? { subscriptionId: input.subscriptionId.trim() } : {}),
      ...(input.userId?.trim() ? { userId: input.userId.trim() } : {}),
      ...(input.billingSeatId?.trim() ? { billingSeatId: input.billingSeatId.trim() } : {}),
      ...(input.orgSeatId?.trim() ? { orgSeatId: input.orgSeatId.trim() } : {}),
      ...(input.botId?.trim() ? { botId: input.botId.trim() } : {}),
      ...(input.runId?.trim() ? { runId: input.runId.trim() } : {}),
      ...(input.authorizationDecisionId?.trim()
        ? { authorizationDecisionId: input.authorizationDecisionId.trim() }
        : {}),
      ...(input.inputTokens !== undefined
        ? { inputTokens: Math.max(0, Math.floor(input.inputTokens)) }
        : {}),
      ...(input.outputTokens !== undefined
        ? { outputTokens: Math.max(0, Math.floor(input.outputTokens)) }
        : {}),
      ...(input.toolCallCount !== undefined
        ? { toolCallCount: Math.max(0, Math.floor(input.toolCallCount)) }
        : {}),
      ...(input.durationMs !== undefined
        ? { durationMs: Math.max(0, Math.floor(input.durationMs)) }
        : {}),
      ...(input.retryCount !== undefined
        ? { retryCount: Math.max(0, Math.floor(input.retryCount)) }
        : {}),
      ...(input.pricingEngine ? { pricingEngine: input.pricingEngine } : {}),
      occurredAt: input.occurredAt ?? new Date().toISOString(),
    };
    store.entries.push(entry);
    await saveStore(store, storePath);
    return { entry, appended: true };
  });
}

/** 按 (enterpriseId, taskId) 取单条 ledger（阶段机续跑用）。 */
export async function getUsageLedgerEntryByTaskId(
  enterpriseId: string,
  taskId: string,
  storePath?: string,
): Promise<UsageLedgerEntry | null> {
  const entId = tenant(enterpriseId);
  const tid = taskId.trim();
  if (!tid) {
    return null;
  }
  const store = await loadStore(storePath);
  return store.entries.find((e) => tenant(e.enterpriseId) === entId && e.taskId === tid) ?? null;
}

export async function listUsageLedgerEntries(
  enterpriseId: string,
  filter?: { startTime?: string; endTime?: string },
  storePath?: string,
): Promise<UsageLedgerEntry[]> {
  const entId = tenant(enterpriseId);
  const store = await loadStore(storePath);
  const startMs = filter?.startTime ? Date.parse(filter.startTime) : null;
  const endMs = filter?.endTime ? Date.parse(filter.endTime) : null;
  return store.entries.filter((e) => {
    if (tenant(e.enterpriseId) !== entId) {
      return false;
    }
    const at = Date.parse(e.occurredAt);
    if (startMs !== null && at < startMs) {
      return false;
    }
    if (endMs !== null && at >= endMs) {
      return false;
    }
    return true;
  });
}

export async function listAllUsageLedgerEntries(
  filter?: { startTime?: string; endTime?: string },
  storePath?: string,
): Promise<UsageLedgerEntry[]> {
  const store = await loadStore(storePath);
  const startMs = filter?.startTime ? Date.parse(filter.startTime) : null;
  const endMs = filter?.endTime ? Date.parse(filter.endTime) : null;
  return store.entries.filter((e) => {
    const at = Date.parse(e.occurredAt);
    if (startMs !== null && at < startMs) {
      return false;
    }
    if (endMs !== null && at >= endMs) {
      return false;
    }
    return true;
  });
}

export type FilteredUsageLedgerQuery = {
  startTime?: string;
  endTime?: string;
  planId?: string;
  enterpriseId?: string;
  limit?: number;
};

export type FilteredUsageLedgerResult = {
  entries: UsageLedgerEntry[];
  total: number;
  startTime?: string;
  endTime?: string;
  planId?: string;
  enterpriseId?: string;
};

function resolvePlanIdForEntry(
  entry: UsageLedgerEntry,
  enterpriseToPlan: Map<string, string>,
): string | undefined {
  return entry.planId ?? enterpriseToPlan.get(entry.enterpriseId);
}

/** 平台 Ledger 钻取：按周期 / 套餐 / 企业过滤，按时间降序。 */
export async function listFilteredUsageLedgerEntries(
  query: FilteredUsageLedgerQuery,
  params?: {
    storePath?: string;
    subscriptionsStorePath?: string;
    enterpriseToPlan?: Map<string, string>;
  },
): Promise<FilteredUsageLedgerResult> {
  const entries = await listAllUsageLedgerEntries(
    { startTime: query.startTime, endTime: query.endTime },
    params?.storePath,
  );
  let enterpriseToPlan = params?.enterpriseToPlan;
  if (!enterpriseToPlan && query.planId?.trim()) {
    const subscriptions = await listActiveSubscriptions(params?.subscriptionsStorePath);
    enterpriseToPlan = new Map<string, string>();
    for (const sub of subscriptions) {
      if (sub.enterpriseId) {
        enterpriseToPlan.set(sub.enterpriseId, sub.planId);
      }
    }
  }
  const planId = query.planId?.trim();
  const enterpriseId = query.enterpriseId?.trim();
  const entFilter = enterpriseId ? tenant(enterpriseId) : null;
  let filtered = entries;
  if (entFilter) {
    filtered = filtered.filter((entry) => tenant(entry.enterpriseId) === entFilter);
  }
  if (planId && enterpriseToPlan) {
    filtered = filtered.filter(
      (entry) => resolvePlanIdForEntry(entry, enterpriseToPlan) === planId,
    );
  }
  filtered = filtered.toSorted((left, right) => right.occurredAt.localeCompare(left.occurredAt));
  const total = filtered.length;
  const limit = Math.min(Math.max(query.limit ?? 50, 1), 200);
  return {
    entries: filtered.slice(0, limit),
    total,
    ...(query.startTime ? { startTime: query.startTime } : {}),
    ...(query.endTime ? { endTime: query.endTime } : {}),
    ...(planId ? { planId } : {}),
    ...(enterpriseId ? { enterpriseId } : {}),
  };
}

export async function __resetUsageLedgerForTest(storePath?: string): Promise<void> {
  await saveStore(createEmptyStore(), storePath);
}
