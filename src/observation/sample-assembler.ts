import { createHash } from "node:crypto";
import type { TrustedScope } from "../task-outcome/types.js";
import type { OutcomeRecordMetadata } from "./outcome-reader.js";
export type Provenance = "live" | "seed" | "injected" | "sample_ui" | "unknown";
export type OutcomeEvidence = {
  readonly record: Readonly<OutcomeRecordMetadata>;
  readonly sourceId: string;
  readonly provenance: Provenance;
  readonly isCurrentTip: boolean;
};
export type ExecutionEvidence = {
  readonly sourceId: string;
  readonly eventId: string;
  readonly occurredAt: string;
  readonly provenance: Provenance;
  readonly runId: string;
  readonly scope?: TrustedScope;
  readonly taskId?: string;
  readonly outcomeVersion?: number;
  readonly attemptId?: string;
  readonly capabilityCallId?: string;
  readonly deliveryId?: string;
};
export type AssembleInput = {
  readonly scope: TrustedScope;
  readonly from: number;
  readonly to: number;
  readonly projectedAt: number;
  readonly sourceWatermark: string | null;
  readonly outcomes: readonly OutcomeEvidence[];
  readonly executions: readonly ExecutionEvidence[];
};
export type SampleLinkageQualification =
  | "fully_linked"
  | "outcome_only"
  | "execution_only"
  | "invalid";
function scopeKey(s: TrustedScope): string {
  return JSON.stringify(
    s.kind === "personal"
      ? [s.kind, s.personalDomainId, s.subjectRef, s.authzScopeRef]
      : [s.kind, s.enterpriseDomainId, s.tenantId, s.subjectRef, s.authzScopeRef],
  );
}
function key(values: readonly unknown[]): string {
  return JSON.stringify(values);
}
function metadata(e: ExecutionEvidence): ExecutionEvidence {
  return {
    sourceId: e.sourceId,
    eventId: e.eventId,
    occurredAt: e.occurredAt,
    provenance: e.provenance,
    runId: e.runId,
    scope: e.scope,
    taskId: e.taskId,
    outcomeVersion: e.outcomeVersion,
    attemptId: e.attemptId,
    capabilityCallId: e.capabilityCallId,
    deliveryId: e.deliveryId,
  };
}
function outcomeFingerprint(r: OutcomeRecordMetadata): string {
  return key([
    scopeKey(r.scope),
    r.taskId,
    r.outcomeVersion,
    r.decidedAt,
    r.taskJudgement,
    r.lifecycle,
    r.decisiveRunId,
    r.decisiveAttemptId,
    r.deliveryId,
    r.acceptance.status,
    r.delivery.status,
    r.runs
      .map((run) => [run.runId, [...run.attemptIds].toSorted(), run.effectiveAttemptId, run.status])
      .toSorted((a, b) => key(a).localeCompare(key(b))),
    r.attempts
      .map((attempt) => [attempt.attemptId, attempt.runId, attempt.status, attempt.observedAt])
      .toSorted((a, b) => key(a).localeCompare(key(b))),
  ]);
}
type Candidate = {
  id: string;
  outcome?: OutcomeEvidence;
  events: ExecutionEvidence[];
  reasons: Set<string>;
  invalid: boolean;
  provenance: Set<Provenance>;
};
/** Pure projection; independent events and authenticated scope must be supplied by adapters. */
export function assembleObservationSamples(input: AssembleInput) {
  if (![input.from, input.to, input.projectedAt].every(Number.isFinite) || input.from >= input.to) {
    throw new Error("invalid_projection_window");
  }
  const scope = scopeKey(input.scope);
  const groups = new Map<string, Candidate>();
  const get = (id: string): Candidate => {
    let c = groups.get(id);
    if (!c) {
      c = { id, events: [], reasons: new Set(), invalid: false, provenance: new Set() };
      groups.set(id, c);
    }
    return c;
  };
  const fail = (c: Candidate, reason: string) => {
    c.invalid = true;
    c.reasons.add(reason);
  };
  const included = (time: number) =>
    !Number.isFinite(time) || (time >= input.from && time < input.to);
  const outcomes = [...input.outcomes].toSorted((a, b) =>
    key([a.record.taskId, a.record.outcomeVersion, a.sourceId]).localeCompare(
      key([b.record.taskId, b.record.outcomeVersion, b.sourceId]),
    ),
  );
  for (const o of outcomes) {
    const r = o.record;
    const time = Date.parse(r.decidedAt);
    if (!included(time)) {
      continue;
    }
    const c = get(key(["outcome", scopeKey(r.scope), r.taskId, r.outcomeVersion]));
    c.provenance.add(o.provenance);
    if (scopeKey(r.scope) !== scope) {
      fail(c, "scope_mismatch");
      continue;
    }
    if (!Number.isFinite(time)) {
      fail(c, "invalid_timestamp");
    }
    if (!r.taskId || !Number.isSafeInteger(r.outcomeVersion) || r.outcomeVersion < 1) {
      fail(c, "invalid_outcome_identity");
    }
    if (
      c.outcome &&
      (outcomeFingerprint(c.outcome.record) !== outcomeFingerprint(r) ||
        c.outcome.isCurrentTip !== o.isCurrentTip)
    ) {
      fail(c, "outcome_conflict");
    } else if (!c.outcome) {
      c.outcome = o;
    }
  }
  const seen = new Map<string, { event: ExecutionEvidence; candidate: Candidate }>();
  const events = input.executions
    .map(metadata)
    .toSorted((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
  for (const e of events) {
    const time = Date.parse(e.occurredAt);
    if (!included(time)) {
      continue;
    }
    const linked = e.scope && e.taskId && e.outcomeVersion !== undefined;
    const id = linked
      ? key(["outcome", scopeKey(e.scope), e.taskId, e.outcomeVersion])
      : key([
          "execution",
          e.sourceId,
          e.scope ? scopeKey(e.scope) : null,
          e.runId,
          e.attemptId ?? null,
        ]);
    const prior = seen.get(key([e.sourceId, e.eventId]));
    if (prior && JSON.stringify(prior.event) === JSON.stringify(e)) {
      continue;
    }
    const c = get(id);
    c.provenance.add(e.provenance);
    if (prior) {
      fail(prior.candidate, "duplicate_conflict");
      fail(c, "duplicate_conflict");
    } else {
      seen.set(key([e.sourceId, e.eventId]), { event: e, candidate: c });
    }
    if (e.scope && scopeKey(e.scope) !== scope) {
      fail(c, "scope_mismatch");
      continue;
    }
    c.events.push(e);
    if (!Number.isFinite(time)) {
      fail(c, "invalid_timestamp");
    }
    if (!e.sourceId || !e.eventId || !e.runId) {
      fail(c, "invalid_execution_identity");
    }
    if (
      e.outcomeVersion !== undefined &&
      (!Number.isSafeInteger(e.outcomeVersion) || e.outcomeVersion < 1)
    ) {
      fail(c, "invalid_outcome_identity");
    }
    if (!e.scope) {
      c.reasons.add("missing_scope");
    }
    if (!e.taskId) {
      c.reasons.add("missing_task_link");
    }
    if (e.outcomeVersion === undefined) {
      c.reasons.add("missing_outcome_version");
    }
    if (!e.attemptId) {
      c.reasons.add("missing_attempt_link");
    }
    const r = c.outcome?.record;
    if (r) {
      const run = r.runs.find((x) => x.runId === e.runId);
      const attempt = r.attempts.find((x) => x.attemptId === e.attemptId);
      if (!run) {
        fail(c, "run_mismatch");
      }
      if (
        e.attemptId &&
        (!attempt || attempt.runId !== e.runId || !run?.attemptIds.includes(e.attemptId))
      ) {
        fail(c, "attempt_mismatch");
      }
      if (e.deliveryId && e.deliveryId !== r.deliveryId) {
        fail(c, "delivery_mismatch");
      }
    } else if (linked) {
      c.reasons.add("missing_outcome_version");
    }
  }
  const samples = [...groups.values()]
    .toSorted((a, b) => a.id.localeCompare(b.id))
    .map((c) => {
      const r = c.outcome?.record;
      if (!r) {
        c.reasons.add("missing_outcome");
      }
      if (!c.events.length) {
        c.reasons.add("missing_execution");
      }
      if (c.provenance.size > 1) {
        fail(c, "provenance_mixed");
      }
      if (c.provenance.has("unknown")) {
        c.reasons.add("provenance_unknown");
      }
      if (r) {
        if (
          new Set(r.runs.map((run) => run.runId)).size !== r.runs.length ||
          new Set(r.attempts.map((attempt) => attempt.attemptId)).size !== r.attempts.length ||
          r.runs.some((run) => new Set(run.attemptIds).size !== run.attemptIds.length)
        ) {
          fail(c, "duplicate_outcome_identity");
        }
        if (r.decisiveRunId && !r.runs.some((run) => run.runId === r.decisiveRunId)) {
          fail(c, "decisive_run_mismatch");
        }
        for (const run of r.runs) {
          if (run.effectiveAttemptId && !run.attemptIds.includes(run.effectiveAttemptId)) {
            fail(c, "effective_attempt_mismatch");
          }
        }
        const decisive = r.runs.find((run) => run.runId === r.decisiveRunId);
        if (
          r.decisiveAttemptId &&
          (!decisive ||
            !decisive.attemptIds.includes(r.decisiveAttemptId) ||
            (decisive.effectiveAttemptId && decisive.effectiveAttemptId !== r.decisiveAttemptId))
        ) {
          fail(c, "decisive_attempt_mismatch");
        }
        if (
          !r.attempts.length ||
          r.attempts.some(
            (attempt) =>
              !c.events.some(
                (event) => event.runId === attempt.runId && event.attemptId === attempt.attemptId,
              ),
          )
        ) {
          c.reasons.add("missing_attempt_evidence");
        }
      }
      const complete = Boolean(
        r &&
        !c.reasons.has("missing_attempt_evidence") &&
        c.events.length &&
        c.events.every((e) => e.scope && e.taskId && e.outcomeVersion !== undefined && e.attemptId),
      );
      const qualification: SampleLinkageQualification = c.invalid
        ? "invalid"
        : complete
          ? "fully_linked"
          : r
            ? "outcome_only"
            : "execution_only";
      return {
        sampleId: createHash("sha256").update(c.id).digest("hex"),
        qualification,
        reasons: [...c.reasons].toSorted(),
        provenance: [...c.provenance].toSorted(),
        outcome:
          r && !c.reasons.has("outcome_conflict")
            ? {
                taskId: r.taskId,
                outcomeVersion: r.outcomeVersion,
                isCurrentTip: c.outcome!.isCurrentTip,
                taskJudgement: r.taskJudgement,
                lifecycle: r.lifecycle,
                acceptanceStatus: r.acceptance.status,
                deliveryStatus: r.delivery.status,
              }
            : null,
        executionRefs: c.events.map((e) => ({
          sourceId: e.sourceId,
          eventId: e.eventId,
          runId: e.runId,
          attemptId: e.attemptId ?? null,
          capabilityCallId: e.capabilityCallId ?? null,
          deliveryId: e.deliveryId ?? null,
        })),
        evidence: {
          resource: "unknown" as const,
          technical: "unknown" as const,
          execution: c.events.length ? (c.invalid || !complete ? "partial" : "present") : "unknown",
          business: c.reasons.has("outcome_conflict")
            ? "unknown"
            : r
              ? c.invalid
                ? "partial"
                : "present"
              : "unknown",
        },
        evidenceReasons: {
          resource: ["resource_source_unavailable"],
          technical: ["technical_source_unavailable"],
          execution: [...c.reasons].toSorted(),
          business: c.reasons.has("outcome_conflict")
            ? ["outcome_conflict"]
            : r
              ? []
              : ["missing_outcome"],
        },
        attributedCost: null,
      };
    });
  const fullyLinkedCount = samples.filter((s) => s.qualification === "fully_linked").length;
  return {
    schemaVersion: 1 as const,
    metricDictVersion: 1 as const,
    samples,
    projectedAt: input.projectedAt,
    sourceWatermark: input.sourceWatermark,
    window: { from: input.from, to: input.to },
    coverage: {
      attemptedCount: samples.length,
      fullyLinkedCount,
      invalidCount: samples.filter((s) => s.qualification === "invalid").length,
      link: samples.length ? fullyLinkedCount / samples.length : null,
      events: { state: "unknown" as const, reason: "source_event_denominator_unavailable" },
      fields: { state: "unknown" as const, reason: "required_field_denominator_unavailable" },
      reasons: samples.length ? [] : ["no_candidates"],
    },
  };
}
