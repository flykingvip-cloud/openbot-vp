import { enqueueOutbox, newId, nowIso } from "./monitor-store.js";
import { buildNotificationBody } from "./normalizer.js";
import type {
  MonitorEvent,
  MonitorStoreData,
  MonitorTarget,
  NotificationOutboxRow,
} from "./types.js";

const MAX_ATTEMPTS = 8;
const BASE_RETRY_MS = 30_000;
export const DEFAULT_OUTBOX_CLAIM_TTL_MS = 60_000;

export function createOutboxForEvent(params: {
  data: MonitorStoreData;
  target: MonitorTarget;
  event: MonitorEvent;
  channel: string;
  destination: string;
  accountId?: string;
  now?: number;
}): NotificationOutboxRow | null {
  if (!params.channel.trim() || !params.destination.trim()) {
    return null;
  }
  // Health events always notify; content/comment only after baseline (caller decides).
  const title =
    typeof params.event.payloadJson.title === "string" ? params.event.payloadJson.title : undefined;
  const summary =
    typeof params.event.payloadJson.text === "string"
      ? params.event.payloadJson.text
      : typeof params.event.payloadJson.message === "string"
        ? params.event.payloadJson.message
        : undefined;

  const body = buildNotificationBody({
    eventType: params.event.eventType,
    target: params.target,
    title,
    summary,
    contentUrl: params.event.contentUrl,
    publishedAt: params.event.publishedAt,
    observedAt: params.event.observedAt,
  });

  const now = params.now ?? Date.now();
  return enqueueOutbox(params.data, {
    id: newId("out"),
    eventId: params.event.id,
    targetId: params.target.id,
    tenantId: params.target.tenantId,
    agentId: params.target.agentId,
    channel: params.channel.trim(),
    destination: params.destination.trim(),
    accountId: params.accountId?.trim() || undefined,
    status: "pending",
    attempts: 0,
    nextAttemptAt: nowIso(now),
    createdAt: nowIso(now),
    body,
  });
}

function isClaimExpired(row: NotificationOutboxRow, now: number): boolean {
  if (!row.claimUntil) {
    return true;
  }
  const until = Date.parse(row.claimUntil);
  return !Number.isFinite(until) || until <= now;
}

/** Read-only view of rows that are eligible to claim (for tests/status). */
export function listDueOutbox(data: MonitorStoreData, now = Date.now()): NotificationOutboxRow[] {
  return data.outbox.filter((row) => {
    if (row.status === "pending" || row.status === "retry") {
      const next = Date.parse(row.nextAttemptAt);
      return !Number.isFinite(next) || next <= now;
    }
    if (row.status === "sending" && isClaimExpired(row, now)) {
      return true;
    }
    return false;
  });
}

/**
 * Atomically claim due outbox rows inside a store transaction.
 * Marks them `sending` with claimOwner/claimUntil so concurrent flushers skip them.
 */
export function claimDueOutbox(
  data: MonitorStoreData,
  params: {
    owner: string;
    limit?: number;
    now?: number;
    claimTtlMs?: number;
    tenantId?: string;
    agentId?: string;
  },
): NotificationOutboxRow[] {
  const now = params.now ?? Date.now();
  const limit = Math.max(1, params.limit ?? 20);
  const claimTtlMs = Math.max(1_000, params.claimTtlMs ?? DEFAULT_OUTBOX_CLAIM_TTL_MS);
  const claimed: NotificationOutboxRow[] = [];

  for (const row of data.outbox) {
    if (claimed.length >= limit) {
      break;
    }
    if (params.tenantId && row.tenantId !== params.tenantId) {
      continue;
    }
    if (params.agentId && row.agentId !== params.agentId) {
      continue;
    }
    const duePending =
      (row.status === "pending" || row.status === "retry") &&
      (() => {
        const next = Date.parse(row.nextAttemptAt);
        return !Number.isFinite(next) || next <= now;
      })();
    const reclaimable = row.status === "sending" && isClaimExpired(row, now);
    if (!duePending && !reclaimable) {
      continue;
    }
    row.status = "sending";
    row.claimOwner = params.owner;
    row.claimUntil = nowIso(now + claimTtlMs);
    claimed.push(row);
  }
  return claimed;
}

export function markOutboxSent(row: NotificationOutboxRow, now = Date.now()): void {
  row.status = "sent";
  row.sentAt = nowIso(now);
  row.lastError = undefined;
  row.claimOwner = undefined;
  row.claimUntil = undefined;
}

export function markOutboxFailure(
  row: NotificationOutboxRow,
  error: string,
  now = Date.now(),
): void {
  row.attempts += 1;
  row.lastError = error.slice(0, 500);
  row.claimOwner = undefined;
  row.claimUntil = undefined;
  if (row.attempts >= MAX_ATTEMPTS) {
    row.status = "dead_letter";
    return;
  }
  row.status = "retry";
  const delay = Math.min(60 * 60_000, BASE_RETRY_MS * 2 ** Math.min(row.attempts, 6));
  row.nextAttemptAt = nowIso(now + delay);
}
