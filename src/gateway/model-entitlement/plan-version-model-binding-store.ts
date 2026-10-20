/**
 * PlanVersionModelBindingStore（P2，旁路映射表）。
 *
 * 设计：`.kiro/specs/model-entitlement-chain/design.md`（§5.2）。
 *
 * 把「套餐版本 → 可用模型集合 (+ 额度 + 可选 AOR 策略)」绑定为**旁路表**，
 * 键为已锁定的 `planVersionId`。**不**污染 billing core（`billing/types.ts` 的
 * `PlanVersion` 仅按 `planVersionId` 只读引用）。
 *
 * 落盘 `CONFIG_DIR/openbot-plan-model-binding.json`，沿用 JSON 原子写范式。
 */

import path from "node:path";
import { createAsyncLock, readJsonFile, writeJsonAtomic } from "../../infra/json-files.js";
import { CONFIG_DIR, resolveUserPath } from "../../utils.js";
import { assertPlanVersionCapabilityMutable } from "../billing/plan-version-capability-guard.js";
import type {
  ModelBudget,
  ModelQuota,
  ModelRef,
  PlanModelAorExecution,
  PlanVersionModelBinding,
} from "./types.js";

const STORE_VERSION = 1;

/**
 * AOR 执行策略别名（向后兼容历史导出名）。
 * 单一定义见 `types.ts` 的 `PlanModelAorExecution`。
 */
export type PlanVersionAorExecution = PlanModelAorExecution;

export type { PlanVersionModelBinding } from "./types.js";

type Store = {
  version: number;
  /** key = planVersionId */
  bindings: Record<string, PlanVersionModelBinding>;
};

function createEmptyStore(): Store {
  return { version: STORE_VERSION, bindings: {} };
}

/**
 * 归一化单个 modelQuota 值为 ModelQuota（双上限）。
 * 兼容 legacy 单值 `number`（视作 maxRequests）。无有效上限时返回 undefined。
 */
export function normalizeModelQuotaEntry(value: unknown): ModelQuota | undefined {
  if (typeof value === "number") {
    return Number.isFinite(value) && value >= 0 ? { maxRequests: Math.floor(value) } : undefined;
  }
  if (!value || typeof value !== "object") {
    return undefined;
  }
  const raw = value as Record<string, unknown>;
  const out: ModelQuota = {};
  const maxRequests = raw.maxRequests;
  const maxTokens = raw.maxTokens;
  if (typeof maxRequests === "number" && Number.isFinite(maxRequests) && maxRequests >= 0) {
    out.maxRequests = Math.floor(maxRequests);
  }
  if (typeof maxTokens === "number" && Number.isFinite(maxTokens) && maxTokens >= 0) {
    out.maxTokens = Math.floor(maxTokens);
  }
  return out.maxRequests === undefined && out.maxTokens === undefined ? undefined : out;
}

/**
 * 归一化整张 modelQuota 表为 `Record<modelId, ModelQuota>`。
 * 兼容 legacy `Record<modelId, number>`；丢弃空键与无有效上限的条目。
 */
export function normalizeModelQuotaMap(raw: unknown): Record<string, ModelQuota> | undefined {
  if (!raw || typeof raw !== "object") {
    return undefined;
  }
  const out: Record<string, ModelQuota> = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    const modelId = key.trim();
    if (!modelId) {
      continue;
    }
    const entry = normalizeModelQuotaEntry(value);
    if (entry) {
      out[modelId] = entry;
    }
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

/**
 * 归一化单个 modelBudget 值为 ModelBudget。两上限均可选、非负整数；无有效上限返回 undefined。
 * （独立于 modelQuota：modelQuota 是 requests/tokens guardrail，这里是 credits/spend 预算。）
 */
export function normalizeModelBudgetEntry(value: unknown): ModelBudget | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }
  const raw = value as Record<string, unknown>;
  const out: ModelBudget = {};
  const monthlyCreditsCap = raw.monthlyCreditsCap;
  const spendCapCents = raw.spendCapCents;
  if (
    typeof monthlyCreditsCap === "number" &&
    Number.isFinite(monthlyCreditsCap) &&
    monthlyCreditsCap >= 0
  ) {
    out.monthlyCreditsCap = Math.floor(monthlyCreditsCap);
  }
  if (typeof spendCapCents === "number" && Number.isFinite(spendCapCents) && spendCapCents >= 0) {
    out.spendCapCents = Math.floor(spendCapCents);
  }
  return out.monthlyCreditsCap === undefined && out.spendCapCents === undefined ? undefined : out;
}

/** 归一化整张 modelBudgets 表为 `Record<modelId, ModelBudget>`；丢弃空键与无有效上限的条目。 */
export function normalizeModelBudgetMap(raw: unknown): Record<string, ModelBudget> | undefined {
  if (!raw || typeof raw !== "object") {
    return undefined;
  }
  const out: Record<string, ModelBudget> = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    const modelId = key.trim();
    if (!modelId) {
      continue;
    }
    const entry = normalizeModelBudgetEntry(value);
    if (entry) {
      out[modelId] = entry;
    }
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

/** 读时归一化绑定记录（兼容 legacy modelQuota 形态；规整 modelBudgets）。 */
function normalizeBinding(binding: PlanVersionModelBinding): PlanVersionModelBinding {
  const next: PlanVersionModelBinding = { ...binding };
  const modelQuota = normalizeModelQuotaMap(binding.modelQuota);
  if (modelQuota) {
    next.modelQuota = modelQuota;
  } else {
    delete next.modelQuota;
  }
  const modelBudgets = normalizeModelBudgetMap(binding.modelBudgets);
  if (modelBudgets) {
    next.modelBudgets = modelBudgets;
  } else {
    delete next.modelBudgets;
  }
  return next;
}

export function resolveDefaultPlanModelBindingStorePath(): string {
  return path.join(CONFIG_DIR, "openbot-plan-model-binding.json");
}

const withLock = createAsyncLock();

function dedupe(values: readonly ModelRef[]): ModelRef[] {
  return [...new Set(values.map((v) => v.trim()).filter((v) => v.length > 0))];
}

async function loadStore(storePath?: string): Promise<Store> {
  const resolvedPath = resolveUserPath(
    storePath?.trim() || resolveDefaultPlanModelBindingStorePath(),
  );
  const parsed = await readJsonFile<Partial<Store>>(resolvedPath);
  if (!parsed || typeof parsed.bindings !== "object" || parsed.bindings === null) {
    return createEmptyStore();
  }
  const normalizedBindings: Record<string, PlanVersionModelBinding> = {};
  for (const [id, binding] of Object.entries(parsed.bindings)) {
    normalizedBindings[id] = normalizeBinding(binding);
  }
  return { version: STORE_VERSION, bindings: normalizedBindings };
}

async function saveStore(store: Store, storePath?: string): Promise<void> {
  const resolvedPath = resolveUserPath(
    storePath?.trim() || resolveDefaultPlanModelBindingStorePath(),
  );
  await writeJsonAtomic(resolvedPath, store);
}

/** 读取某 planVersion 的模型绑定；不存在返回 null。 */
export async function getPlanVersionModelBinding(
  planVersionId: string,
  storePath?: string,
): Promise<PlanVersionModelBinding | null> {
  const id = planVersionId.trim();
  if (!id) {
    return null;
  }
  const store = await loadStore(storePath);
  return store.bindings[id] ?? null;
}

/** 写入/更新某 planVersion 的模型绑定。 */
export async function upsertPlanVersionModelBinding(
  input: {
    planVersionId: string;
    allowedModelIds: ModelRef[];
    allowedTiers?: string[];
    allowedPolicies?: string[];
    policyId?: string;
    modelQuota?: Record<string, ModelQuota>;
    modelBudgets?: Record<string, ModelBudget>;
    aorExecution?: PlanVersionAorExecution;
  },
  storePath?: string,
  relatedStorePaths?: { plans?: string; subscriptions?: string },
): Promise<PlanVersionModelBinding> {
  const id = input.planVersionId.trim();
  if (!id) {
    throw new Error("invalid planVersionId");
  }
  const storePreview = await loadStore(storePath);
  await assertPlanVersionCapabilityMutable(
    id,
    {
      kind: "binding",
      hasExistingRecord: Boolean(storePreview.bindings[id]),
    },
    relatedStorePaths?.plans,
    relatedStorePaths?.subscriptions,
  );
  return withLock(async () => {
    const store = await loadStore(storePath);
    const prev = store.bindings[id];
    const allowedTiers =
      input.allowedTiers !== undefined ? dedupe(input.allowedTiers) : prev?.allowedTiers;
    const allowedPolicies =
      input.allowedPolicies !== undefined ? dedupe(input.allowedPolicies) : prev?.allowedPolicies;
    const policyId =
      input.policyId !== undefined ? input.policyId.trim() || undefined : prev?.policyId;
    const record: PlanVersionModelBinding = {
      planVersionId: id,
      allowedModelIds: dedupe(input.allowedModelIds),
      ...(allowedTiers && allowedTiers.length > 0 ? { allowedTiers } : {}),
      ...(allowedPolicies && allowedPolicies.length > 0 ? { allowedPolicies } : {}),
      ...(policyId ? { policyId } : {}),
      ...(() => {
        const modelQuota = normalizeModelQuotaMap(input.modelQuota);
        return modelQuota ? { modelQuota } : {};
      })(),
      ...(() => {
        const modelBudgets = normalizeModelBudgetMap(input.modelBudgets);
        return modelBudgets ? { modelBudgets } : {};
      })(),
      ...(input.aorExecution ? { aorExecution: input.aorExecution } : {}),
      updatedAt: new Date().toISOString(),
    };
    store.bindings[id] = record;
    await saveStore(store, storePath);
    return record;
  });
}

export async function listPlanVersionModelBindings(
  storePath?: string,
): Promise<PlanVersionModelBinding[]> {
  const store = await loadStore(storePath);
  return Object.values(store.bindings);
}

/** 删除某 planVersion 的模型绑定；存在则返回被删除记录，否则返回 null。 */
export async function deletePlanVersionModelBinding(
  planVersionId: string,
  storePath?: string,
): Promise<PlanVersionModelBinding | null> {
  const id = planVersionId.trim();
  if (!id) {
    return null;
  }
  return withLock(async () => {
    const store = await loadStore(storePath);
    const existing = store.bindings[id] ?? null;
    if (!existing) {
      return null;
    }
    delete store.bindings[id];
    await saveStore(store, storePath);
    return existing;
  });
}
