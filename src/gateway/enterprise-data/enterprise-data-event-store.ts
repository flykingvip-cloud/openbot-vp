// Enterprise Data Event Bus — independent store (persistence + CRUD + bounded retention).
// Spec: .kiro/specs/enterprise-data-event-bus/{requirements,design,tasks}.md
//
// Mirrors the enterprise-data store conventions (store.ts / semantic-object-store.ts) but
// persists to its OWN file so it never touches the shared EnterpriseDataStore (D3).
// Metadata-First: the event log stores only event metadata, never business data rows (D2).

import { randomUUID } from "node:crypto";
import path from "node:path";
import { createAsyncLock, readJsonFile, writeJsonAtomic } from "../../infra/json-files.js";
import { CONFIG_DIR, resolveUserPath } from "../../utils.js";
import { canonicalizeTenantId } from "../tenant-canonicalization.js";
import { EnterpriseDataStoreError } from "./connector-action-store.js";
import {
  ENTERPRISE_DATA_EVENT_RETENTION_PER_TENANT,
  ENTERPRISE_DATA_EVENT_STORE_VERSION,
  type EnterpriseDataEvent,
  type EnterpriseDataEventStore,
  type EnterpriseDataEventSubscription,
  type EnterpriseDataEventType,
} from "./enterprise-data-event-types.js";
import type { SemanticObjectKind } from "./semantic-object-types.js";

const DEFAULT_STORE_FILENAME = "openbot-enterprise-data-event-bus.json";

/** Append input: id/tenant/receivedAt are store-managed. */
export type EnterpriseDataEventInput = Omit<
  EnterpriseDataEvent,
  "eventId" | "tenantId" | "receivedAt"
>;

/** Subscription upsert input: id/tenant/timestamps are store-managed. */
export type EnterpriseDataEventSubscriptionInput = Omit<
  EnterpriseDataEventSubscription,
  "subscriptionId" | "tenantId" | "createdAt" | "updatedAt"
> & { subscriptionId?: string };

// ─────────────────────────────────────────────────────────────────────────────
// Persistence (mirrors enterprise-data/store.ts)
// ─────────────────────────────────────────────────────────────────────────────

function normalizeEvent(event: EnterpriseDataEvent): EnterpriseDataEvent {
  return {
    ...event,
    tenantId: canonicalizeTenantId(event.tenantId) ?? event.tenantId,
  };
}

function normalizeSubscription(
  subscription: EnterpriseDataEventSubscription,
): EnterpriseDataEventSubscription {
  return {
    ...subscription,
    tenantId: canonicalizeTenantId(subscription.tenantId) ?? subscription.tenantId,
  };
}

export function normalizeEnterpriseDataEventStore(
  parsed: Partial<EnterpriseDataEventStore> | null | undefined,
): EnterpriseDataEventStore {
  const events = parsed?.events ?? {};
  const subscriptions = parsed?.subscriptions ?? {};
  return {
    version: parsed?.version ?? ENTERPRISE_DATA_EVENT_STORE_VERSION,
    events: Object.fromEntries(
      Object.entries(events).map(([id, event]) => [id, normalizeEvent(event)]),
    ),
    subscriptions: Object.fromEntries(
      Object.entries(subscriptions).map(([id, subscription]) => [
        id,
        normalizeSubscription(subscription),
      ]),
    ),
  };
}

export function resolveDefaultEnterpriseDataEventStorePath(): string {
  return path.join(CONFIG_DIR, DEFAULT_STORE_FILENAME);
}

export async function loadEnterpriseDataEventStore(
  storePath?: string,
): Promise<EnterpriseDataEventStore> {
  const resolvedPath = resolveUserPath(
    storePath?.trim() || resolveDefaultEnterpriseDataEventStorePath(),
  );
  const parsed = await readJsonFile<Partial<EnterpriseDataEventStore>>(resolvedPath);
  return normalizeEnterpriseDataEventStore(parsed);
}

export async function saveEnterpriseDataEventStore(
  store: EnterpriseDataEventStore,
  storePath?: string,
): Promise<void> {
  const resolvedPath = resolveUserPath(
    storePath?.trim() || resolveDefaultEnterpriseDataEventStorePath(),
  );
  const normalized = normalizeEnterpriseDataEventStore({
    ...store,
    version: ENTERPRISE_DATA_EVENT_STORE_VERSION,
  });
  await writeJsonAtomic(resolvedPath, normalized);
}

const storeLock = createAsyncLock();

/** Serialize a load → mutate → save cycle (reads use loadEnterpriseDataEventStore directly). */
export async function withEnterpriseDataEventStoreWriteLock<T>(
  run: (store: EnterpriseDataEventStore) => Promise<T> | T,
  storePath?: string,
): Promise<T> {
  return storeLock(async () => {
    const store = await loadEnterpriseDataEventStore(storePath);
    const result = await run(store);
    await saveEnterpriseDataEventStore(store, storePath);
    return result;
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Event log (append-only, bounded per tenant)
// ─────────────────────────────────────────────────────────────────────────────

/** Keep only the most-recent RETENTION events for a tenant (prune oldest by receivedAt). */
function pruneTenantEvents(store: EnterpriseDataEventStore, tenantId: string): void {
  const tenantEvents = Object.values(store.events).filter((event) => event.tenantId === tenantId);
  if (tenantEvents.length <= ENTERPRISE_DATA_EVENT_RETENTION_PER_TENANT) {
    return;
  }
  const staleFirst = tenantEvents.toSorted((left, right) => {
    const byTime = left.receivedAt.localeCompare(right.receivedAt);
    return byTime !== 0 ? byTime : left.eventId.localeCompare(right.eventId);
  });
  const removeCount = tenantEvents.length - ENTERPRISE_DATA_EVENT_RETENTION_PER_TENANT;
  for (const event of staleFirst.slice(0, removeCount)) {
    delete store.events[event.eventId];
  }
}

export function appendEnterpriseDataEvent(params: {
  store: EnterpriseDataEventStore;
  tenantId: string;
  event: EnterpriseDataEventInput;
  nowIso: string;
}): EnterpriseDataEvent {
  if (!params.event.sourceId?.trim()) {
    throw new EnterpriseDataStoreError(
      "ENTERPRISE_DATA_EVENT_SOURCE_REQUIRED",
      "EnterpriseDataEvent requires a non-empty sourceId.",
    );
  }
  if (!params.event.title?.trim()) {
    throw new EnterpriseDataStoreError(
      "ENTERPRISE_DATA_EVENT_TITLE_REQUIRED",
      "EnterpriseDataEvent requires a non-empty title.",
    );
  }
  const record: EnterpriseDataEvent = {
    ...params.event,
    eventId: randomUUID(),
    tenantId: params.tenantId,
    receivedAt: params.nowIso,
  };
  params.store.events[record.eventId] = record;
  pruneTenantEvents(params.store, params.tenantId);
  return record;
}

export function listEnterpriseDataEvents(params: {
  store: EnterpriseDataEventStore;
  tenantId: string;
  sourceId?: string;
  objectKind?: SemanticObjectKind;
  eventType?: EnterpriseDataEventType;
  limit?: number;
}): EnterpriseDataEvent[] {
  const events = Object.values(params.store.events)
    .filter((event) => {
      if (event.tenantId !== params.tenantId) {
        return false;
      }
      if (params.sourceId && event.sourceId !== params.sourceId) {
        return false;
      }
      if (params.objectKind && event.objectKind !== params.objectKind) {
        return false;
      }
      if (params.eventType && event.eventType !== params.eventType) {
        return false;
      }
      return true;
    })
    // Most-recent first (ties broken by eventId for determinism).
    .toSorted((left, right) => {
      const byTime = right.receivedAt.localeCompare(left.receivedAt);
      return byTime !== 0 ? byTime : right.eventId.localeCompare(left.eventId);
    });
  if (params.limit != null && params.limit >= 0) {
    return events.slice(0, params.limit);
  }
  return events;
}

export function findEnterpriseDataEvent(
  store: EnterpriseDataEventStore,
  tenantId: string,
  eventId: string,
): EnterpriseDataEvent | null {
  const event = store.events[eventId];
  if (!event || event.tenantId !== tenantId) {
    return null;
  }
  return event;
}

export function findEnterpriseDataEventByExternalId(
  store: EnterpriseDataEventStore,
  tenantId: string,
  sourceId: string,
  externalId: string,
): EnterpriseDataEvent | null {
  return (
    Object.values(store.events).find(
      (event) =>
        event.tenantId === tenantId &&
        event.sourceId === sourceId &&
        event.externalId != null &&
        event.externalId === externalId,
    ) ?? null
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Subscriptions (CRUD)
// ─────────────────────────────────────────────────────────────────────────────

export function listEventSubscriptions(params: {
  store: EnterpriseDataEventStore;
  tenantId: string;
  enabled?: boolean;
}): EnterpriseDataEventSubscription[] {
  return Object.values(params.store.subscriptions)
    .filter((subscription) => {
      if (subscription.tenantId !== params.tenantId) {
        return false;
      }
      if (params.enabled != null && subscription.enabled !== params.enabled) {
        return false;
      }
      return true;
    })
    .toSorted((left, right) => left.createdAt.localeCompare(right.createdAt));
}

export function findEventSubscription(
  store: EnterpriseDataEventStore,
  tenantId: string,
  subscriptionId: string,
): EnterpriseDataEventSubscription | null {
  const subscription = store.subscriptions[subscriptionId];
  if (!subscription || subscription.tenantId !== tenantId) {
    return null;
  }
  return subscription;
}

export function upsertEventSubscription(params: {
  store: EnterpriseDataEventStore;
  tenantId: string;
  subscription: EnterpriseDataEventSubscriptionInput;
  nowIso: string;
}): EnterpriseDataEventSubscription {
  if (!params.subscription.targetAgentId?.trim()) {
    throw new EnterpriseDataStoreError(
      "ENTERPRISE_DATA_EVENT_SUBSCRIPTION_TARGET_REQUIRED",
      "EnterpriseDataEventSubscription requires a non-empty targetAgentId.",
    );
  }
  const existing =
    params.subscription.subscriptionId != null
      ? findEventSubscription(params.store, params.tenantId, params.subscription.subscriptionId)
      : null;
  const record: EnterpriseDataEventSubscription = {
    subscriptionId: params.subscription.subscriptionId ?? existing?.subscriptionId ?? randomUUID(),
    tenantId: params.tenantId,
    targetAgentId: params.subscription.targetAgentId,
    sourceId: params.subscription.sourceId,
    objectKind: params.subscription.objectKind,
    eventType: params.subscription.eventType,
    enabled: params.subscription.enabled,
    note: params.subscription.note,
    createdAt: existing?.createdAt ?? params.nowIso,
    updatedAt: params.nowIso,
  };
  params.store.subscriptions[record.subscriptionId] = record;
  return record;
}

export function deleteEventSubscription(params: {
  store: EnterpriseDataEventStore;
  tenantId: string;
  subscriptionId: string;
}): EnterpriseDataEventSubscription {
  const subscription = findEventSubscription(params.store, params.tenantId, params.subscriptionId);
  if (!subscription) {
    throw new EnterpriseDataStoreError(
      "ENTERPRISE_DATA_EVENT_SUBSCRIPTION_NOT_FOUND",
      "EnterpriseDataEventSubscription not found.",
    );
  }
  delete params.store.subscriptions[params.subscriptionId];
  return subscription;
}
