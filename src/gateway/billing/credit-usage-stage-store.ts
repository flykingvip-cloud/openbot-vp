/**
 * Credits 用量阶段机（taskId 级）。
 *
 * 阶段：pending → ledger_written → bucket_debited → tenant_projected
 *       → usage_record → event_published → done
 *
 * 去重键仍是 taskId，但「已完成」以 stage===done 为准，而非「ledger 存在」。
 * 重试从最后未完成阶段续跑，各阶段幂等。
 *
 * 落盘：`CONFIG_DIR/openbot-credit-usage-stages.json`。
 */

import path from "node:path";
import { createAsyncLock, readJsonFile, writeJsonAtomic } from "../../infra/json-files.js";
import { CONFIG_DIR, resolveUserPath } from "../../utils.js";
import { canonicalizeTenantId } from "../tenant-canonicalization.js";

const STORE_VERSION = 1;

export type CreditUsageStage =
  | "pending"
  | "ledger_written"
  | "bucket_debited"
  | "tenant_projected"
  | "usage_record"
  | "event_published"
  | "done";

export const CREDIT_USAGE_STAGE_ORDER: readonly CreditUsageStage[] = [
  "pending",
  "ledger_written",
  "bucket_debited",
  "tenant_projected",
  "usage_record",
  "event_published",
  "done",
] as const;

export type CreditUsageStageRecord = {
  enterpriseId: string;
  taskId: string;
  stage: CreditUsageStage;
  creditsCharged: number;
  cycleStart?: string;
  skippedConsumption?: boolean;
  updatedAt: string;
};

type Store = {
  version: number;
  byKey: Record<string, CreditUsageStageRecord>;
};

function createEmptyStore(): Store {
  return { version: STORE_VERSION, byKey: {} };
}

export function resolveDefaultCreditUsageStageStorePath(): string {
  return path.join(CONFIG_DIR, "openbot-credit-usage-stages.json");
}

const withLock = createAsyncLock();

function tenant(enterpriseId: string): string {
  return canonicalizeTenantId(enterpriseId) ?? enterpriseId;
}

function stageKey(enterpriseId: string, taskId: string): string {
  return `${tenant(enterpriseId)}|${taskId.trim()}`;
}

async function loadStore(storePath?: string): Promise<Store> {
  const resolvedPath = resolveUserPath(
    storePath?.trim() || resolveDefaultCreditUsageStageStorePath(),
  );
  const parsed = await readJsonFile<Partial<Store>>(resolvedPath);
  if (!parsed || typeof parsed.byKey !== "object" || parsed.byKey === null) {
    return createEmptyStore();
  }
  return { version: STORE_VERSION, byKey: parsed.byKey };
}

async function saveStore(store: Store, storePath?: string): Promise<void> {
  const resolvedPath = resolveUserPath(
    storePath?.trim() || resolveDefaultCreditUsageStageStorePath(),
  );
  await writeJsonAtomic(resolvedPath, store);
}

export function stageIndex(stage: CreditUsageStage): number {
  return CREDIT_USAGE_STAGE_ORDER.indexOf(stage);
}

/** current 是否已达到或超过 target。 */
export function stageAtLeast(current: CreditUsageStage, target: CreditUsageStage): boolean {
  return stageIndex(current) >= stageIndex(target);
}

export async function getCreditUsageStage(
  enterpriseId: string,
  taskId: string,
  storePath?: string,
): Promise<CreditUsageStageRecord | null> {
  const store = await loadStore(storePath);
  return store.byKey[stageKey(enterpriseId, taskId)] ?? null;
}

export async function upsertCreditUsageStage(
  input: {
    enterpriseId: string;
    taskId: string;
    stage: CreditUsageStage;
    creditsCharged: number;
    cycleStart?: string;
    skippedConsumption?: boolean;
  },
  storePath?: string,
): Promise<CreditUsageStageRecord> {
  return withLock(async () => {
    const store = await loadStore(storePath);
    const key = stageKey(input.enterpriseId, input.taskId);
    const existing = store.byKey[key];
    // 阶段只前进不后退（并发重试时保留更后阶段）
    if (existing && stageAtLeast(existing.stage, input.stage) && existing.stage !== input.stage) {
      return existing;
    }
    if (existing && existing.stage === input.stage) {
      return existing;
    }
    const record: CreditUsageStageRecord = {
      enterpriseId: tenant(input.enterpriseId),
      taskId: input.taskId.trim(),
      stage: input.stage,
      creditsCharged: Math.max(0, Math.floor(input.creditsCharged)),
      ...(input.cycleStart ? { cycleStart: input.cycleStart } : {}),
      ...(input.skippedConsumption !== undefined
        ? { skippedConsumption: input.skippedConsumption }
        : existing?.skippedConsumption !== undefined
          ? { skippedConsumption: existing.skippedConsumption }
          : {}),
      updatedAt: new Date().toISOString(),
    };
    store.byKey[key] = record;
    await saveStore(store, storePath);
    return record;
  });
}

export async function __resetCreditUsageStagesForTest(storePath?: string): Promise<void> {
  await saveStore(createEmptyStore(), storePath);
}
