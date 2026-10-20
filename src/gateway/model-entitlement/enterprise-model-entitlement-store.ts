/**
 * EnterpriseModelEntitlementStore（P1，独立并行授权层）。
 *
 * 设计：`.kiro/specs/model-entitlement-chain/design.md`（§5.3）。
 *
 * 「企业被套餐授予哪些模型」的真源。**不**复用 enterprise-seat-assets 结构。
 * 落盘 `CONFIG_DIR/openbot-model-entitlement.json`，租户键控，沿用 JSON 原子写范式。
 */

import path from "node:path";
import { createAsyncLock, readJsonFile, writeJsonAtomic } from "../../infra/json-files.js";
import { CONFIG_DIR, resolveUserPath } from "../../utils.js";
import { canonicalizeTenantId } from "../tenant-canonicalization.js";
import type { EnterpriseModelEntitlement, ModelRef } from "./types.js";

const STORE_VERSION = 1;

type Store = {
  version: number;
  /** key = canonical tenantId */
  entitlements: Record<string, EnterpriseModelEntitlement>;
};

function createEmptyStore(): Store {
  return { version: STORE_VERSION, entitlements: {} };
}

export function resolveDefaultEntitlementStorePath(): string {
  return path.join(CONFIG_DIR, "openbot-model-entitlement.json");
}

const withLock = createAsyncLock();

async function loadStore(storePath?: string): Promise<Store> {
  const resolvedPath = resolveUserPath(storePath?.trim() || resolveDefaultEntitlementStorePath());
  const parsed = await readJsonFile<Partial<Store>>(resolvedPath);
  if (!parsed || typeof parsed.entitlements !== "object" || parsed.entitlements === null) {
    return createEmptyStore();
  }
  return { version: STORE_VERSION, entitlements: parsed.entitlements };
}

async function saveStore(store: Store, storePath?: string): Promise<void> {
  const resolvedPath = resolveUserPath(storePath?.trim() || resolveDefaultEntitlementStorePath());
  await writeJsonAtomic(resolvedPath, store);
}

function dedupe(values: readonly ModelRef[]): ModelRef[] {
  return [...new Set(values.map((v) => v.trim()).filter((v) => v.length > 0))];
}

/** 读取企业 entitlement；不存在返回 null（= 未配置/未迁移，对应 state="missing"）。 */
export async function getEnterpriseModelEntitlement(
  tenantId: string,
  storePath?: string,
): Promise<EnterpriseModelEntitlement | null> {
  const canonical = canonicalizeTenantId(tenantId);
  if (!canonical) {
    return null;
  }
  const store = await loadStore(storePath);
  return store.entitlements[canonical] ?? null;
}

/** 写入/更新企业 entitlement（投影或手工迁移调用）。 */
export async function upsertEnterpriseModelEntitlement(
  input: {
    tenantId: string;
    allowedModelIds: ModelRef[];
    planVersionId?: string;
    budgetRef?: string;
  },
  storePath?: string,
): Promise<EnterpriseModelEntitlement> {
  const canonical = canonicalizeTenantId(input.tenantId);
  if (!canonical) {
    throw new Error("invalid tenantId");
  }
  return withLock(async () => {
    const store = await loadStore(storePath);
    const record: EnterpriseModelEntitlement = {
      tenantId: canonical,
      allowedModelIds: dedupe(input.allowedModelIds),
      ...(input.planVersionId ? { planVersionId: input.planVersionId } : {}),
      ...(input.budgetRef ? { budgetRef: input.budgetRef } : {}),
      updatedAt: new Date().toISOString(),
    };
    store.entitlements[canonical] = record;
    await saveStore(store, storePath);
    return record;
  });
}

export async function listEnterpriseModelEntitlements(
  storePath?: string,
): Promise<EnterpriseModelEntitlement[]> {
  const store = await loadStore(storePath);
  return Object.values(store.entitlements);
}
