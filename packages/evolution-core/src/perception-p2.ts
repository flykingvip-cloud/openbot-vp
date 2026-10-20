/**
 * Phase P2: read-only observation queue, inspection-trigger catalog, and
 * delivery tiering.
 *
 * The observation queue is the Timeline `observing` bucket. Trigger kinds
 * match `INSPECTION_TRIGGER_KINDS` in `src/diagnosis/inspection.ts`. Dedupe
 * and cooldown classify sightings; they do not run inspection or write
 * signals. Delivery reuses the Da Bai id shape (`dlv:<factId>:<slot>`) as a
 * pure queue projection: major changes are immediate, ordinary changes are
 * weekly. There is no receipt store and no transport.
 *
 * Diagnosis Proposal v1 stays the live write model. Projected timeline items
 * keep `proposalSchema` and `legacy`. `system` items stay on the platform
 * side of the queue.
 *
 * Contract: docs/design/openbot-evolution-perception-execution-plan-2026-09-25.md §5 Phase P2.
 */
import { projectEvolutionTimeline, type EvolutionTimelineListInput } from "./timeline-list.js";
import type { EvolutionTimelineCompleteness, EvolutionTimelineItem } from "./timeline.js";

/** Public P2 operations. All of them classify or project. None of them write. */
export const EVOLUTION_PERCEPTION_P2_OPERATIONS = [
  "projectObservationQueue",
  "classifyEvolutionTriggerSightings",
  "measureEvolutionTriggerCatalog",
  "classifyEvolutionDeliveryTier",
  "projectEvolutionDelivery",
] as const;

export const EVOLUTION_PERCEPTION_P2_ACCESS = "read-only" as const;

/**
 * Same five kinds, same order, as diagnosis inspection triggers and
 * diagnostic signal kinds. This module does not import that package.
 */
export const EVOLUTION_PERCEPTION_TRIGGER_KINDS = [
  "scheduled",
  "event",
  "threshold",
  "trend",
  "verification_triggered",
] as const;
export type EvolutionPerceptionTriggerKind = (typeof EVOLUTION_PERCEPTION_TRIGGER_KINDS)[number];

/** Aligned with `DIAGNOSTIC_SIGNAL_TTL_MS` (fingerprint window). */
export const EVOLUTION_TRIGGER_SIGNAL_TTL_MS = 60 * 60 * 1000;
/** Aligned with `DIAGNOSTIC_SIGNAL_SUPPRESS_MS` (suppress cooldown). */
export const EVOLUTION_TRIGGER_SUPPRESS_MS = 15 * 60 * 1000;

export const EVOLUTION_TRIGGER_DEDUPE_KEY_PARTS = [
  "kind",
  "tenantScope",
  "targetKey",
  "reasonCode",
] as const;

export type EvolutionTriggerCatalogEntry = {
  kind: EvolutionPerceptionTriggerKind;
  /** Same string as `InspectionTrigger["kind"]`. */
  inspectionTriggerKind: EvolutionPerceptionTriggerKind;
  dedupeKeyParts: typeof EVOLUTION_TRIGGER_DEDUPE_KEY_PARTS;
  /**
   * `interval` matches the scheduled tick skip (`now - last < everyMs`).
   * `suppress` matches signal suppression for the other four kinds.
   * Repeats inside the TTL window are deduped after cooldown misses.
   */
  cooldown:
    | { mode: "interval"; field: "everyMs" }
    | { mode: "suppress"; suppressMs: typeof EVOLUTION_TRIGGER_SUPPRESS_MS };
  ttlMs: typeof EVOLUTION_TRIGGER_SIGNAL_TTL_MS;
};

export const EVOLUTION_PERCEPTION_TRIGGER_CATALOG: readonly EvolutionTriggerCatalogEntry[] =
  EVOLUTION_PERCEPTION_TRIGGER_KINDS.map((kind) => ({
    kind,
    inspectionTriggerKind: kind,
    dedupeKeyParts: EVOLUTION_TRIGGER_DEDUPE_KEY_PARTS,
    cooldown:
      kind === "scheduled"
        ? { mode: "interval" as const, field: "everyMs" as const }
        : { mode: "suppress" as const, suppressMs: EVOLUTION_TRIGGER_SUPPRESS_MS },
    ttlMs: EVOLUTION_TRIGGER_SIGNAL_TTL_MS,
  }));

export type EvolutionTriggerSighting = {
  /** Closed catalog. Any other string is omitted. */
  kind: string;
  tenantScope: string | null;
  targetKey: string;
  reasonCode: string;
  observedAt: string;
  /** Signal id, ledger event id, or case id. Blank sightings are omitted. */
  factId: string;
  /** Required for `scheduled`. The tick interval, not a stored clock. */
  everyMs?: number;
  /** Existing suppress-until instant. Cooling uses `>` , same as signal suppression. */
  suppressedUntil?: string;
  proposalSchema?: 1 | 2;
  legacy?: boolean;
};

export type EvolutionTriggerOmitReason =
  | "unknown_kind"
  | "missing_fact_id"
  | "missing_identity"
  | "invalid_time"
  | "missing_interval"
  | "invalid_schema";

export type EvolutionTriggerDisposition = "emit" | "deduped" | "cooled" | "omitted";

export type EvolutionTriggerClassification = {
  access: typeof EVOLUTION_PERCEPTION_P2_ACCESS;
  disposition: EvolutionTriggerDisposition;
  omitReason: EvolutionTriggerOmitReason | null;
  coolReason: "suppressed" | "scheduled_interval" | null;
  dedupeKey: string | null;
  factId: string | null;
  anchorFactId: string | null;
  kind: string;
  proposalSchema: 1 | 2 | null;
  legacy: boolean | null;
};

export type EvolutionTriggerCatalogMeasurement = {
  access: typeof EVOLUTION_PERCEPTION_P2_ACCESS;
  kindCount: number;
  kinds: readonly EvolutionPerceptionTriggerKind[];
  dedupeKeyParts: typeof EVOLUTION_TRIGGER_DEDUPE_KEY_PARTS;
  signalTtlMs: number;
  suppressMs: number;
  scheduledCooldownField: "everyMs";
};

export type EvolutionObservationWindow = {
  from: string;
  to: string;
};

export type EvolutionObservationScope = {
  tenantScope?: string;
  agentId?: string;
  window?: EvolutionObservationWindow;
};

export type EvolutionObservationQueue = {
  access: typeof EVOLUTION_PERCEPTION_P2_ACCESS;
  items: readonly EvolutionTimelineItem[];
  digitalHumanItems: readonly EvolutionTimelineItem[];
  platformItems: readonly EvolutionTimelineItem[];
  completeness: EvolutionTimelineCompleteness;
};

export const EVOLUTION_DELIVERY_TIERS = ["immediate", "weekly"] as const;
export type EvolutionDeliveryTier = (typeof EVOLUTION_DELIVERY_TIERS)[number];

export const EVOLUTION_DELIVERY_REASONS = [
  "rolled_back",
  "ineffective",
  "pending_decision",
  "platform_release",
  "observing",
  "ordinary_change",
] as const;
export type EvolutionDeliveryReason = (typeof EVOLUTION_DELIVERY_REASONS)[number];

export type EvolutionDeliveryClassification =
  | { tier: EvolutionDeliveryTier; reason: EvolutionDeliveryReason }
  | { tier: null; reason: "missing_fact_id" };

export type EvolutionDeliveryProjection = {
  access: typeof EVOLUTION_PERCEPTION_P2_ACCESS;
  /** `dlv:<ledgerEventId>:<tier>`, the Da Bai delivery id shape. */
  deliveryId: string;
  tier: EvolutionDeliveryTier;
  reason: EvolutionDeliveryReason;
  /** Classification label. Nothing is enqueued in a store. */
  status: "queued";
  item: EvolutionTimelineItem;
};

export type EvolutionDeliveryQueue = {
  access: typeof EVOLUTION_PERCEPTION_P2_ACCESS;
  immediate: readonly EvolutionDeliveryProjection[];
  weekly: readonly EvolutionDeliveryProjection[];
  omitted: readonly { ledgerEventId: string; reason: "missing_fact_id" }[];
  dedupedDeliveryIds: readonly string[];
};

type TriggerAnchor = {
  factId: string;
  observedAtMs: number;
};

/**
 * Observing bucket of the Phase P0 timeline, in timeline order.
 * Optional tenant, agent, and inclusive anchor-event window narrow the same
 * bucket. An invalid window yields an empty queue.
 */
export function projectObservationQueue(
  input: EvolutionTimelineListInput,
  scope?: EvolutionObservationScope,
): EvolutionObservationQueue {
  const span = scope?.window ? parseWindow(scope.window) : null;
  if (scope?.window && !span) {
    return emptyObservationQueue();
  }
  const items = projectEvolutionTimeline(input).items.filter((item) => {
    if (item.bucket !== "observing") {
      return false;
    }
    if (scope?.tenantScope && item.impactScope.tenantScope !== scope.tenantScope) {
      return false;
    }
    if (scope?.agentId && !matchesAgent(item, scope.agentId)) {
      return false;
    }
    if (!span) {
      return true;
    }
    const at = anchorMillis(item, input.events);
    return at != null && at >= span.fromMs && at <= span.toMs;
  });
  return {
    access: EVOLUTION_PERCEPTION_P2_ACCESS,
    items,
    digitalHumanItems: items.filter((item) => item.audience === "digital_human"),
    platformItems: items.filter((item) => item.audience === "platform"),
    completeness: completenessOf(items),
  };
}

/** Counts and cooldown modes of the five-kind catalog. Does not fire triggers. */
export function measureEvolutionTriggerCatalog(): EvolutionTriggerCatalogMeasurement {
  return {
    access: EVOLUTION_PERCEPTION_P2_ACCESS,
    kindCount: EVOLUTION_PERCEPTION_TRIGGER_CATALOG.length,
    kinds: EVOLUTION_PERCEPTION_TRIGGER_CATALOG.map((entry) => entry.kind),
    dedupeKeyParts: EVOLUTION_TRIGGER_DEDUPE_KEY_PARTS,
    signalTtlMs: EVOLUTION_TRIGGER_SIGNAL_TTL_MS,
    suppressMs: EVOLUTION_TRIGGER_SUPPRESS_MS,
    scheduledCooldownField: "everyMs",
  };
}

/**
 * Classify sightings in observed-at order.
 * Suppress and scheduled interval cool first. The same dedupe key inside the
 * TTL window is then deduped. A later window emits again.
 */
export function classifyEvolutionTriggerSightings(sightings: readonly EvolutionTriggerSighting[]): {
  access: typeof EVOLUTION_PERCEPTION_P2_ACCESS;
  rows: readonly EvolutionTriggerClassification[];
  counts: Record<EvolutionTriggerDisposition, number>;
} {
  const ordered = sightings.map((sighting, index) => ({ sighting, index }));
  ordered.sort((left, right) => {
    const leftAt = timeOf(left.sighting.observedAt);
    const rightAt = timeOf(right.sighting.observedAt);
    if (leftAt == null && rightAt == null) {
      return left.index - right.index;
    }
    if (leftAt == null) {
      return 1;
    }
    if (rightAt == null) {
      return -1;
    }
    if (leftAt !== rightAt) {
      return leftAt - rightAt;
    }
    const byId = left.sighting.factId.localeCompare(right.sighting.factId);
    return byId === 0 ? left.index - right.index : byId;
  });

  const anchors = new Map<string, TriggerAnchor>();
  const rows: EvolutionTriggerClassification[] = [];
  for (const { sighting } of ordered) {
    const invalid = invalidateSighting(sighting);
    if (invalid) {
      rows.push(classification(sighting, "omitted", invalid, null, null, null));
      continue;
    }
    const observedAtMs = timeOf(sighting.observedAt);
    if (observedAtMs == null) {
      rows.push(classification(sighting, "omitted", "invalid_time", null, null, null));
      continue;
    }
    const dedupeKey = evolutionTriggerDedupeKey(sighting);
    const anchor = anchors.get(dedupeKey);
    const suppressedUntilMs = sighting.suppressedUntil ? timeOf(sighting.suppressedUntil) : null;
    if (suppressedUntilMs != null && suppressedUntilMs > observedAtMs) {
      rows.push(
        classification(sighting, "cooled", null, "suppressed", dedupeKey, anchor?.factId ?? null),
      );
      continue;
    }
    const entry = catalogEntry(sighting.kind);
    if (
      entry?.cooldown.mode === "interval" &&
      anchor &&
      observedAtMs - anchor.observedAtMs < sighting.everyMs!
    ) {
      rows.push(
        classification(sighting, "cooled", null, "scheduled_interval", dedupeKey, anchor.factId),
      );
      continue;
    }
    if (anchor && observedAtMs - anchor.observedAtMs < EVOLUTION_TRIGGER_SIGNAL_TTL_MS) {
      rows.push(classification(sighting, "deduped", null, null, dedupeKey, anchor.factId));
      continue;
    }
    anchors.set(dedupeKey, { factId: sighting.factId.trim(), observedAtMs });
    rows.push(classification(sighting, "emit", null, null, dedupeKey, sighting.factId.trim()));
  }

  const counts: Record<EvolutionTriggerDisposition, number> = {
    emit: 0,
    deduped: 0,
    cooled: 0,
    omitted: 0,
  };
  for (const row of rows) {
    counts[row.disposition] += 1;
  }
  return { access: EVOLUTION_PERCEPTION_P2_ACCESS, rows, counts };
}

/**
 * Major changes are immediate. Ordinary changes, including routine observing
 * rows, wait for the weekly digest. Precedence: rollback, regression, pending
 * decision, platform release, then observing, then everything else.
 * A blank ledger event id is omitted.
 */
export function classifyEvolutionDeliveryTier(
  item: EvolutionTimelineItem,
): EvolutionDeliveryClassification {
  if (item.factIds.ledgerEventId.trim().length === 0) {
    return { tier: null, reason: "missing_fact_id" };
  }
  if (item.bucket === "rolled_back" || item.result === "rolled_back") {
    return { tier: "immediate", reason: "rolled_back" };
  }
  if (item.result === "ineffective") {
    return { tier: "immediate", reason: "ineffective" };
  }
  if (item.bucket === "pending" || item.result === "pending") {
    return { tier: "immediate", reason: "pending_decision" };
  }
  if (item.audience === "platform" && item.executionMode === "platform_release") {
    return { tier: "immediate", reason: "platform_release" };
  }
  if (item.bucket === "observing" || item.result === "observing") {
    return { tier: "weekly", reason: "observing" };
  }
  return { tier: "weekly", reason: "ordinary_change" };
}

/**
 * Queue projection of delivery tiers. The same `dlv:<factId>:<tier>` id is
 * kept once. Items are not copied into a second fact store.
 */
export function projectEvolutionDelivery(
  items: readonly EvolutionTimelineItem[],
): EvolutionDeliveryQueue {
  const immediate: EvolutionDeliveryProjection[] = [];
  const weekly: EvolutionDeliveryProjection[] = [];
  const omitted: { ledgerEventId: string; reason: "missing_fact_id" }[] = [];
  const dedupedDeliveryIds: string[] = [];
  const seen = new Set<string>();
  for (const item of items) {
    const classified = classifyEvolutionDeliveryTier(item);
    if (!classified.tier) {
      omitted.push({ ledgerEventId: item.factIds.ledgerEventId, reason: "missing_fact_id" });
      continue;
    }
    const deliveryId = `dlv:${item.factIds.ledgerEventId.trim()}:${classified.tier}`;
    if (seen.has(deliveryId)) {
      dedupedDeliveryIds.push(deliveryId);
      continue;
    }
    seen.add(deliveryId);
    const projection: EvolutionDeliveryProjection = {
      access: EVOLUTION_PERCEPTION_P2_ACCESS,
      deliveryId,
      tier: classified.tier,
      reason: classified.reason,
      status: "queued",
      item,
    };
    if (classified.tier === "immediate") {
      immediate.push(projection);
    } else {
      weekly.push(projection);
    }
  }
  return {
    access: EVOLUTION_PERCEPTION_P2_ACCESS,
    immediate,
    weekly,
    omitted,
    dedupedDeliveryIds,
  };
}

export function evolutionTriggerDedupeKey(
  sighting: Pick<EvolutionTriggerSighting, "kind" | "tenantScope" | "targetKey" | "reasonCode">,
): string {
  return [
    sighting.kind,
    sighting.tenantScope ?? "local",
    sighting.targetKey.trim(),
    sighting.reasonCode.trim(),
  ].join("|");
}

function catalogEntry(kind: string): EvolutionTriggerCatalogEntry | undefined {
  return EVOLUTION_PERCEPTION_TRIGGER_CATALOG.find((entry) => entry.kind === kind);
}

function invalidateSighting(sighting: EvolutionTriggerSighting): EvolutionTriggerOmitReason | null {
  if (!catalogEntry(sighting.kind)) {
    return "unknown_kind";
  }
  if (sighting.factId.trim().length === 0) {
    return "missing_fact_id";
  }
  if (sighting.targetKey.trim().length === 0 || sighting.reasonCode.trim().length === 0) {
    return "missing_identity";
  }
  if (timeOf(sighting.observedAt) == null) {
    return "invalid_time";
  }
  if (
    typeof sighting.suppressedUntil === "string" &&
    sighting.suppressedUntil.trim().length > 0 &&
    timeOf(sighting.suppressedUntil) == null
  ) {
    return "invalid_time";
  }
  if (
    sighting.kind === "scheduled" &&
    (typeof sighting.everyMs !== "number" ||
      !Number.isFinite(sighting.everyMs) ||
      sighting.everyMs <= 0)
  ) {
    return "missing_interval";
  }
  if (
    sighting.proposalSchema !== undefined &&
    sighting.proposalSchema !== 1 &&
    sighting.proposalSchema !== 2
  ) {
    return "invalid_schema";
  }
  return null;
}

function classification(
  sighting: EvolutionTriggerSighting,
  disposition: EvolutionTriggerDisposition,
  omitReason: EvolutionTriggerOmitReason | null,
  coolReason: "suppressed" | "scheduled_interval" | null,
  dedupeKey: string | null,
  anchorFactId: string | null,
): EvolutionTriggerClassification {
  const schema =
    sighting.proposalSchema === 1 || sighting.proposalSchema === 2 ? sighting.proposalSchema : null;
  return {
    access: EVOLUTION_PERCEPTION_P2_ACCESS,
    disposition,
    omitReason,
    coolReason,
    dedupeKey,
    factId: sighting.factId.trim() || null,
    anchorFactId,
    kind: sighting.kind,
    proposalSchema: schema,
    legacy: typeof sighting.legacy === "boolean" ? sighting.legacy : null,
  };
}

function emptyObservationQueue(): EvolutionObservationQueue {
  return {
    access: EVOLUTION_PERCEPTION_P2_ACCESS,
    items: [],
    digitalHumanItems: [],
    platformItems: [],
    completeness: "empty",
  };
}

function completenessOf(items: readonly EvolutionTimelineItem[]): EvolutionTimelineCompleteness {
  if (items.length === 0) {
    return "empty";
  }
  return items.some((item) => item.completeness === "partial") ? "partial" : "complete";
}

function parseWindow(window: EvolutionObservationWindow): { fromMs: number; toMs: number } | null {
  const fromMs = Date.parse(window.from);
  const toMs = Date.parse(window.to);
  if (!Number.isFinite(fromMs) || !Number.isFinite(toMs) || toMs <= fromMs) {
    return null;
  }
  return { fromMs, toMs };
}

function anchorMillis(
  item: EvolutionTimelineItem,
  events: EvolutionTimelineListInput["events"],
): number | null {
  const id = item.factIds.ledgerEventId.trim();
  if (!id) {
    return null;
  }
  const event = events.find((candidate) => candidate.eventId === id);
  if (!event) {
    return null;
  }
  return timeOf(event.timestamp);
}

function matchesAgent(item: EvolutionTimelineItem, agentId: string): boolean {
  return (
    item.changeObject.target.domain === "agent" && item.changeObject.target.agentId === agentId
  );
}

function timeOf(value: string): number | null {
  const at = Date.parse(value);
  return Number.isFinite(at) ? at : null;
}
