/**
 * Compacts the billing delivery log before it is rewritten.
 *
 * The log is a delivery queue, not the usage ledger. Estimated snapshots are
 * recomputed from usage records; replaying this file must not be required to
 * rebuild them. On each write:
 * - drop events that already delivered (status done);
 * - drop failed events once they are 24 hours old;
 * - fold one knowledge-governance gov-llm invocation (call, tokens, and
 *   per-knowledge-base records) into a single event that keeps the call,
 *   usage, and delivery outcome.
 *
 * `seq` stays monotonic. Delivered usage.reported ids are remembered for 24
 * hours so a crash retry does not run consumers again after the row is gone.
 */

import type {
  BillingDomainEvent,
  DurableEvent,
  DurableEventStatus,
  UsageReportedEvent,
} from "./types.js";

/**
 * One knowledge-governance gov-llm invocation kept in the delivery log.
 * Usage snapshots do not read this; they come from the usage ledger.
 */
export type GovernanceLlmInvocationSummary = {
  callId: string;
  knowledgeBaseIds: string[];
  /** Meter `knowledge_governance_llm_call` quantity kept from split rows. */
  callQuantity: number;
  /** Meter `knowledge_governance_llm_tokens` quantity kept from split rows. */
  tokenQuantity: number;
  /** Per-knowledge-base gov-llm credit rows (`credit:gov-llm:` / `gov-llm:`). */
  creditQuantity: number;
  /** Split event ids folded into this invocation, for delivery idempotency. */
  sourceEventIds: string[];
};

type UsageReportedWithGovernance = UsageReportedEvent & {
  governanceLlm?: GovernanceLlmInvocationSummary;
};

export const BILLING_FAILED_EVENT_RETENTION_MS = 24 * 60 * 60 * 1000;

export type DeliveredUsageKey = {
  enterpriseId: string;
  eventId: string;
  at: string;
};

export type CompactBillingEventLogResult = {
  events: DurableEvent[];
  deliveredUsage: DeliveredUsageKey[];
  changed: boolean;
};

type GovLlmKind = "invocation" | "call" | "tokens" | "kb";

type GovLlmPart = {
  kind: GovLlmKind;
  callId: string;
  kbId: string;
};

const GOV_LLM_INVOCATION_PREFIX = "gov-llm:invocation:";
const GOV_LLM_CALL_PREFIX = "gov-llm:call:";
const GOV_LLM_TOKENS_PREFIX = "gov-llm:tokens:";
const GOV_LLM_CREDIT_PREFIX = "credit:gov-llm:";
const GOV_LLM_KB_PREFIX = "gov-llm:";

function failedEventExpired(recordedAt: string, nowMs: number): boolean {
  const recordedMs = Date.parse(recordedAt);
  if (!Number.isFinite(recordedMs)) {
    return false;
  }
  return nowMs - recordedMs >= BILLING_FAILED_EVENT_RETENTION_MS;
}

function deliveredKey(enterpriseId: string, eventId: string): string {
  return `${enterpriseId}\0${eventId}`;
}

function splitKbAndCall(rest: string): { kbId: string; callId: string } | null {
  const idx = rest.lastIndexOf(":");
  if (idx <= 0 || idx >= rest.length - 1) {
    return null;
  }
  return { kbId: rest.slice(0, idx), callId: rest.slice(idx + 1) };
}

export function parseGovLlmUsageEventId(eventId: string): GovLlmPart | null {
  if (eventId.startsWith(GOV_LLM_INVOCATION_PREFIX)) {
    const callId = eventId.slice(GOV_LLM_INVOCATION_PREFIX.length);
    return callId ? { kind: "invocation", callId, kbId: "" } : null;
  }
  if (eventId.startsWith(GOV_LLM_CALL_PREFIX)) {
    const split = splitKbAndCall(eventId.slice(GOV_LLM_CALL_PREFIX.length));
    return split ? { kind: "call", ...split } : null;
  }
  if (eventId.startsWith(GOV_LLM_TOKENS_PREFIX)) {
    const split = splitKbAndCall(eventId.slice(GOV_LLM_TOKENS_PREFIX.length));
    return split ? { kind: "tokens", ...split } : null;
  }
  if (eventId.startsWith(GOV_LLM_CREDIT_PREFIX)) {
    const split = splitKbAndCall(eventId.slice(GOV_LLM_CREDIT_PREFIX.length));
    return split ? { kind: "kb", ...split } : null;
  }
  if (eventId.startsWith(GOV_LLM_KB_PREFIX)) {
    const split = splitKbAndCall(eventId.slice(GOV_LLM_KB_PREFIX.length));
    return split ? { kind: "kb", ...split } : null;
  }
  return null;
}

function usageEventOf(event: DurableEvent): UsageReportedWithGovernance | null {
  if (event.event?.type !== "usage.reported") {
    return null;
  }
  if (typeof event.event.eventId !== "string" || !event.event.eventId) {
    return null;
  }
  return event.event as UsageReportedWithGovernance;
}

export function usageRecordContainsEventId(event: BillingDomainEvent, eventId: string): boolean {
  if (event.type !== "usage.reported") {
    return false;
  }
  if (event.eventId === eventId) {
    return true;
  }
  const summary = (event as UsageReportedWithGovernance).governanceLlm;
  return summary?.sourceEventIds.includes(eventId) ?? false;
}

function govPartOf(event: DurableEvent): GovLlmPart | null {
  const usage = usageEventOf(event);
  if (!usage) {
    return null;
  }
  return parseGovLlmUsageEventId(usage.eventId);
}

function isCanonicalGovLlmEvent(event: DurableEvent): boolean {
  const usage = usageEventOf(event);
  return Boolean(usage?.governanceLlm && usage.eventId.startsWith(GOV_LLM_INVOCATION_PREFIX));
}

function finiteQuantity(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return value;
}

function earlierIso(current: string, next: string): string {
  const currentMs = Date.parse(current);
  const nextMs = Date.parse(next);
  if (!Number.isFinite(currentMs)) {
    return Number.isFinite(nextMs) ? next : current || next;
  }
  if (!Number.isFinite(nextMs)) {
    return current;
  }
  return currentMs <= nextMs ? current : next;
}

function laterIso(current: string, next: string): string {
  const currentMs = Date.parse(current);
  const nextMs = Date.parse(next);
  if (!Number.isFinite(currentMs)) {
    return Number.isFinite(nextMs) ? next : current || next;
  }
  if (!Number.isFinite(nextMs)) {
    return current;
  }
  return currentMs >= nextMs ? current : next;
}

function pushUnique(values: string[], value: string): void {
  if (!value || values.includes(value)) {
    return;
  }
  values.push(value);
}

function mergeStatus(events: readonly DurableEvent[]): DurableEventStatus {
  if (events.some((event) => event.status === "pending")) {
    return "pending";
  }
  if (events.some((event) => event.status === "failed")) {
    return "failed";
  }
  return "done";
}

type Leaf = {
  event: DurableEvent;
  part: GovLlmPart;
  usage: UsageReportedWithGovernance;
};

function coalesceGovLlmGroup(group: readonly DurableEvent[]): DurableEvent {
  const anchor = group.reduce((best, event) => (event.seq < best.seq ? event : best));
  const leaves = new Map<string, Leaf>();
  const invocations: Leaf[] = [];
  for (const event of group) {
    const usage = usageEventOf(event);
    const part = usage ? parseGovLlmUsageEventId(usage.eventId) : null;
    if (!usage || !part) {
      continue;
    }
    const leaf: Leaf = { event, part, usage };
    if (part.kind === "invocation") {
      invocations.push(leaf);
      continue;
    }
    const prev = leaves.get(usage.eventId);
    if (!prev || event.seq >= prev.event.seq) {
      leaves.set(usage.eventId, leaf);
    }
  }

  invocations.sort((left, right) => left.event.seq - right.event.seq);
  const firstLeaf = leaves.values().next().value;
  const callId =
    invocations[0]?.part.callId ??
    firstLeaf?.part.callId ??
    parseGovLlmUsageEventId(usageEventOf(anchor)?.eventId ?? "")?.callId ??
    "unknown";
  const invocationId = `${GOV_LLM_INVOCATION_PREFIX}${callId}`;

  let callQuantity = 0;
  let tokenQuantity = 0;
  let creditQuantity = 0;
  const seen = new Set<string>();
  const knowledgeBaseIds: string[] = [];
  let userId = "";
  let occurredAt = "";
  let recordedAt = anchor.recordedAt;
  let agentId = "";
  let orgSeatId = "";

  const absorbIdentity = (event: DurableEvent, usage: UsageReportedEvent) => {
    recordedAt = laterIso(recordedAt, event.recordedAt);
    if (!userId && typeof usage.userId === "string" && usage.userId.trim()) {
      userId = usage.userId;
    }
    if (usage.occurredAt) {
      occurredAt = occurredAt ? earlierIso(occurredAt, usage.occurredAt) : usage.occurredAt;
    }
    if (usage.agentId === "knowledge-governance" || (!agentId && usage.agentId)) {
      agentId = usage.agentId;
    }
    if (!orgSeatId && usage.orgSeatId) {
      orgSeatId = usage.orgSeatId;
    }
  };

  for (const invocation of invocations) {
    const summary = invocation.usage.governanceLlm;
    absorbIdentity(invocation.event, invocation.usage);
    if (!summary) {
      continue;
    }
    const unseen = summary.sourceEventIds.filter((id) => id && !seen.has(id));
    if (seen.size === 0 || unseen.length === summary.sourceEventIds.length) {
      callQuantity += finiteQuantity(summary.callQuantity);
      tokenQuantity += finiteQuantity(summary.tokenQuantity);
      creditQuantity += finiteQuantity(summary.creditQuantity);
    }
    for (const id of summary.sourceEventIds) {
      if (id) {
        seen.add(id);
      }
    }
    seen.add(invocation.usage.eventId);
    for (const kbId of summary.knowledgeBaseIds) {
      pushUnique(knowledgeBaseIds, kbId);
    }
  }

  for (const leaf of leaves.values()) {
    if (seen.has(leaf.usage.eventId)) {
      continue;
    }
    seen.add(leaf.usage.eventId);
    absorbIdentity(leaf.event, leaf.usage);
    pushUnique(knowledgeBaseIds, leaf.part.kbId);
    const quantity = finiteQuantity(leaf.usage.quantity);
    if (leaf.part.kind === "call") {
      callQuantity += quantity;
    } else if (leaf.part.kind === "tokens") {
      tokenQuantity += quantity;
    } else {
      creditQuantity += quantity;
    }
  }

  const sourceEventIds = [...seen]
    .filter((id) => !id.startsWith(GOV_LLM_INVOCATION_PREFIX))
    .toSorted();
  const summary: GovernanceLlmInvocationSummary = {
    callId,
    knowledgeBaseIds: knowledgeBaseIds.toSorted(),
    callQuantity,
    tokenQuantity,
    creditQuantity,
    sourceEventIds,
  };
  const usage: UsageReportedWithGovernance = {
    type: "usage.reported",
    enterpriseId: anchor.enterpriseId,
    userId: userId || "governance-system",
    eventId: invocationId,
    key: "knowledge_governance_llm",
    quantity: tokenQuantity > 0 ? tokenQuantity : callQuantity,
    occurredAt: occurredAt || recordedAt,
    agentId: agentId || "knowledge-governance",
    ...(orgSeatId ? { orgSeatId } : {}),
    governanceLlm: summary,
  };
  return {
    seq: anchor.seq,
    status: mergeStatus(group),
    enterpriseId: anchor.enterpriseId,
    event: usage,
    recordedAt,
  };
}

function fateOf(event: DurableEvent, nowMs: number): "keep" | "drop" | "delivered" {
  if (event.status === "done") {
    return "delivered";
  }
  if (event.status === "failed" && failedEventExpired(event.recordedAt, nowMs)) {
    return "drop";
  }
  return "keep";
}

export function compactBillingEventLog(
  events: DurableEvent[],
  deliveredUsage: readonly DeliveredUsageKey[],
  nowMs: number,
): CompactBillingEventLogResult {
  let changed = false;
  const delivered: DeliveredUsageKey[] = [];
  const deliveredIndex = new Map<string, DeliveredUsageKey>();
  for (const entry of deliveredUsage) {
    if (!entry.enterpriseId || !entry.eventId) {
      changed = true;
      continue;
    }
    if (failedEventExpired(entry.at, nowMs)) {
      changed = true;
      continue;
    }
    const key = deliveredKey(entry.enterpriseId, entry.eventId);
    if (deliveredIndex.has(key)) {
      changed = true;
      continue;
    }
    deliveredIndex.set(key, entry);
    delivered.push(entry);
  }

  const rememberDelivered = (enterpriseId: string, eventId: string, at: string) => {
    if (!enterpriseId || !eventId || failedEventExpired(at, nowMs)) {
      return;
    }
    const key = deliveredKey(enterpriseId, eventId);
    if (deliveredIndex.has(key)) {
      return;
    }
    const entry = { enterpriseId, eventId, at };
    deliveredIndex.set(key, entry);
    delivered.push(entry);
    changed = true;
  };

  const noteDelivered = (event: DurableEvent) => {
    const usage = usageEventOf(event);
    if (!usage) {
      return;
    }
    const at = Number.isFinite(Date.parse(event.recordedAt))
      ? event.recordedAt
      : new Date(nowMs).toISOString();
    rememberDelivered(event.enterpriseId, usage.eventId, at);
    for (const sourceId of usage.governanceLlm?.sourceEventIds ?? []) {
      rememberDelivered(event.enterpriseId, sourceId, at);
    }
  };

  type GroupSlot = { groupKey: string };
  const groups = new Map<string, DurableEvent[]>();
  const slots: Array<DurableEvent | GroupSlot> = [];
  for (const event of events) {
    const part = govPartOf(event);
    if (!part) {
      slots.push(event);
      continue;
    }
    const key = deliveredKey(event.enterpriseId, part.callId);
    const group = groups.get(key);
    if (!group) {
      groups.set(key, [event]);
      slots.push({ groupKey: key });
      continue;
    }
    group.push(event);
    changed = true;
  }

  const kept: DurableEvent[] = [];
  const keepOrDrop = (event: DurableEvent) => {
    const fate = fateOf(event, nowMs);
    if (fate === "keep") {
      kept.push(event);
      return;
    }
    changed = true;
    if (fate === "delivered") {
      noteDelivered(event);
    }
  };

  for (const slot of slots) {
    if (!("groupKey" in slot)) {
      keepOrDrop(slot);
      continue;
    }
    const group = groups.get(slot.groupKey) ?? [];
    // Expired failures are discarded whole. Don't allocate a merged summary
    // for each historical gov-llm split; that backlog is what filled the heap.
    if (
      group.length > 0 &&
      group.every(
        (event) => event.status === "failed" && failedEventExpired(event.recordedAt, nowMs),
      )
    ) {
      changed = true;
      continue;
    }
    if (group.length === 1 && isCanonicalGovLlmEvent(group[0])) {
      keepOrDrop(group[0]);
      continue;
    }
    changed = true;
    const coalesced = coalesceGovLlmGroup(group);
    const fate = fateOf(coalesced, nowMs);
    if (fate === "keep") {
      kept.push(coalesced);
      continue;
    }
    if (fate === "delivered") {
      noteDelivered(coalesced);
    }
  }

  if (!changed) {
    return { events, deliveredUsage: deliveredUsage as DeliveredUsageKey[], changed: false };
  }
  kept.sort((left, right) => left.seq - right.seq);
  return { events: kept, deliveredUsage: delivered, changed: true };
}
