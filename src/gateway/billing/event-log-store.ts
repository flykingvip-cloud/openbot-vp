/**
 * 持久事件日志（durable event log）。
 *
 * 计费不能丢未投递事件：域事件先 append 到本日志（落盘），再投递给消费者。
 * 消费失败的事件留在日志（status=failed），可由 `replayPending` 重放（at-least-once）。
 *
 * 落盘：`CONFIG_DIR/openbot-billing-events.json`，单调 `seq`（不回收）。
 * 每次重写前压缩，避免日志把 gateway 堆撑到 OOM：
 * - 已投递（done）的事件删除。用量快照来自 usage ledger，不靠重放本日志重建。
 * - failed 只保留 24 小时。
 * - 同一次 knowledge-governance gov-llm 调用（call / tokens / 按知识库记录）合并成一条。
 * 复用 `enterprise-seat-assets-store.ts` 的 JSON 文件范式（readJsonFile/writeJsonAtomic）。
 */

import path from "node:path";
import { createAsyncLock, readJsonFile, writeJsonAtomic } from "../../infra/json-files.js";
import { CONFIG_DIR, resolveUserPath } from "../../utils.js";
import { canonicalizeTenantId } from "../tenant-canonicalization.js";
import {
  compactBillingEventLog,
  usageRecordContainsEventId,
  type DeliveredUsageKey,
} from "./event-log-compact.js";
import type { BillingDomainEvent, DurableEvent, DurableEventStatus } from "./types.js";

const EVENT_LOG_STORE_VERSION = 1;

type EventLogStore = {
  version: number;
  nextSeq: number;
  events: DurableEvent[];
  /** usage.reported ids already delivered. Not full events. Pruned after 24h. */
  deliveredUsage?: DeliveredUsageKey[];
};

function createEmptyStore(): EventLogStore {
  return { version: EVENT_LOG_STORE_VERSION, nextSeq: 1, events: [] };
}

export function resolveDefaultEventLogStorePath(): string {
  return path.join(CONFIG_DIR, "openbot-billing-events.json");
}

const withLock = createAsyncLock();

function normalizeDeliveredUsage(value: unknown): DeliveredUsageKey[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  const delivered: DeliveredUsageKey[] = [];
  for (const entry of value) {
    if (!entry || typeof entry !== "object") {
      continue;
    }
    const record = entry as Partial<DeliveredUsageKey>;
    const enterpriseId = typeof record.enterpriseId === "string" ? record.enterpriseId : "";
    const eventId = typeof record.eventId === "string" ? record.eventId : "";
    const at = typeof record.at === "string" ? record.at : "";
    if (!enterpriseId || !eventId || !at) {
      continue;
    }
    delivered.push({ enterpriseId, eventId, at });
  }
  return delivered.length > 0 ? delivered : undefined;
}

async function loadStore(storePath?: string): Promise<EventLogStore> {
  const resolvedPath = resolveUserPath(storePath?.trim() || resolveDefaultEventLogStorePath());
  const parsed = await readJsonFile<Partial<EventLogStore>>(resolvedPath);
  if (!parsed) {
    return createEmptyStore();
  }
  const events = Array.isArray(parsed.events) ? parsed.events : [];
  const maxSeq = events.reduce((acc, event) => Math.max(acc, event.seq), 0);
  const deliveredUsage = normalizeDeliveredUsage(parsed.deliveredUsage);
  return {
    version: EVENT_LOG_STORE_VERSION,
    nextSeq: typeof parsed.nextSeq === "number" ? Math.max(parsed.nextSeq, maxSeq + 1) : maxSeq + 1,
    events,
    ...(deliveredUsage ? { deliveredUsage } : {}),
  };
}

async function saveStore(store: EventLogStore, storePath?: string): Promise<void> {
  const resolvedPath = resolveUserPath(storePath?.trim() || resolveDefaultEventLogStorePath());
  const payload: EventLogStore = {
    version: store.version,
    nextSeq: store.nextSeq,
    events: store.events,
    ...(store.deliveredUsage && store.deliveredUsage.length > 0
      ? { deliveredUsage: store.deliveredUsage }
      : {}),
  };
  await writeJsonAtomic(resolvedPath, payload);
}

function compactStore(store: EventLogStore, nowMs = Date.now()): boolean {
  const result = compactBillingEventLog(store.events, store.deliveredUsage ?? [], nowMs);
  if (!result.changed) {
    return false;
  }
  store.events = result.events;
  store.deliveredUsage = result.deliveredUsage.length > 0 ? result.deliveredUsage : undefined;
  return true;
}

function usageIdentityMatches(event: DurableEvent, enterpriseId: string, eventId: string): boolean {
  if (event.enterpriseId !== enterpriseId || event.event?.type !== "usage.reported") {
    return false;
  }
  return usageRecordContainsEventId(event.event, eventId);
}

function hasDeliveredUsage(store: EventLogStore, enterpriseId: string, eventId: string): boolean {
  return (
    store.deliveredUsage?.some(
      (entry) => entry.enterpriseId === enterpriseId && entry.eventId === eventId,
    ) ?? false
  );
}

/**
 * 追加一条域事件，返回带 seq 的持久事件记录（status=pending）。
 * 重写前会压缩已投递行、过期失败行，以及拆开的 gov-llm 调用。
 */
export async function appendEventLog(
  event: BillingDomainEvent,
  storePath?: string,
): Promise<DurableEvent> {
  return withLock(async () => {
    const store = await loadStore(storePath);
    const enterpriseId = canonicalizeTenantId(event.enterpriseId) ?? event.enterpriseId;
    // usage.reported：按 (enterpriseId, eventId) 幂等，防 event 阶段崩溃重放双投递。
    // 已投递行不留在日志里，幂等命中走 deliveredUsage（24h）。
    if (event.type === "usage.reported" && event.eventId?.trim()) {
      const eventId = event.eventId.trim();
      if (hasDeliveredUsage(store, enterpriseId, eventId)) {
        return {
          seq: 0,
          status: "done",
          enterpriseId,
          event: { ...event, enterpriseId },
          recordedAt: new Date().toISOString(),
        };
      }
      const existing = store.events.find((entry) =>
        usageIdentityMatches(entry, enterpriseId, eventId),
      );
      if (existing) {
        return existing;
      }
    }
    const durable: DurableEvent = {
      seq: store.nextSeq,
      status: "pending",
      enterpriseId,
      event: { ...event, enterpriseId },
      recordedAt: new Date().toISOString(),
    };
    store.events.push(durable);
    store.nextSeq += 1;
    compactStore(store);
    await saveStore(store, storePath);
    if (event.type === "usage.reported" && event.eventId?.trim()) {
      const eventId = event.eventId.trim();
      return (
        store.events.find((entry) => usageIdentityMatches(entry, enterpriseId, eventId)) ?? durable
      );
    }
    return store.events.find((entry) => entry.seq === durable.seq) ?? durable;
  });
}

/** 更新某事件的投递状态（done/failed）。不改其它字段（仅状态可演进）。 */
export async function markEventStatus(
  seq: number,
  status: DurableEventStatus,
  storePath?: string,
): Promise<void> {
  await commitEventStatuses([{ seq, status }], storePath);
}

export type EventStatusUpdate = {
  seq: number;
  status: DurableEventStatus;
};

/**
 * Apply many delivery outcomes in one load/parse/write.
 * A no-op (status already stored, and nothing to prune) does not rewrite the log.
 * Replay must use this: rewriting the whole events array once per event
 * retains a fresh copy of every historical event on the V8 heap.
 * The single rewrite drops delivered rows, expired failures, and split gov-llm rows.
 */
export async function commitEventStatuses(
  updates: readonly EventStatusUpdate[],
  storePath?: string,
): Promise<void> {
  if (updates.length === 0) {
    return;
  }
  await withLock(async () => {
    const store = await loadStore(storePath);
    const bySeq = new Map(store.events.map((event) => [event.seq, event]));
    let changed = false;
    for (const update of updates) {
      const target = bySeq.get(update.seq);
      if (!target || target.status === update.status) {
        continue;
      }
      target.status = update.status;
      changed = true;
    }
    if (compactStore(store)) {
      changed = true;
    }
    if (changed) {
      await saveStore(store, storePath);
    }
  });
}

export type ListEventsFilter = {
  status?: DurableEventStatus[];
  enterpriseId?: string;
  /** Stop after this many matches. The rest of the parsed log is dropped. */
  limit?: number;
};

/** 列出事件（可按状态/租户过滤），按 seq 升序。 */
export async function listEvents(
  filter: ListEventsFilter = {},
  storePath?: string,
): Promise<DurableEvent[]> {
  const store = await loadStore(storePath);
  const tenant = filter.enterpriseId
    ? (canonicalizeTenantId(filter.enterpriseId) ?? filter.enterpriseId)
    : null;
  const matched: DurableEvent[] = [];
  for (const event of store.events) {
    if (filter.status && !filter.status.includes(event.status)) {
      continue;
    }
    if (tenant && event.enterpriseId !== tenant) {
      continue;
    }
    matched.push(event);
  }
  matched.sort((a, b) => a.seq - b.seq);
  const limited =
    typeof filter.limit === "number" && filter.limit >= 0
      ? matched.slice(0, filter.limit)
      : matched;
  // Drop the full array so callers that only needed `limit` matches do not
  // keep every historical event alive across the following await.
  store.events = [];
  return limited;
}

/** 测试辅助：重置日志文件。 */
export async function __resetEventLogForTest(storePath?: string): Promise<void> {
  await withLock(async () => {
    await saveStore(createEmptyStore(), storePath);
  });
}
