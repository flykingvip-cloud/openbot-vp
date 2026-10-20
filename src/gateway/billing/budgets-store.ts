/**
 * 预算 store（按 enterpriseId 隔离）。
 *
 * - Budget 头记录可 upsert（当前预算值）；
 * - 每次变更追加 `BudgetEvent`（append-only 历史，R6.7 / R11）。
 *
 * 落盘：`CONFIG_DIR/openbot-billing-budgets.json`。
 */

import { randomUUID } from "node:crypto";
import path from "node:path";
import { createAsyncLock, readJsonFile, writeJsonAtomic } from "../../infra/json-files.js";
import { CONFIG_DIR, resolveUserPath } from "../../utils.js";
import { canonicalizeTenantId } from "../tenant-canonicalization.js";
import { appendLedgerRecord } from "./append-only-ledger.js";
import type { Budget, BudgetControls, BudgetEvent } from "./types.js";

const BUDGETS_STORE_VERSION = 1;
const DEFAULT_ALERT_THRESHOLD = 0.8;
const DEFAULT_CONTROLS: BudgetControls = {
  limitAiCalls: false,
  limitBotCreation: false,
  autoDowngrade: false,
};

type BudgetsStore = {
  version: number;
  budgets: Record<string, Budget>; // keyed by enterpriseId
  events: BudgetEvent[]; // append-only
};

function createEmptyStore(): BudgetsStore {
  return { version: BUDGETS_STORE_VERSION, budgets: {}, events: [] };
}

export function resolveDefaultBudgetsStorePath(): string {
  return path.join(CONFIG_DIR, "openbot-billing-budgets.json");
}

const withLock = createAsyncLock();

function tenant(enterpriseId: string): string {
  return canonicalizeTenantId(enterpriseId) ?? enterpriseId;
}

async function loadStore(storePath?: string): Promise<BudgetsStore> {
  const resolvedPath = resolveUserPath(storePath?.trim() || resolveDefaultBudgetsStorePath());
  const parsed = await readJsonFile<Partial<BudgetsStore>>(resolvedPath);
  if (!parsed) {
    return createEmptyStore();
  }
  return {
    version: BUDGETS_STORE_VERSION,
    budgets: parsed.budgets ?? {},
    events: Array.isArray(parsed.events) ? parsed.events : [],
  };
}

async function saveStore(store: BudgetsStore, storePath?: string): Promise<void> {
  const resolvedPath = resolveUserPath(storePath?.trim() || resolveDefaultBudgetsStorePath());
  await writeJsonAtomic(resolvedPath, store);
}

export type SetBudgetInput = {
  enterpriseId: string;
  monthlyLimitCents: number;
  alertThreshold?: number;
  controls?: Partial<BudgetControls>;
};

/** 创建或更新预算，并追加变更历史。alertThreshold 缺省 0.8（R6.2）。 */
export async function setBudget(input: SetBudgetInput, storePath?: string): Promise<Budget> {
  return withLock(async () => {
    const store = await loadStore(storePath);
    const t = tenant(input.enterpriseId);
    const now = new Date().toISOString();
    const existing = store.budgets[t];
    const controls: BudgetControls = {
      ...(existing?.controls ?? DEFAULT_CONTROLS),
      ...input.controls,
    };
    const budget: Budget = {
      id: existing?.id ?? `budget-${randomUUID()}`,
      enterpriseId: t,
      monthlyLimitCents: input.monthlyLimitCents,
      alertThreshold: input.alertThreshold ?? existing?.alertThreshold ?? DEFAULT_ALERT_THRESHOLD,
      controls,
      updatedAt: now,
    };
    store.budgets[t] = budget;
    store.events = appendLedgerRecord(store.events, {
      id: `budgetev-${randomUUID()}`,
      enterpriseId: t,
      monthlyLimitCents: budget.monthlyLimitCents,
      alertThreshold: budget.alertThreshold,
      controls: budget.controls,
      occurredAt: now,
    });
    await saveStore(store, storePath);
    return budget;
  });
}

export async function getBudget(enterpriseId: string, storePath?: string): Promise<Budget | null> {
  const store = await loadStore(storePath);
  return store.budgets[tenant(enterpriseId)] ?? null;
}

export async function listBudgetEvents(
  enterpriseId: string,
  storePath?: string,
): Promise<BudgetEvent[]> {
  const store = await loadStore(storePath);
  const t = tenant(enterpriseId);
  return store.events
    .filter((e) => e.enterpriseId === t)
    .toSorted((a, b) => a.occurredAt.localeCompare(b.occurredAt));
}

export async function __resetBudgetsForTest(storePath?: string): Promise<void> {
  await withLock(async () => {
    await saveStore(createEmptyStore(), storePath);
  });
}
