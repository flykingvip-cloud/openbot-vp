/**
 * 用量记录 store（按 enterpriseId 隔离，append-only）。
 *
 * 写入经 `dedupeUsage` 按 `(enterpriseId, eventId)` 幂等去重（R9.2 / R9.3 / Property 9）。
 *
 * 落盘：`CONFIG_DIR/openbot-billing-usage.json`。
 */

import { randomUUID } from "node:crypto";
import path from "node:path";
import { createAsyncLock, readJsonFile, writeJsonAtomic } from "../../infra/json-files.js";
import { CONFIG_DIR, resolveUserPath } from "../../utils.js";
import { canonicalizeTenantId } from "../tenant-canonicalization.js";
import { dedupeUsage } from "./control.js";
import type { UsageRecord } from "./types.js";

const USAGE_STORE_VERSION = 1;

type UsageStore = {
  version: number;
  records: UsageRecord[]; // append-only
};

function createEmptyStore(): UsageStore {
  return { version: USAGE_STORE_VERSION, records: [] };
}

export function resolveDefaultUsageRecordsStorePath(): string {
  return path.join(CONFIG_DIR, "openbot-billing-usage.json");
}

const withLock = createAsyncLock();

function tenant(enterpriseId: string): string {
  return canonicalizeTenantId(enterpriseId) ?? enterpriseId;
}

async function loadStore(storePath?: string): Promise<UsageStore> {
  const resolvedPath = resolveUserPath(storePath?.trim() || resolveDefaultUsageRecordsStorePath());
  const parsed = await readJsonFile<Partial<UsageStore>>(resolvedPath);
  if (!parsed) {
    return createEmptyStore();
  }
  return {
    version: USAGE_STORE_VERSION,
    records: Array.isArray(parsed.records) ? parsed.records : [],
  };
}

async function saveStore(store: UsageStore, storePath?: string): Promise<void> {
  const resolvedPath = resolveUserPath(storePath?.trim() || resolveDefaultUsageRecordsStorePath());
  await writeJsonAtomic(resolvedPath, store);
}

export type RecordUsageInput = {
  enterpriseId: string;
  userId: string;
  eventId: string;
  key: string;
  quantity: number;
  occurredAt?: string;
  agentId?: string | null;
  orgSeatId?: string | null;
};

export type RecordUsageResult = {
  recorded: boolean;
  deduped: boolean;
  record: UsageRecord;
};

/** 幂等写入一条用量记录。重复 eventId 被忽略（deduped=true）。 */
export async function recordUsage(
  input: RecordUsageInput,
  storePath?: string,
): Promise<RecordUsageResult> {
  return withLock(async () => {
    const store = await loadStore(storePath);
    const t = tenant(input.enterpriseId);
    const now = new Date().toISOString();
    const incoming: UsageRecord = {
      id: `usage-${randomUUID()}`,
      enterpriseId: t,
      userId: input.userId,
      eventId: input.eventId,
      key: input.key,
      quantity: input.quantity,
      occurredAt: input.occurredAt ?? now,
      ingestedAt: now,
      ...(input.agentId?.trim() ? { agentId: input.agentId.trim() } : {}),
      ...(input.orgSeatId?.trim() ? { orgSeatId: input.orgSeatId.trim() } : {}),
    };
    const { records, deduped } = dedupeUsage(store.records, incoming);
    if (!deduped) {
      store.records = records;
      await saveStore(store, storePath);
    }
    const stored = deduped
      ? (store.records.find((r) => r.enterpriseId === t && r.eventId === input.eventId) ?? incoming)
      : incoming;
    return { recorded: !deduped, deduped, record: stored };
  });
}

export type ListUsageFilter = {
  startTime?: string;
  endTime?: string;
  key?: string;
  userId?: string;
  agentId?: string;
  orgSeatId?: string;
};

/** 列出某企业用量记录（首参强制 enterpriseId，无「无租户查询」）。 */
export async function listUsageRecords(
  enterpriseId: string,
  filter: ListUsageFilter = {},
  storePath?: string,
): Promise<UsageRecord[]> {
  const store = await loadStore(storePath);
  const t = tenant(enterpriseId);
  const startMs = filter.startTime ? new Date(filter.startTime).getTime() : null;
  const endMs = filter.endTime ? new Date(filter.endTime).getTime() : null;
  return store.records
    .filter((r) => {
      if (r.enterpriseId !== t) {
        return false;
      }
      if (filter.key && r.key !== filter.key) {
        return false;
      }
      if (filter.userId && r.userId !== filter.userId) {
        return false;
      }
      if (filter.agentId && r.agentId !== filter.agentId) {
        return false;
      }
      if (filter.orgSeatId && r.orgSeatId !== filter.orgSeatId) {
        return false;
      }
      const at = new Date(r.occurredAt).getTime();
      if (startMs !== null && at < startMs) {
        return false;
      }
      if (endMs !== null && at >= endMs) {
        return false;
      }
      return true;
    })
    .toSorted((a, b) => a.occurredAt.localeCompare(b.occurredAt));
}

export type UsageAttributionPatch = {
  id: string;
  agentId?: string;
  orgSeatId?: string;
};

/** 批量补齐历史记录的 agentId / orgSeatId（仅新增缺失字段，不覆盖已有值）。 */
export async function applyUsageAttributionPatches(
  enterpriseId: string,
  patches: UsageAttributionPatch[],
  storePath?: string,
): Promise<number> {
  if (patches.length === 0) {
    return 0;
  }
  return withLock(async () => {
    const store = await loadStore(storePath);
    const t = tenant(enterpriseId);
    const patchById = new Map(patches.map((patch) => [patch.id, patch]));
    let updated = 0;
    store.records = store.records.map((rec) => {
      if (rec.enterpriseId !== t) {
        return rec;
      }
      const patch = patchById.get(rec.id);
      if (!patch) {
        return rec;
      }
      const nextAgentId = rec.agentId?.trim() || patch.agentId?.trim();
      const nextOrgSeatId = rec.orgSeatId?.trim() || patch.orgSeatId?.trim();
      if (
        nextAgentId === (rec.agentId?.trim() || undefined) &&
        nextOrgSeatId === (rec.orgSeatId?.trim() || undefined)
      ) {
        return rec;
      }
      updated += 1;
      return {
        ...rec,
        ...(nextAgentId ? { agentId: nextAgentId } : {}),
        ...(nextOrgSeatId ? { orgSeatId: nextOrgSeatId } : {}),
      };
    });
    if (updated > 0) {
      await saveStore(store, storePath);
    }
    return updated;
  });
}

export async function __resetUsageRecordsForTest(storePath?: string): Promise<void> {
  await withLock(async () => {
    await saveStore(createEmptyStore(), storePath);
  });
}
