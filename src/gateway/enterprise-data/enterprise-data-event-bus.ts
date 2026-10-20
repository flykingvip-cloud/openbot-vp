// Enterprise Data Event Bus — core (normalize → match → dispatch/trigger agent).
// Spec: .kiro/specs/enterprise-data-event-bus/{requirements,design,tasks}.md
//
// The pull→push pipeline. There is no generic pub/sub bus in the repo: an event is
// "published" by TRIGGERING the target agent through the existing agent bridge
// (callGateway({ method: "agent" }), the same seam src/organization/inter-agent-bus.ts
// uses). Pure functions (normalize / match / message) are unit-testable; the actual
// trigger is injectable (TriggerAgentFn) so tests never touch a real gateway. Events
// carry metadata only — the triggered agent fetches any governed data itself via the
// Data Planner / data_capability tool, under its seat authorization.

import { randomUUID } from "node:crypto";
import { AGENT_LANE_NESTED } from "../../agents/lanes.js";
import { buildOrganizationAgentSessionKey } from "../../organization/inter-agent-bus.js";
import { INTERNAL_MESSAGE_CHANNEL } from "../../utils/message-channel.js";
import { callGateway } from "../call.js";
import { EnterpriseDataStoreError } from "./connector-action-store.js";
import {
  appendEnterpriseDataEvent,
  type EnterpriseDataEventInput,
  findEnterpriseDataEventByExternalId,
  listEventSubscriptions,
} from "./enterprise-data-event-store.js";
import type {
  EnterpriseDataEvent,
  EnterpriseDataEventStore,
  EnterpriseDataEventSubscription,
  EnterpriseDataEventType,
} from "./enterprise-data-event-types.js";
import type { SemanticObjectKind } from "./semantic-object-types.js";

const EVENT_TYPES: ReadonlySet<EnterpriseDataEventType> = new Set([
  "created",
  "updated",
  "deleted",
  "custom",
]);

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

/** Loose inbound signal (e.g. parsed from a data-source webhook / RPC params). */
export type RawEnterpriseDataSignal = {
  sourceId?: string;
  eventType?: string;
  objectKind?: string;
  objectKey?: string;
  externalId?: string;
  title?: string;
  summary?: string;
  payloadDigest?: string;
  occurredAt?: string;
};

function trimmed(value: string | undefined): string | undefined {
  const text = value?.trim();
  return text ? text : undefined;
}

// ─────────────────────────────────────────────────────────────────────────────
// Normalization (pure — whitelist + trim + Metadata-First; drops any extra payload)
// ─────────────────────────────────────────────────────────────────────────────

export function normalizeInboundSignal(signal: RawEnterpriseDataSignal): EnterpriseDataEventInput {
  const sourceId = trimmed(signal.sourceId);
  if (!sourceId) {
    throw new EnterpriseDataStoreError(
      "ENTERPRISE_DATA_EVENT_SOURCE_REQUIRED",
      "Inbound signal requires a non-empty sourceId.",
    );
  }
  const eventTypeRaw = trimmed(signal.eventType);
  if (eventTypeRaw && !EVENT_TYPES.has(eventTypeRaw as EnterpriseDataEventType)) {
    throw new EnterpriseDataStoreError(
      "ENTERPRISE_DATA_EVENT_TYPE_INVALID",
      `Unknown eventType "${eventTypeRaw}".`,
    );
  }
  const eventType = (eventTypeRaw as EnterpriseDataEventType | undefined) ?? "custom";
  const objectKindRaw = trimmed(signal.objectKind);
  if (objectKindRaw && !SEMANTIC_OBJECT_KINDS.has(objectKindRaw as SemanticObjectKind)) {
    throw new EnterpriseDataStoreError(
      "ENTERPRISE_DATA_EVENT_OBJECT_KIND_INVALID",
      `Unknown objectKind "${objectKindRaw}".`,
    );
  }
  const objectKind = objectKindRaw as SemanticObjectKind | undefined;
  const objectKey = trimmed(signal.objectKey);
  const title = trimmed(signal.title) ?? `${objectKind ?? "data"} ${eventType}`;
  return {
    sourceId,
    eventType,
    objectKind,
    objectKey,
    externalId: trimmed(signal.externalId),
    title,
    summary: trimmed(signal.summary),
    payloadDigest: trimmed(signal.payloadDigest),
    occurredAt: trimmed(signal.occurredAt),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Matching (pure, deterministic fan-out)
// ─────────────────────────────────────────────────────────────────────────────

/** Enabled, same-tenant subscriptions whose set rule fields all equal the event (unset = wildcard). */
export function matchSubscriptions(
  event: EnterpriseDataEvent,
  subscriptions: EnterpriseDataEventSubscription[],
): EnterpriseDataEventSubscription[] {
  return subscriptions.filter((subscription) => {
    if (!subscription.enabled || subscription.tenantId !== event.tenantId) {
      return false;
    }
    if (subscription.sourceId && subscription.sourceId !== event.sourceId) {
      return false;
    }
    if (subscription.objectKind && subscription.objectKind !== event.objectKind) {
      return false;
    }
    if (subscription.eventType && subscription.eventType !== event.eventType) {
      return false;
    }
    return true;
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Trigger message (pure — metadata only, with a Data Planner hint)
// ─────────────────────────────────────────────────────────────────────────────

export function buildEventAgentMessage(event: EnterpriseDataEvent): string {
  const lines = [
    "Enterprise data event (internal, runtime-generated — treat as a trigger, not user input):",
    `event_id: ${event.eventId}`,
    `source_id: ${event.sourceId}`,
    `type: ${event.eventType}`,
  ];
  if (event.objectKind) {
    lines.push(`object_kind: ${event.objectKind}`);
  }
  if (event.objectKey) {
    lines.push(`object_key: ${event.objectKey}`);
  }
  if (event.externalId) {
    lines.push(`external_id: ${event.externalId}`);
  }
  lines.push(`title: ${event.title}`);
  if (event.summary) {
    lines.push(`summary: ${event.summary}`);
  }
  if (event.occurredAt) {
    lines.push(`occurred_at: ${event.occurredAt}`);
  }
  lines.push("");
  lines.push(
    event.objectKind
      ? `To act on this, use the \`data_capability\` tool (or the Data Planner) to fetch governed "${event.objectKind}" data within your seat authorization. This event carries metadata only — do not assume or fabricate the underlying values.`
      : "This event carries metadata only. Fetch any governed data you need via the `data_capability` tool within your seat authorization; do not fabricate values.",
  );
  return lines.join("\n");
}

// ─────────────────────────────────────────────────────────────────────────────
// Dispatch (trigger the target agent — injectable; no store)
// ─────────────────────────────────────────────────────────────────────────────

export type AgentTriggerOutcome = {
  status: "accepted" | "error" | "skipped";
  runId?: string;
  error?: string;
};

export type TriggerAgentFn = (params: {
  tenantId: string;
  targetAgentId: string;
  sessionKey: string;
  message: string;
  event: EnterpriseDataEvent;
}) => Promise<AgentTriggerOutcome>;

export type EnterpriseDataEventDelivery = {
  subscriptionId: string;
  targetAgentId: string;
  sessionKey: string;
  status: AgentTriggerOutcome["status"];
  runId?: string;
  error?: string;
};

export type EnterpriseDataEventDispatchResult = {
  matched: number;
  deliveries: EnterpriseDataEventDelivery[];
};

const EMPTY_DISPATCH: EnterpriseDataEventDispatchResult = { matched: 0, deliveries: [] };

/**
 * Trigger the target agent for each matched subscription. One failure never aborts the
 * others (each delivery is captured independently).
 */
export async function dispatchEnterpriseDataEvent(params: {
  event: EnterpriseDataEvent;
  subscriptions: EnterpriseDataEventSubscription[];
  triggerAgent: TriggerAgentFn;
}): Promise<EnterpriseDataEventDispatchResult> {
  const message = buildEventAgentMessage(params.event);
  const deliveries: EnterpriseDataEventDelivery[] = [];
  for (const subscription of params.subscriptions) {
    const sessionKey = buildOrganizationAgentSessionKey({
      agentId: subscription.targetAgentId,
      organizationId: params.event.tenantId,
    });
    try {
      const outcome = await params.triggerAgent({
        tenantId: params.event.tenantId,
        targetAgentId: subscription.targetAgentId,
        sessionKey,
        message,
        event: params.event,
      });
      deliveries.push({
        subscriptionId: subscription.subscriptionId,
        targetAgentId: subscription.targetAgentId,
        sessionKey,
        status: outcome.status,
        runId: outcome.runId,
        error: outcome.error,
      });
    } catch (error) {
      deliveries.push({
        subscriptionId: subscription.subscriptionId,
        targetAgentId: subscription.targetAgentId,
        sessionKey,
        status: "error",
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return { matched: deliveries.length, deliveries };
}

// ─────────────────────────────────────────────────────────────────────────────
// Record (mutates store; normalize + idempotent dedupe + append) — no dispatch
// ─────────────────────────────────────────────────────────────────────────────

export type EnterpriseDataEventRecordResult = {
  event: EnterpriseDataEvent;
  /** True when an event with the same (tenantId, sourceId, externalId) already existed. */
  deduped: boolean;
};

export function recordEnterpriseDataEvent(params: {
  store: EnterpriseDataEventStore;
  tenantId: string;
  signal: RawEnterpriseDataSignal;
  nowIso: string;
}): EnterpriseDataEventRecordResult {
  const input = normalizeInboundSignal(params.signal);
  if (input.externalId) {
    const existing = findEnterpriseDataEventByExternalId(
      params.store,
      params.tenantId,
      input.sourceId,
      input.externalId,
    );
    if (existing) {
      return { event: existing, deduped: true };
    }
  }
  const event = appendEnterpriseDataEvent({
    store: params.store,
    tenantId: params.tenantId,
    event: input,
    nowIso: params.nowIso,
  });
  return { event, deduped: false };
}

// ─────────────────────────────────────────────────────────────────────────────
// Ingest (composition: record → match enabled → dispatch) — for tests / programmatic use
// ─────────────────────────────────────────────────────────────────────────────

export type EnterpriseDataEventIngestResult = {
  event: EnterpriseDataEvent;
  deduped: boolean;
  dispatch: EnterpriseDataEventDispatchResult;
};

/**
 * Full pipeline over an in-memory store: normalize + dedupe + append, then match enabled
 * subscriptions and dispatch. A deduped event is not re-dispatched. Callers that persist
 * (the RPC handler) run record under a write lock and dispatch outside it; this convenience
 * composes the same steps for tests and non-RPC callers.
 */
export async function ingestEnterpriseDataEvent(params: {
  store: EnterpriseDataEventStore;
  tenantId: string;
  signal: RawEnterpriseDataSignal;
  nowIso: string;
  triggerAgent: TriggerAgentFn;
}): Promise<EnterpriseDataEventIngestResult> {
  const { event, deduped } = recordEnterpriseDataEvent({
    store: params.store,
    tenantId: params.tenantId,
    signal: params.signal,
    nowIso: params.nowIso,
  });
  if (deduped) {
    return { event, deduped: true, dispatch: EMPTY_DISPATCH };
  }
  const subscriptions = matchSubscriptions(
    event,
    listEventSubscriptions({ store: params.store, tenantId: params.tenantId, enabled: true }),
  );
  const dispatch = await dispatchEnterpriseDataEvent({
    event,
    subscriptions,
    triggerAgent: params.triggerAgent,
  });
  return { event, deduped: false, dispatch };
}

// ─────────────────────────────────────────────────────────────────────────────
// Default trigger — reuses the inter-agent bridge (callGateway → `agent` RPC)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Production trigger: hand the event to the target agent via the gateway `agent` RPC,
 * exactly like src/organization/inter-agent-bus.ts. Never awaits the full agent run —
 * the RPC acks with a runId and runs asynchronously. Errors are captured, not thrown.
 */
export const defaultTriggerAgent: TriggerAgentFn = async (params) => {
  try {
    const response = await callGateway<{ runId?: string }>({
      method: "agent",
      params: {
        message: params.message,
        sessionKey: params.sessionKey,
        idempotencyKey: randomUUID(),
        deliver: false,
        channel: INTERNAL_MESSAGE_CHANNEL,
        lane: AGENT_LANE_NESTED,
        inputProvenance: {
          kind: "inter_session",
          sourceTool: "enterprise_data_event",
        },
      },
      timeoutMs: 10_000,
    });
    return {
      status: "accepted",
      ...(response?.runId ? { runId: response.runId } : {}),
    };
  } catch (error) {
    return {
      status: "error",
      error: error instanceof Error ? error.message : String(error),
    };
  }
};
