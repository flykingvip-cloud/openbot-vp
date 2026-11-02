/**
 * SeatModelGrantStore（P1，独立并行授权层）。
 *
 * 设计：`.kiro/specs/model-entitlement-chain/design.md`（§5.4）。
 *
 * 「企业把其 entitlement 中的哪些模型授权给某 seat / employee」。
 * 支持 **seat 级** 与 **employee 级** 两种粒度（解析时 employee 优先于 seat）。
 * **不**扩展 EnterpriseManagedAssetType、**不**复用 handover-heavy 的 seat asset 结构。
 * 落盘 `CONFIG_DIR/openbot-seat-model-grant.json`。
 */

import path from "node:path";
import { createAsyncLock, readJsonFile, writeJsonAtomic } from "../../infra/json-files.js";
import { CONFIG_DIR, resolveUserPath } from "../../utils.js";
import { canonicalizeTenantId } from "../tenant-canonicalization.js";
import { recordModelGrantAuditEvent } from "./model-grant-audit.js";
import type { ModelGrantSubjectType, ModelRef, SeatModelGrant } from "./types.js";

const STORE_VERSION = 2;

type Store = {
  version: number;
  /** key = `${canonicalTenantId}::${subjectType}::${subjectId}` */
  grants: Record<string, SeatModelGrant>;
};

function createEmptyStore(): Store {
  return { version: STORE_VERSION, grants: {} };
}

export function resolveDefaultSeatGrantStorePath(): string {
  return path.join(CONFIG_DIR, "openbot-seat-model-grant.json");
}

const withLock = createAsyncLock();

function keyOf(tenantId: string, subjectType: ModelGrantSubjectType, subjectId: string): string {
  return `${tenantId}::${subjectType}::${subjectId}`;
}

function dedupe(values: readonly ModelRef[]): ModelRef[] {
  return [...new Set(values.map((v) => v.trim()).filter((v) => v.length > 0))];
}

async function loadStore(storePath?: string): Promise<Store> {
  const resolvedPath = resolveUserPath(storePath?.trim() || resolveDefaultSeatGrantStorePath());
  const parsed = await readJsonFile<Partial<Store>>(resolvedPath);
  if (!parsed || typeof parsed.grants !== "object" || parsed.grants === null) {
    return createEmptyStore();
  }
  return { version: STORE_VERSION, grants: parsed.grants };
}

async function saveStore(store: Store, storePath?: string): Promise<void> {
  const resolvedPath = resolveUserPath(storePath?.trim() || resolveDefaultSeatGrantStorePath());
  await writeJsonAtomic(resolvedPath, store);
}

// ── 通用主体级 API ──────────────────────────────────────────────────────────

export async function getModelGrant(
  input: { tenantId: string; subjectType: ModelGrantSubjectType; subjectId: string },
  storePath?: string,
): Promise<SeatModelGrant | null> {
  const canonical = canonicalizeTenantId(input.tenantId);
  if (!canonical || !input.subjectId.trim()) {
    return null;
  }
  const store = await loadStore(storePath);
  return store.grants[keyOf(canonical, input.subjectType, input.subjectId.trim())] ?? null;
}

export type ModelGrantMergeMode = "replace" | "union";

function resolveGrantedModelIds(params: {
  existing: SeatModelGrant | undefined;
  grantedModelIds: readonly ModelRef[];
  mergeMode: ModelGrantMergeMode;
}): ModelRef[] {
  if (params.mergeMode === "union") {
    const prior =
      params.existing?.status === "active" ? params.existing.grantedModelIds : ([] as ModelRef[]);
    return dedupe([...prior, ...params.grantedModelIds]);
  }
  return dedupe(params.grantedModelIds);
}

function buildGrantRecord(input: {
  tenantId: string;
  subjectType: ModelGrantSubjectType;
  subjectId: string;
  seatId?: string;
  employeeId?: string;
  grantedModelIds: ModelRef[];
}): SeatModelGrant {
  const subjectId = input.subjectId.trim();
  return {
    tenantId: input.tenantId,
    subjectType: input.subjectType,
    subjectId,
    ...(input.seatId
      ? { seatId: input.seatId }
      : input.subjectType === "seat"
        ? { seatId: subjectId }
        : {}),
    ...(input.employeeId
      ? { employeeId: input.employeeId }
      : input.subjectType === "employee"
        ? { employeeId: subjectId }
        : {}),
    grantedModelIds: input.grantedModelIds,
    status: "active",
    updatedAt: new Date().toISOString(),
  };
}

export async function setModelGrant(
  input: {
    tenantId: string;
    subjectType: ModelGrantSubjectType;
    subjectId: string;
    seatId?: string;
    employeeId?: string;
    grantedModelIds: ModelRef[];
    /** `union` merges into the subject's existing active grant; default `replace`. */
    mergeMode?: ModelGrantMergeMode;
    actorUserId?: string;
  },
  storePath?: string,
): Promise<SeatModelGrant> {
  const [record] = await setModelGrantsAtomic(
    {
      tenantId: input.tenantId,
      items: [
        {
          subjectType: input.subjectType,
          subjectId: input.subjectId,
          ...(input.seatId ? { seatId: input.seatId } : {}),
          ...(input.employeeId ? { employeeId: input.employeeId } : {}),
          grantedModelIds: input.grantedModelIds,
          mergeMode: input.mergeMode ?? "replace",
        },
      ],
      ...(input.actorUserId ? { actorUserId: input.actorUserId } : {}),
    },
    storePath,
  );
  return record;
}

/**
 * Atomically apply one or more seat/employee grants under a single store lock + write.
 * Used by wizard multi-seat initial auth so a mid-loop failure cannot leave partial grants.
 */
export async function setModelGrantsAtomic(
  input: {
    tenantId: string;
    items: Array<{
      subjectType: ModelGrantSubjectType;
      subjectId: string;
      seatId?: string;
      employeeId?: string;
      grantedModelIds: ModelRef[];
      mergeMode?: ModelGrantMergeMode;
    }>;
    actorUserId?: string;
  },
  storePath?: string,
): Promise<SeatModelGrant[]> {
  const canonical = canonicalizeTenantId(input.tenantId);
  if (!canonical) {
    throw new Error("invalid tenantId");
  }
  if (input.items.length === 0) {
    return [];
  }
  for (const item of input.items) {
    if (!item.subjectId.trim()) {
      throw new Error("invalid subjectId");
    }
  }
  return withLock(async () => {
    const store = await loadStore(storePath);
    const records: SeatModelGrant[] = [];
    for (const item of input.items) {
      const subjectId = item.subjectId.trim();
      const key = keyOf(canonical, item.subjectType, subjectId);
      const existing = store.grants[key];
      const grantedModelIds = resolveGrantedModelIds({
        existing,
        grantedModelIds: item.grantedModelIds,
        mergeMode: item.mergeMode ?? "replace",
      });
      const record = buildGrantRecord({
        tenantId: canonical,
        subjectType: item.subjectType,
        subjectId,
        ...(item.seatId ? { seatId: item.seatId } : {}),
        ...(item.employeeId ? { employeeId: item.employeeId } : {}),
        grantedModelIds,
      });
      store.grants[key] = record;
      records.push(record);
    }
    await saveStore(store, storePath);
    for (const record of records) {
      await recordModelGrantAuditEvent({
        type: "model.granted",
        tenantId: canonical,
        subjectType: record.subjectType,
        subjectId: record.subjectId,
        seatId: record.seatId,
        employeeId: record.employeeId,
        modelIds: record.grantedModelIds,
        actorUserId: input.actorUserId,
      });
    }
    return records;
  });
}

export async function revokeModelGrant(
  input: {
    tenantId: string;
    subjectType: ModelGrantSubjectType;
    subjectId: string;
    actorUserId?: string;
  },
  storePath?: string,
): Promise<SeatModelGrant | null> {
  const canonical = canonicalizeTenantId(input.tenantId);
  if (!canonical || !input.subjectId.trim()) {
    return null;
  }
  return withLock(async () => {
    const store = await loadStore(storePath);
    const key = keyOf(canonical, input.subjectType, input.subjectId.trim());
    const existing = store.grants[key];
    if (!existing) {
      return null;
    }
    const record: SeatModelGrant = {
      ...existing,
      grantedModelIds: [],
      status: "revoked",
      updatedAt: new Date().toISOString(),
    };
    store.grants[key] = record;
    await saveStore(store, storePath);
    await recordModelGrantAuditEvent({
      type: "model.revoked",
      tenantId: canonical,
      subjectType: input.subjectType,
      subjectId: input.subjectId.trim(),
      seatId: record.seatId,
      employeeId: record.employeeId,
      modelIds: existing.grantedModelIds,
      actorUserId: input.actorUserId,
    });
    return record;
  });
}

export async function listSeatModelGrantsForTenant(
  tenantId: string,
  storePath?: string,
): Promise<SeatModelGrant[]> {
  const canonical = canonicalizeTenantId(tenantId);
  if (!canonical) {
    return [];
  }
  const store = await loadStore(storePath);
  return Object.values(store.grants).filter((g) => g.tenantId === canonical);
}

/**
 * Remove runtime ids from every grant in the tenant.
 * Used when an enterprise asset/connection is deleted, and when the
 * authorization list finds `ent/…` grants whose assets are already gone.
 * Returns how many grant records changed.
 */
export async function forgetModelIdsFromTenantGrants(
  input: {
    tenantId: string;
    modelIds: readonly ModelRef[];
    actorUserId?: string;
  },
  storePath?: string,
): Promise<number> {
  const canonical = canonicalizeTenantId(input.tenantId);
  const drop = new Set(input.modelIds.map((id) => id.trim()).filter((id) => id.length > 0));
  if (!canonical || drop.size === 0) {
    return 0;
  }
  const changed = await withLock(async () => {
    const store = await loadStore(storePath);
    const now = new Date().toISOString();
    const updates: Array<{ record: SeatModelGrant; removed: ModelRef[] }> = [];
    for (const [key, grant] of Object.entries(store.grants)) {
      if (grant.tenantId !== canonical) {
        continue;
      }
      const removed = grant.grantedModelIds.filter((id) => drop.has(id.trim()));
      if (removed.length === 0) {
        continue;
      }
      const nextIds = grant.grantedModelIds.filter((id) => !drop.has(id.trim()));
      const record: SeatModelGrant = {
        ...grant,
        grantedModelIds: nextIds,
        updatedAt: now,
      };
      store.grants[key] = record;
      updates.push({ record, removed });
    }
    if (updates.length === 0) {
      return [];
    }
    await saveStore(store, storePath);
    return updates;
  });
  for (const update of changed) {
    await recordModelGrantAuditEvent({
      type: "model.revoked",
      tenantId: canonical,
      subjectType: update.record.subjectType,
      subjectId: update.record.subjectId,
      seatId: update.record.seatId,
      employeeId: update.record.employeeId,
      modelIds: update.removed,
      ...(input.actorUserId ? { actorUserId: input.actorUserId } : {}),
    });
  }
  return changed.length;
}

// ── seat 级便捷包装（向后兼容） ───────────────────────────────────────────────

export function getSeatModelGrant(
  tenantId: string,
  seatId: string,
  storePath?: string,
): Promise<SeatModelGrant | null> {
  return getModelGrant({ tenantId, subjectType: "seat", subjectId: seatId }, storePath);
}

export function grantSeatModels(
  input: {
    tenantId: string;
    seatId: string;
    employeeId?: string;
    grantedModelIds: ModelRef[];
    actorUserId?: string;
  },
  storePath?: string,
): Promise<SeatModelGrant> {
  return setModelGrant(
    {
      tenantId: input.tenantId,
      subjectType: "seat",
      subjectId: input.seatId,
      ...(input.employeeId ? { employeeId: input.employeeId } : {}),
      grantedModelIds: input.grantedModelIds,
      ...(input.actorUserId ? { actorUserId: input.actorUserId } : {}),
    },
    storePath,
  );
}

export function revokeSeatModels(
  input: { tenantId: string; seatId: string; actorUserId?: string },
  storePath?: string,
): Promise<SeatModelGrant | null> {
  return revokeModelGrant(
    {
      tenantId: input.tenantId,
      subjectType: "seat",
      subjectId: input.seatId,
      ...(input.actorUserId ? { actorUserId: input.actorUserId } : {}),
    },
    storePath,
  );
}

// ── employee 级便捷包装 ──────────────────────────────────────────────────────

export function getEmployeeModelGrant(
  tenantId: string,
  employeeId: string,
  storePath?: string,
): Promise<SeatModelGrant | null> {
  return getModelGrant({ tenantId, subjectType: "employee", subjectId: employeeId }, storePath);
}

export function grantEmployeeModels(
  input: {
    tenantId: string;
    employeeId: string;
    seatId?: string;
    grantedModelIds: ModelRef[];
    actorUserId?: string;
  },
  storePath?: string,
): Promise<SeatModelGrant> {
  return setModelGrant(
    {
      tenantId: input.tenantId,
      subjectType: "employee",
      subjectId: input.employeeId,
      ...(input.seatId ? { seatId: input.seatId } : {}),
      grantedModelIds: input.grantedModelIds,
      ...(input.actorUserId ? { actorUserId: input.actorUserId } : {}),
    },
    storePath,
  );
}
