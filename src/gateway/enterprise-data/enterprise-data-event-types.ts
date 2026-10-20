// Enterprise Data Event Bus — shared types.
// Spec: .kiro/specs/enterprise-data-event-bus/{requirements,design}.md
//
// The pull→push half of the data plane: an inbound data-source signal is normalized
// into a canonical EnterpriseDataEvent (Metadata-First — source/object/type/summary,
// NEVER business data rows), matched against tenant subscriptions, and used to trigger
// the relevant agent via the existing agent bridge. Lives in a SEPARATE store file and
// does NOT touch EnterpriseDataStore (mirrors the semantic-object / planner modules).

import type { SemanticObjectKind } from "./semantic-object-types.js";

/** Canonical event verb. `custom` is an escape hatch for source-specific signals. */
export type EnterpriseDataEventType = "created" | "updated" | "deleted" | "custom";

/**
 * A normalized enterprise data event. Metadata-First: it describes WHAT changed
 * (source / canonical object / verb / human summary), never the changed business
 * values. Any sensitive payload is at most represented by a digest.
 */
export type EnterpriseDataEvent = {
  eventId: string;
  tenantId: string;
  /** Originating DataSource (existence validated cross-store by handler/planner, not here). */
  sourceId: string;
  eventType: EnterpriseDataEventType;
  /** Canonical object this event hangs off (reuses the semantic object vocabulary). */
  objectKind?: SemanticObjectKind;
  objectKey?: string;
  /** Source-side record/event id — the idempotency key together with (tenantId, sourceId). */
  externalId?: string;
  title: string;
  /** Human-readable summary. MUST NOT contain sensitive field values. */
  summary?: string;
  /** Optional hash of the source payload, kept for traceability without storing values. */
  payloadDigest?: string;
  /** Source-side occurrence time (ISO), when provided by the source. */
  occurredAt?: string;
  /** Gateway receive time (ISO), always set by the store. */
  receivedAt: string;
};

/**
 * A tenant subscription that routes matching events to a target agent. Match rules
 * are ANDed; an unset rule field is a wildcard. Target is an agentId (the agent to
 * notify) — reuses the inter-agent bridge; seat→agent resolution is a future layer.
 */
export type EnterpriseDataEventSubscription = {
  subscriptionId: string;
  tenantId: string;
  /** Agent to trigger when an event matches (organization-scoped session key). */
  targetAgentId: string;
  /** Match rules (unset = wildcard). */
  sourceId?: string;
  objectKind?: SemanticObjectKind;
  eventType?: EnterpriseDataEventType;
  enabled: boolean;
  note?: string;
  createdAt: string;
  updatedAt: string;
};

/** Independent, versioned store for the event bus (events log + subscriptions). */
export type EnterpriseDataEventStore = {
  version: number;
  events: Record<string, EnterpriseDataEvent>;
  subscriptions: Record<string, EnterpriseDataEventSubscription>;
};

export const ENTERPRISE_DATA_EVENT_STORE_VERSION = 1;

/** Per-tenant cap on the retained event log (oldest pruned on append). */
export const ENTERPRISE_DATA_EVENT_RETENTION_PER_TENANT = 200;
