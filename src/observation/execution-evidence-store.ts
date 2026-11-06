/** Disposable process-local metadata projection, never an execution/result authority. */
import { randomUUID } from "node:crypto";
import type { TrustedScope } from "../task-outcome/types.js";
export const EXECUTION_EVIDENCE_FLAG = "OPENBOT_EXECUTION_ROUTER_OBSERVATION";
export type ExecutionFact = {
  eventId: string;
  taskId: string;
  runId: string;
  scope: TrustedScope;
  occurredAt: number;
  stage: "started" | "completed" | "failed" | "cancelled";
};
export type VersionLinkReceipt = {
  receiptId: string;
  taskId: string;
  runId: string;
  scope: TrustedScope;
  outcomeVersion: number;
  attemptId: string;
  attemptGranularity: "turn";
  eventIds: readonly string[];
};
function scopeKey(s: TrustedScope): string {
  return JSON.stringify(
    s.kind === "enterprise"
      ? [s.kind, s.subjectRef, s.authzScopeRef, s.tenantId, s.enterpriseDomainId]
      : [s.kind, s.subjectRef, s.authzScopeRef, s.personalDomainId],
  );
}
function validScope(s: TrustedScope): boolean {
  return (
    s &&
    (s.kind === "enterprise" || s.kind === "personal") &&
    (s.kind === "enterprise"
      ? [s.subjectRef, s.authzScopeRef, s.tenantId, s.enterpriseDomainId]
      : [s.subjectRef, s.authzScopeRef, s.personalDomainId]
    ).every((v) => typeof v === "string" && v.trim().length > 0)
  );
}
function copyScope(s: TrustedScope): TrustedScope {
  return s.kind === "enterprise"
    ? {
        kind: s.kind,
        subjectRef: s.subjectRef,
        authzScopeRef: s.authzScopeRef,
        tenantId: s.tenantId,
        enterpriseDomainId: s.enterpriseDomainId,
      }
    : {
        kind: s.kind,
        subjectRef: s.subjectRef,
        authzScopeRef: s.authzScopeRef,
        personalDomainId: s.personalDomainId,
      };
}
export function createExecutionEvidenceStore(
  options: { now?: () => number; enabled?: () => boolean; capacity?: number; ttlMs?: number } = {},
) {
  const now = options.now ?? Date.now;
  const enabled =
    options.enabled ??
    (() => /^(1|true|yes|on)$/i.test(process.env[EXECUTION_EVIDENCE_FLAG]?.trim() ?? ""));
  const capacity = options.capacity ?? 1000;
  const ttlMs = options.ttlMs ?? 900000;
  if (!Number.isSafeInteger(capacity) || capacity < 1 || !Number.isFinite(ttlMs) || ttlMs <= 0) {
    throw new Error("invalid_retention");
  }
  const processId = randomUUID();
  let epoch = randomUUID();
  const facts = new Map<string, { fact: ExecutionFact; receivedAt: number }>();
  const receipts = new Map<string, VersionLinkReceipt>();
  const conflicts = new Set<string>();
  const discard = (id: string) => {
    const item = facts.get(id);
    if (item) {
      facts.delete(id);
      conflicts.delete(id);
    }
  };
  const sweep = () => {
    const at = now();
    for (const [id, item] of facts) {
      if (at - item.receivedAt >= ttlMs) {
        discard(id);
      }
    }
    for (const [id, r] of receipts) {
      if (r.eventIds.some((e) => !facts.has(e))) {
        receipts.delete(id);
      }
    }
  };
  const active = () => {
    try {
      if (enabled()) {
        return true;
      }
    } catch {
      /* fail closed */
    }
    facts.clear();
    receipts.clear();
    conflicts.clear();
    epoch = randomUUID();
    return false;
  };
  return {
    recordFact(input: ExecutionFact): boolean {
      try {
        if (!active()) {
          return false;
        }
        sweep();
        if (
          !input.eventId ||
          !input.taskId ||
          !input.runId ||
          !validScope(input.scope) ||
          !Number.isFinite(input.occurredAt) ||
          input.occurredAt > now() ||
          !["started", "completed", "failed", "cancelled"].includes(input.stage)
        ) {
          return false;
        }
        const fact: ExecutionFact = {
          eventId: input.eventId,
          taskId: input.taskId,
          runId: input.runId,
          scope: copyScope(input.scope),
          occurredAt: input.occurredAt,
          stage: input.stage,
        };
        const prior = facts.get(fact.eventId);
        if (prior) {
          if (JSON.stringify(prior.fact) !== JSON.stringify(fact)) {
            conflicts.add(fact.eventId);
            return false;
          }
          return !conflicts.has(fact.eventId);
        }
        facts.set(fact.eventId, { fact, receivedAt: now() });
        while (facts.size > capacity) {
          discard(facts.keys().next().value!);
        }
        sweep();
        return true;
      } catch {
        return false;
      }
    },
    recordLink(input: VersionLinkReceipt): boolean {
      try {
        if (!active()) {
          return false;
        }
        sweep();
        if (
          !input.receiptId ||
          !input.taskId ||
          !input.runId ||
          !validScope(input.scope) ||
          !Number.isSafeInteger(input.outcomeVersion) ||
          input.outcomeVersion < 1 ||
          !input.attemptId ||
          input.attemptGranularity !== "turn" ||
          !input.eventIds.length ||
          new Set(input.eventIds).size !== input.eventIds.length
        ) {
          return false;
        }
        if (
          input.eventIds.some((id) => {
            const f = facts.get(id)?.fact;
            return (
              !f ||
              conflicts.has(id) ||
              f.taskId !== input.taskId ||
              f.runId !== input.runId ||
              scopeKey(f.scope) !== scopeKey(input.scope)
            );
          })
        ) {
          return false;
        }
        const receipt: VersionLinkReceipt = {
          receiptId: input.receiptId,
          taskId: input.taskId,
          runId: input.runId,
          scope: copyScope(input.scope),
          outcomeVersion: input.outcomeVersion,
          attemptId: input.attemptId,
          attemptGranularity: "turn",
          eventIds: [...input.eventIds].toSorted(),
        };
        const prior = receipts.get(receipt.receiptId);
        if (prior && JSON.stringify(prior) !== JSON.stringify(receipt)) {
          for (const id of prior.eventIds) {
            conflicts.add(id);
          }
          return false;
        }
        if (
          [...receipts.values()].some(
            (r) =>
              r.eventIds.some((id) => receipt.eventIds.includes(id)) &&
              (r.outcomeVersion !== receipt.outcomeVersion || r.attemptId !== receipt.attemptId),
          )
        ) {
          for (const id of receipt.eventIds) {
            conflicts.add(id);
          }
          return false;
        }
        receipts.set(receipt.receiptId, receipt);
        while (receipts.size > capacity) {
          receipts.delete(receipts.keys().next().value!);
        }
        return true;
      } catch {
        return false;
      }
    },
    query(scope: TrustedScope) {
      let visible = false;
      try {
        visible = active() && validScope(scope);
        if (visible) {
          sweep();
        }
      } catch {
        facts.clear();
        receipts.clear();
        conflicts.clear();
        epoch = randomUUID();
      }
      const scopedFacts = visible
        ? [...facts.values()]
            .filter((i) => scopeKey(i.fact.scope) === scopeKey(scope))
            .map((i) => ({ ...i.fact, scope: copyScope(i.fact.scope) }))
        : [];
      const scopedLinks = visible
        ? [...receipts.values()]
            .filter(
              (r) =>
                scopeKey(r.scope) === scopeKey(scope) &&
                r.eventIds.every((id) => facts.has(id) && !conflicts.has(id)),
            )
            .map((r) => ({ ...r, scope: copyScope(r.scope), eventIds: [...r.eventIds] }))
        : [];
      return {
        processId,
        epoch,
        retention: "process_memory" as const,
        capacity,
        ttlMs,
        evictedCount: null,
        discardedThrough: null,
        facts: scopedFacts,
        links: scopedLinks,
        sourceWatermark: null,
        reasons: [
          "non_durable_projection",
          ...(visible ? [] : ["observation_disabled_or_scope_invalid"]),
          "retention_continuity_unknown",
        ],
      };
    },
  };
}

let shared: ReturnType<typeof createExecutionEvidenceStore> | undefined;
export function getExecutionEvidenceStore() {
  return (shared ??= createExecutionEvidenceStore());
}
