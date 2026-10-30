// Enterprise Data Event Bus — read + inbound RPCs.
// Spec: .kiro/specs/enterprise-data-event-bus/{design,tasks}.md (Task 7)
//
// Read RPCs (READ scope): events.list / event-subscriptions.list.
// Write RPCs (WRITE scope + in-handler enterprise-admin gate): events.ingest /
// event-subscriptions.upsert / event-subscriptions.delete. Tenant is resolved
// server-side (never client-forged). Kept in a dedicated file (not the enterprise-data.ts
// core / m6) to avoid attribution conflicts on owned/shared files.

import { createAsyncLock } from "../../infra/json-files.js";
import { EnterpriseDataStoreError } from "../enterprise-data/connector-action-store.js";
import {
  dispatchEnterpriseDataEvent,
  matchSubscriptions,
  recordEnterpriseDataEvent,
  type RawEnterpriseDataSignal,
  type TriggerAgentFn,
  defaultTriggerAgent,
} from "../enterprise-data/enterprise-data-event-bus.js";
import {
  deleteEventSubscription,
  type EnterpriseDataEventSubscriptionInput,
  listEnterpriseDataEvents,
  listEventSubscriptions,
  loadEnterpriseDataEventStore,
  upsertEventSubscription,
  withEnterpriseDataEventStoreWriteLock,
} from "../enterprise-data/enterprise-data-event-store.js";
import type {
  EnterpriseDataEventStore,
  EnterpriseDataEventType,
} from "../enterprise-data/enterprise-data-event-types.js";
import { requireResolvedEnterpriseAdminTenantId } from "../enterprise-data/enterprise-data-seat-context.js";
import {
  runEventDrivenProjectionsForEvent,
  type EventDrivenMaterializationResult,
} from "../enterprise-data/event-driven-projection-materializer.js";
import type { SemanticObjectKind } from "../enterprise-data/semantic-object-types.js";
import { loadEnterpriseDataStore, saveEnterpriseDataStore } from "../enterprise-data/store.js";
import type { EnterpriseDataStore } from "../enterprise-data/types.js";
import { resolveControlPlaneStorePathForClient } from "../tenant-context.js";
import { TENANT_ENTERPRISE_DATA_FILE } from "../tenant-store-paths.js";
import { respondInvalid, respondUnavailable, stringValue } from "./billing-helpers.js";
import type { GatewayClient, GatewayRequestHandlers } from "./types.js";

const EVENT_TYPES: ReadonlySet<EnterpriseDataEventType> = new Set([
  "created",
  "updated",
  "deleted",
  "custom",
]);

type WithDataStoreContext = {
  client: GatewayClient | null | undefined;
  tenantId: string;
};

type WithDataStoreRunner = <T>(
  ctx: WithDataStoreContext,
  run: (store: EnterpriseDataStore) => Promise<T> | T,
) => Promise<T>;

/** Distinguishes store I/O failure from empty materialization (no matching bindings). */
class EventDrivenStoreAccessError extends Error {
  readonly stage: "load" | "save";
  readonly partialResult?: EventDrivenMaterializationResult;

  constructor(
    stage: "load" | "save",
    cause: unknown,
    partialResult?: EventDrivenMaterializationResult,
  ) {
    // Public message stays non-sensitive (no paths / store contents).
    super(
      stage === "load" ? "enterprise data store load failed" : "enterprise data store save failed",
    );
    this.name = "EventDrivenStoreAccessError";
    this.stage = stage;
    this.partialResult = partialResult;
    this.cause = cause;
  }
}

const defaultDataStoreLock = createAsyncLock();

function materializationStoreFailure(params: {
  stage: "load" | "run" | "save";
  partial?: EventDrivenMaterializationResult;
}): EventDrivenMaterializationResult {
  const errorCode =
    params.stage === "load"
      ? "store_load_failed"
      : params.stage === "save"
        ? "store_save_failed"
        : "materialization_failed";
  const partial = params.partial;
  if (params.stage === "save" && partial) {
    // In-memory attempts may have succeeded, but nothing was persisted.
    return {
      attempted: partial.attempted,
      succeeded: 0,
      failed: Math.max(1, partial.failed, partial.attempted),
      skipped: partial.skipped,
      attempts: partial.attempts.map((attempt) =>
        attempt.status === "succeeded"
          ? {
              ...attempt,
              status: "failed" as const,
              error: "store_save_failed",
              result: undefined,
            }
          : attempt,
      ),
      stage: "save",
      errorCode,
      retryHint: "deduped_external_id_will_not_rematerialize",
    };
  }
  return {
    attempted: partial?.attempted ?? 0,
    succeeded: 0,
    failed: Math.max(1, partial?.failed ?? 0),
    skipped: partial?.skipped ?? 0,
    attempts: partial?.attempts ?? [],
    stage: params.stage,
    errorCode,
    retryHint: "deduped_external_id_will_not_rematerialize",
  };
}

const SEMANTIC_OBJECT_KINDS: ReadonlySet<SemanticObjectKind> = new Set([
  "customer",
  "order",
  "product",
  "inventory",
  "employee",
  "contract",
  "invoice",
  "custom",
]);

function eventTypeParam(params: Record<string, unknown>): EnterpriseDataEventType | undefined {
  const raw = stringValue(params.eventType);
  return raw && EVENT_TYPES.has(raw as EnterpriseDataEventType)
    ? (raw as EnterpriseDataEventType)
    : undefined;
}

function objectKindParam(params: Record<string, unknown>): SemanticObjectKind | undefined {
  const raw = stringValue(params.objectKind);
  return raw && SEMANTIC_OBJECT_KINDS.has(raw as SemanticObjectKind)
    ? (raw as SemanticObjectKind)
    : undefined;
}

function respondEnterpriseError(
  respond: Parameters<GatewayRequestHandlers[string]>[0]["respond"],
  error: unknown,
): void {
  if (error instanceof EnterpriseDataStoreError) {
    respondInvalid(respond, error.message);
    return;
  }
  respondUnavailable(respond, error);
}

/**
 * @param deps.loadStore Injectable read loader (tests); defaults to on-disk store.
 * @param deps.withStore Injectable write-lock runner (tests); defaults to the store write lock.
 * @param deps.triggerAgent Injectable agent trigger (tests); defaults to the callGateway bridge.
 * @param deps.now Injectable clock (tests).
 */
export function createEnterpriseDataEventHandlers(deps?: {
  loadStore?: () => Promise<EnterpriseDataEventStore>;
  withStore?: <T>(run: (store: EnterpriseDataEventStore) => Promise<T> | T) => Promise<T>;
  triggerAgent?: TriggerAgentFn;
  now?: () => string;
  /**
   * Optional: load/save enterprise data store for event_driven projection
   * materialization. Must use the same trusted tenant control-plane locator as
   * projection binding APIs (`resolveControlPlaneStorePathForClient` +
   * `TENANT_ENTERPRISE_DATA_FILE`).
   */
  withDataStore?: WithDataStoreRunner;
}): GatewayRequestHandlers {
  const loadStore = deps?.loadStore ?? (() => loadEnterpriseDataEventStore());
  const withStore =
    deps?.withStore ??
    (<T>(run: (store: EnterpriseDataEventStore) => Promise<T> | T) =>
      withEnterpriseDataEventStoreWriteLock(run));
  const withDataStore: WithDataStoreRunner =
    deps?.withDataStore ??
    (async <_T>(ctx, run) => {
      // Same trusted locator as enterprise-data.ts withEnterpriseDataStore.
      const storePath = await resolveControlPlaneStorePathForClient(
        ctx.client ?? null,
        TENANT_ENTERPRISE_DATA_FILE,
      );
      // Serialize read-modify-save for parallel ingest against the same store
      // (mirrors event-store write lock; binding API RMW is unchanged).
      return defaultDataStoreLock(async () => {
        let store: EnterpriseDataStore;
        try {
          store = await loadEnterpriseDataStore(storePath);
        } catch (error) {
          throw new EventDrivenStoreAccessError("load", error);
        }
        const result = await run(store);
        try {
          await saveEnterpriseDataStore(store, storePath);
        } catch (error) {
          const partial =
            result &&
            typeof result === "object" &&
            "attempted" in result &&
            "failed" in result &&
            "attempts" in result
              ? (result as EventDrivenMaterializationResult)
              : undefined;
          throw new EventDrivenStoreAccessError("save", error, partial);
        }
        return result;
      });
    });
  const triggerAgent = deps?.triggerAgent ?? defaultTriggerAgent;
  const now = deps?.now ?? (() => new Date().toISOString());

  return {
    "enterprise-data.events.list": async ({ client, params, respond }) => {
      const tenantId = await requireResolvedEnterpriseAdminTenantId({ client, params, respond });
      if (!tenantId) {
        return;
      }
      try {
        const store = await loadStore();
        const events = listEnterpriseDataEvents({
          store,
          tenantId,
          sourceId: stringValue(params.sourceId) || undefined,
          objectKind: objectKindParam(params),
          eventType: eventTypeParam(params),
          limit: typeof params.limit === "number" ? params.limit : undefined,
        });
        respond(true, { tenantId, events });
      } catch (error) {
        respondUnavailable(respond, error);
      }
    },

    "enterprise-data.event-subscriptions.list": async ({ client, params, respond }) => {
      const tenantId = await requireResolvedEnterpriseAdminTenantId({ client, params, respond });
      if (!tenantId) {
        return;
      }
      try {
        const store = await loadStore();
        const subscriptions = listEventSubscriptions({
          store,
          tenantId,
          enabled: typeof params.enabled === "boolean" ? params.enabled : undefined,
        });
        respond(true, { tenantId, subscriptions });
      } catch (error) {
        respondUnavailable(respond, error);
      }
    },

    "enterprise-data.events.ingest": async ({ client, params, respond }) => {
      const tenantId = await requireResolvedEnterpriseAdminTenantId({ client, params, respond });
      if (!tenantId) {
        return;
      }
      if (!stringValue(params.sourceId)) {
        respondInvalid(respond, "sourceId is required");
        return;
      }
      const signal: RawEnterpriseDataSignal = {
        sourceId: stringValue(params.sourceId) || undefined,
        eventType: stringValue(params.eventType) || undefined,
        objectKind: stringValue(params.objectKind) || undefined,
        objectKey: stringValue(params.objectKey) || undefined,
        externalId: stringValue(params.externalId) || undefined,
        title: stringValue(params.title) || undefined,
        summary: stringValue(params.summary) || undefined,
        payloadDigest: stringValue(params.payloadDigest) || undefined,
        occurredAt: stringValue(params.occurredAt) || undefined,
      };
      try {
        const nowIso = now();
        // Step 1 (write lock): normalize + dedupe + append + snapshot enabled subscriptions.
        const recorded = await withStore((store) => {
          const result = recordEnterpriseDataEvent({ store, tenantId, signal, nowIso });
          const subscriptions = result.deduped
            ? []
            : matchSubscriptions(
                result.event,
                listEventSubscriptions({ store, tenantId, enabled: true }),
              );
          return { ...result, subscriptions };
        });
        // Step 2 (no lock held): trigger agents for matched subscriptions.
        const dispatch = recorded.deduped
          ? { matched: 0, deliveries: [] }
          : await dispatchEnterpriseDataEvent({
              event: recorded.event,
              subscriptions: recorded.subscriptions,
              triggerAgent,
            });
        // Step 3: minimal event_driven projection materialization (skip deduped).
        // Ingest ack stays ok; materialization must surface load/save/run failures
        // (not all-zero stats) because externalId dedupe blocks silent resend recovery.
        let materialization: EventDrivenMaterializationResult | undefined;
        if (!recorded.deduped) {
          try {
            materialization = await withDataStore({ client, tenantId }, (dataStore) =>
              runEventDrivenProjectionsForEvent({
                store: dataStore,
                tenantId,
                event: recorded.event,
                nowIso,
              }),
            );
          } catch (error) {
            if (error instanceof EventDrivenStoreAccessError) {
              materialization = materializationStoreFailure({
                stage: error.stage,
                partial: error.partialResult,
              });
            } else {
              materialization = materializationStoreFailure({ stage: "run" });
            }
          }
        }
        respond(true, {
          tenantId,
          event: recorded.event,
          deduped: recorded.deduped,
          dispatch,
          ...(materialization ? { materialization } : {}),
        });
      } catch (error) {
        respondEnterpriseError(respond, error);
      }
    },

    "enterprise-data.event-subscriptions.upsert": async ({ client, params, respond }) => {
      const tenantId = await requireResolvedEnterpriseAdminTenantId({ client, params, respond });
      if (!tenantId) {
        return;
      }
      const targetAgentId = stringValue(params.targetAgentId);
      if (!targetAgentId) {
        respondInvalid(respond, "targetAgentId is required");
        return;
      }
      const subscription: EnterpriseDataEventSubscriptionInput = {
        subscriptionId: stringValue(params.subscriptionId) || undefined,
        targetAgentId,
        sourceId: stringValue(params.sourceId) || undefined,
        objectKind: objectKindParam(params),
        eventType: eventTypeParam(params),
        enabled: params.enabled !== false,
        note: stringValue(params.note) || undefined,
      };
      try {
        const nowIso = now();
        const result = await withStore((store) =>
          upsertEventSubscription({ store, tenantId, subscription, nowIso }),
        );
        respond(true, { tenantId, subscription: result });
      } catch (error) {
        respondEnterpriseError(respond, error);
      }
    },

    "enterprise-data.event-subscriptions.delete": async ({ client, params, respond }) => {
      const tenantId = await requireResolvedEnterpriseAdminTenantId({ client, params, respond });
      if (!tenantId) {
        return;
      }
      const subscriptionId = stringValue(params.subscriptionId);
      if (!subscriptionId) {
        respondInvalid(respond, "subscriptionId is required");
        return;
      }
      try {
        const result = await withStore((store) =>
          deleteEventSubscription({ store, tenantId, subscriptionId }),
        );
        respond(true, { tenantId, subscription: result });
      } catch (error) {
        respondEnterpriseError(respond, error);
      }
    },
  };
}
