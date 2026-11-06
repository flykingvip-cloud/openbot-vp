/** Pure adapter: receipts link retained facts, never constitute execution facts. */
import type { TrustedScope } from "../task-outcome/types.js";
import type { createExecutionEvidenceStore } from "./execution-evidence-store.js";
import type { ExecutionEvidence } from "./sample-assembler.js";
export type ExecutionSource = Pick<ReturnType<typeof createExecutionEvidenceStore>, "query">;
type Snapshot = ReturnType<ExecutionSource["query"]>;
function scopeKey(s: TrustedScope): string {
  return JSON.stringify(
    s.kind === "personal"
      ? [s.kind, s.personalDomainId, s.subjectRef, s.authzScopeRef]
      : [s.kind, s.enterpriseDomainId, s.tenantId, s.subjectRef, s.authzScopeRef],
  );
}
export function projectExecutionEvidence(input: {
  snapshot: Snapshot;
  scope: TrustedScope;
  taskId: string;
  outcomeVersion: number;
}) {
  const { snapshot } = input;
  const reasons = new Set(snapshot.reasons);
  const executions: ExecutionEvidence[] = [];
  const scope = scopeKey(input.scope);
  const facts = snapshot.facts.filter(
    (f) => scopeKey(f.scope) === scope && f.taskId === input.taskId,
  );
  for (const receipt of snapshot.links) {
    if (
      scopeKey(receipt.scope) !== scope ||
      receipt.taskId !== input.taskId ||
      receipt.outcomeVersion !== input.outcomeVersion
    ) {
      continue;
    }
    const linked = receipt.eventIds.map((id) => facts.find((f) => f.eventId === id));
    if (!linked.length || linked.some((f) => !f || f.runId !== receipt.runId)) {
      reasons.add("execution_link_missing_facts");
      continue;
    }
    const retained = linked.filter((f) => f !== undefined);
    const starts = retained.filter((f) => f.stage === "started");
    const ends = retained.filter((f) => f.stage !== "started");
    if (
      !starts.length ||
      !ends.length ||
      !starts.some((start) => ends.some((end) => end.occurredAt >= start.occurredAt))
    ) {
      reasons.add("execution_pair_incomplete");
      continue;
    }
    if (receipt.attemptGranularity !== "turn") {
      reasons.add("execution_attempt_granularity_unknown");
      continue;
    }
    for (const fact of retained) {
      executions.push({
        sourceId: JSON.stringify(["runtime_execution", snapshot.processId, snapshot.epoch]),
        eventId: fact.eventId,
        occurredAt: new Date(fact.occurredAt).toISOString(),
        provenance: "live",
        runId: fact.runId,
        scope: input.scope,
        taskId: fact.taskId,
        outcomeVersion: receipt.outcomeVersion,
        attemptId: receipt.attemptId,
      });
    }
  }
  if (!executions.length) {
    reasons.add("execution_source_unavailable");
  }
  reasons.add("turn_attempt_only");
  return {
    executions,
    executionSource: {
      processId: snapshot.processId,
      epoch: snapshot.epoch,
      retention: snapshot.retention,
      capacity: snapshot.capacity,
      ttlMs: snapshot.ttlMs,
      evictedCount: snapshot.evictedCount,
      discardedThrough: snapshot.discardedThrough,
      sourceWatermark: snapshot.sourceWatermark,
      reasons: [...reasons].toSorted(),
    },
  };
}
