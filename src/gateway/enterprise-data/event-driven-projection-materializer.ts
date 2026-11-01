/**
 * P1-F minimal event-driven projection materialization.
 *
 * Honest scope: when an enterprise-data event is recorded (not deduped), enabled
 * `event_driven` bindings whose projection source matches the event `sourceId`
 * are materialized via the same `runProjectionMaterialization` path as
 * on_demand/scheduled. This is NOT a claim of complete knowledge-base goals:
 * durable restart queues, ordered multi-consumer replay, and production rate
 * limiting beyond a per-event bound are out of scope. Demo→prod isolation and
 * real source auth remain the existing SAR/materializer gates.
 */

import { getProcessControlledSarProvider } from "./controlled-sar-provider.js";
import { findDataCapability } from "./data-capability-store.js";
import type { EnterpriseDataEvent } from "./enterprise-data-event-types.js";
import { listEnterpriseKnowledgeProjectionBindings } from "./enterprise-knowledge-projection-binding-store.js";
import { isImplementedMaterializationMode, projectionSourceId } from "./knowledge-publication.js";
import {
  runProjectionMaterialization,
  type ProjectionMaterializationResult,
} from "./projection-materializer.js";
import { findEnterpriseKnowledgeProjectionSpec } from "./projection-spec-store.js";
import type { SarGovernanceProvider } from "./sar-governance-bridge.js";
import type { EnterpriseDataStore } from "./types.js";

const MAX_EVENT_DRIVEN_PER_EVENT = 5;

export type EventDrivenMaterializationAttempt = {
  bindingId: string;
  projectionId: string;
  status: "succeeded" | "failed" | "skipped";
  error?: string;
  result?: ProjectionMaterializationResult;
};

export type EventDrivenMaterializationStage = "load" | "run" | "save";

export type EventDrivenMaterializationErrorCode =
  | "store_load_failed"
  | "store_save_failed"
  | "materialization_failed";

export type EventDrivenMaterializationResult = {
  attempted: number;
  succeeded: number;
  failed: number;
  skipped: number;
  attempts: EventDrivenMaterializationAttempt[];
  /**
   * Present when store I/O or an unexpected runner failure prevented honest
   * materialization. Distinguishes "no matching bindings" (all zeros, no stage)
   * from load/save/run failures. Save failure never reports persisted success.
   */
  stage?: EventDrivenMaterializationStage;
  errorCode?: EventDrivenMaterializationErrorCode;
  /**
   * Stable hint: ingest already recorded + deduped by externalId, so resending
   * the same externalId will not rematerialize. Recovery is
   * `enterprise-data.events.rematerialize` by eventId (not externalId resend).
   * Not a claim of ordered durable restart queue / multi-consumer replay.
   */
  retryHint?: "deduped_external_id_will_not_rematerialize";
};

function bindingMatchesEventSource(params: {
  store: EnterpriseDataStore;
  tenantId: string;
  projectionId: string;
  sourceId: string;
}): boolean {
  const spec = findEnterpriseKnowledgeProjectionSpec(
    params.store,
    params.tenantId,
    params.projectionId,
  );
  if (!spec || spec.lifecycle !== "active") {
    return false;
  }
  const explicit = projectionSourceId(spec);
  if (explicit) {
    return explicit === params.sourceId;
  }
  if (!spec.capabilityId) {
    return false;
  }
  const capability = findDataCapability(params.store, params.tenantId, spec.capabilityId);
  if (!capability) {
    return false;
  }
  return capability.sourceIds.includes(params.sourceId);
}

/**
 * Materialize enabled event_driven bindings matching the event source.
 * Call only for non-deduped ingest results; idempotency relies on event-store
 * externalId dedupe upstream (same externalId does not re-enter here).
 */
export async function runEventDrivenProjectionsForEvent(params: {
  store: EnterpriseDataStore;
  tenantId: string;
  event: Pick<EnterpriseDataEvent, "eventId" | "sourceId" | "tenantId">;
  nowIso: string;
  /** Cap attempts per event (default 5). */
  maxPerEvent?: number;
  sarProvider?: SarGovernanceProvider;
}): Promise<EventDrivenMaterializationResult> {
  const tenantId = params.tenantId.trim();
  const sourceId = params.event.sourceId.trim();
  const empty: EventDrivenMaterializationResult = {
    attempted: 0,
    succeeded: 0,
    failed: 0,
    skipped: 0,
    attempts: [],
  };
  if (!tenantId || !sourceId || params.event.tenantId !== tenantId) {
    return empty;
  }
  if (!isImplementedMaterializationMode("event_driven")) {
    return empty;
  }

  const max = params.maxPerEvent ?? MAX_EVENT_DRIVEN_PER_EVENT;
  const bindings = listEnterpriseKnowledgeProjectionBindings({
    store: params.store,
    tenantId,
    enabled: true,
  }).filter(
    (binding) =>
      binding.materializationMode === "event_driven" &&
      isImplementedMaterializationMode(binding.materializationMode),
  );

  const attempts: EventDrivenMaterializationAttempt[] = [];
  let attempted = 0;
  let succeeded = 0;
  let failed = 0;
  let skipped = 0;

  for (const binding of bindings) {
    if (attempted >= max) {
      skipped += 1;
      attempts.push({
        bindingId: binding.bindingId,
        projectionId: binding.projectionId,
        status: "skipped",
        error: "max_per_event",
      });
      continue;
    }
    if (
      !bindingMatchesEventSource({
        store: params.store,
        tenantId,
        projectionId: binding.projectionId,
        sourceId,
      })
    ) {
      continue;
    }
    attempted += 1;
    try {
      const result = await runProjectionMaterialization({
        store: params.store,
        tenantId,
        bindingId: binding.bindingId,
        nowIso: params.nowIso,
        sarProvider: params.sarProvider ?? getProcessControlledSarProvider(),
        input: {
          enterpriseDataEventId: params.event.eventId,
          enterpriseDataEventSourceId: sourceId,
        },
      });
      succeeded += 1;
      attempts.push({
        bindingId: binding.bindingId,
        projectionId: binding.projectionId,
        status: "succeeded",
        result,
      });
    } catch (error) {
      failed += 1;
      attempts.push({
        bindingId: binding.bindingId,
        projectionId: binding.projectionId,
        status: "failed",
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return { attempted, succeeded, failed, skipped, attempts };
}
