import { describe, expect, it } from "vitest";
import {
  assembleObservationSamples,
  type AssembleInput,
  type ExecutionEvidence,
  type OutcomeEvidence,
} from "./sample-assembler.js";
const scope = {
  kind: "personal",
  personalDomainId: "domain",
  subjectRef: "subject",
  authzScopeRef: "grant",
} as const;
const time = "2026-11-06T00:00:00.000Z";
const outcome: OutcomeEvidence = {
  sourceId: "result",
  provenance: "live",
  isCurrentTip: true,
  record: {
    scope,
    taskId: "task",
    outcomeVersion: 1,
    decidedAt: time,
    taskJudgement: "cancelled",
    lifecycle: "closed",
    acceptance: { status: "pending" },
    delivery: { status: "delivery_unknown" },
    runs: [{ runId: "run", attemptIds: ["a", "b"], status: "cancelled" }],
    attempts: [
      { attemptId: "a", runId: "run", status: "failed", observedAt: time },
      { attemptId: "b", runId: "run", status: "cancelled", observedAt: time },
    ],
  },
};
const event: ExecutionEvidence = {
  sourceId: "runner",
  eventId: "e",
  scope,
  taskId: "task",
  outcomeVersion: 1,
  runId: "run",
  attemptId: "b",
  occurredAt: time,
  provenance: "live",
};
const input = (overrides: Partial<AssembleInput> = {}): AssembleInput => ({
  scope,
  from: Date.parse(time),
  to: Date.parse(time) + 1000,
  projectedAt: Date.parse(time) + 2000,
  sourceWatermark: null,
  outcomes: [outcome],
  executions: [event],
  ...overrides,
});
describe("pure sample assembler", () => {
  it("separates unknown outcome provenance from live execution linkage", () => {
    const r = assembleObservationSamples(
      input({
        outcomes: [{ ...outcome, provenance: "unknown" }],
        executions: [event, { ...event, eventId: "a", attemptId: "a" }],
      }),
    );
    expect(r.samples[0].qualification).toBe("fully_linked");
    expect(r.samples[0].improvementEligible).toBe(false);
    expect(r.samples[0].improvementReasons).toContain("provenance_mixed");
  });
  it("links independent retries without changing cancellation, delivery or cost", () => {
    const r = assembleObservationSamples(
      input({ executions: [event, { ...event, eventId: "a", attemptId: "a" }] }),
    );
    expect(r.samples[0].qualification).toBe("fully_linked");
    expect(r.samples[0].outcome?.taskJudgement).toBe("cancelled");
    expect(r.samples[0].outcome?.deliveryStatus).toBe("delivery_unknown");
    expect(r.samples[0].attributedCost).toBeNull();
  });
  it("deduplicates identical events and counts conflicting candidates as invalid", () => {
    expect(
      assembleObservationSamples(input({ executions: [event, event] })).samples[0].executionRefs,
    ).toHaveLength(1);
    const r = assembleObservationSamples(
      input({ executions: [event, { ...event, attemptId: "a" }] }),
    );
    expect(r.coverage.invalidCount).toBe(1);
    expect(r.coverage.attemptedCount).toBe(1);
  });
  it("is deterministic under event reordering", () => {
    const events = [event, { ...event, eventId: "a", attemptId: "a" }];
    expect(assembleObservationSamples(input({ executions: events }))).toEqual(
      assembleObservationSamples(input({ executions: events.toReversed() })),
    );
  });
  it("never pairs a different outcome version", () => {
    const r = assembleObservationSamples(input({ executions: [{ ...event, outcomeVersion: 2 }] }));
    expect(r.coverage.fullyLinkedCount).toBe(0);
    expect(r.samples.some((s) => s.reasons.includes("missing_outcome_version"))).toBe(true);
  });
  it("rejects wrong scope without returning its outcome", () => {
    const r = assembleObservationSamples(
      input({
        outcomes: [
          { ...outcome, record: { ...outcome.record, scope: { ...scope, subjectRef: "other" } } },
        ],
        executions: [],
      }),
    );
    expect(r.samples[0].qualification).toBe("invalid");
    expect(r.samples[0].outcome).toBeNull();
  });
  it("does not synthesize execution from outcome runs", () => {
    expect(assembleObservationSamples(input({ executions: [] })).samples[0].qualification).toBe(
      "outcome_only",
    );
    expect(assembleObservationSamples(input({ outcomes: [] })).samples[0].qualification).toBe(
      "execution_only",
    );
  });
  it("keeps missing attempt partial and mismatch invalid", () => {
    expect(
      assembleObservationSamples(input({ executions: [{ ...event, attemptId: undefined }] }))
        .samples[0].qualification,
    ).toBe("outcome_only");
    expect(
      assembleObservationSamples(input({ executions: [{ ...event, attemptId: "wrong" }] }))
        .samples[0].qualification,
    ).toBe("invalid");
  });
  it("retains seed provenance and excludes out-of-window events", () => {
    const r = assembleObservationSamples(input({ executions: [{ ...event, provenance: "seed" }] }));
    expect(r.samples[0].provenance).toEqual(["live", "seed"]);
    expect(
      assembleObservationSamples(
        input({
          executions: [{ ...event, occurredAt: new Date(Date.parse(time) + 1000).toISOString() }],
        }),
      ).samples[0].qualification,
    ).toBe("outcome_only");
  });
  it("returns unknown at zero denominator", () => {
    expect(
      assembleObservationSamples(input({ outcomes: [], executions: [] })).coverage.link,
    ).toBeNull();
  });
  it("rejects invalid clocks and invalid event times", () => {
    expect(() => assembleObservationSamples(input({ to: 0 }))).toThrow("invalid_projection_window");
    expect(
      assembleObservationSamples(input({ executions: [{ ...event, occurredAt: "bad" }] }))
        .samples[0].qualification,
    ).toBe("invalid");
  });
  it("whitelists returned metadata", () => {
    const r = assembleObservationSamples(input());
    expect(JSON.stringify(r)).not.toContain("authzScopeRef");
    expect(JSON.stringify(r)).not.toContain("observedAt");
  });
  it("requires all retry evidence and decisive consistency", () => {
    expect(assembleObservationSamples(input()).samples[0].qualification).toBe("outcome_only");
    const record = {
      ...outcome.record,
      decisiveRunId: "run",
      decisiveAttemptId: "b",
      runs: [{ ...outcome.record.runs[0], effectiveAttemptId: "a" }],
    };
    const result = assembleObservationSamples(input({ outcomes: [{ ...outcome, record }] }));
    expect(result.samples[0].qualification).toBe("invalid");
    expect(result.samples[0].reasons).toContain("decisive_attempt_mismatch");
  });
  it("compares reordered metadata structurally and keeps sample ids opaque", () => {
    const reordered = Object.fromEntries(
      Object.entries(outcome.record).toReversed(),
    ) as typeof outcome.record;
    const result = assembleObservationSamples(
      input({ outcomes: [outcome, { ...outcome, record: reordered }] }),
    );
    expect(result.coverage.invalidCount).toBe(0);
    expect(result.samples[0].sampleId).toMatch(/^[a-f0-9]{64}$/);
    expect(result.metricDictVersion).toBe(1);
    expect(JSON.stringify(result)).not.toContain("grant");
  });
  it("separates sources and reports unavailable denominators", () => {
    const result = assembleObservationSamples(
      input({ executions: [event, { ...event, sourceId: "aside" }] }),
    );
    expect(result.samples[0].executionRefs).toHaveLength(2);
    expect(result.coverage.events.state).toBe("unknown");
    expect(result.samples[0].evidenceReasons.resource).toContain("resource_source_unavailable");
  });
  it("blocks mixed seed/live evidence with complete attempts", () => {
    const r = assembleObservationSamples(
      input({
        executions: [event, { ...event, eventId: "a", attemptId: "a", provenance: "seed" }],
      }),
    );
    expect(r.samples[0].qualification).toBe("fully_linked");
    expect(r.samples[0].reasons).toContain("provenance_mixed");
    expect(r.samples[0].improvementEligible).toBe(false);
    expect(r.coverage.fullyLinkedCount).toBe(1);
  });
  it("returns unknown business on conflict regardless of input order", () => {
    const conflict = {
      ...outcome,
      record: { ...outcome.record, taskJudgement: "failure" as const },
    };
    const a = assembleObservationSamples(input({ outcomes: [outcome, conflict] }));
    const b = assembleObservationSamples(input({ outcomes: [conflict, outcome] }));
    expect(a).toEqual(b);
    expect(a.samples[0].outcome).toBeNull();
    expect(a.samples[0].evidence.business).toBe("unknown");
  });
  it("rejects duplicate identities and missing decisive runs", () => {
    for (const record of [
      { ...outcome.record, runs: [...outcome.record.runs, ...outcome.record.runs] },
      { ...outcome.record, attempts: [...outcome.record.attempts, ...outcome.record.attempts] },
      { ...outcome.record, decisiveRunId: "absent" },
    ]) {
      const r = assembleObservationSamples(
        input({
          outcomes: [{ ...outcome, record }],
          executions: [event, { ...event, eventId: "a", attemptId: "a" }],
        }),
      );
      expect(r.samples[0].qualification).toBe("invalid");
    }
  });
  it("rejects phantom attempt references and missing reverse membership", () => {
    const executions = [event, { ...event, eventId: "a", attemptId: "a" }];
    for (const runs of [
      [{ ...outcome.record.runs[0], attemptIds: ["a", "b", "phantom"] }],
      [{ ...outcome.record.runs[0], attemptIds: ["a"] }],
    ]) {
      const result = assembleObservationSamples(
        input({ outcomes: [{ ...outcome, record: { ...outcome.record, runs } }], executions }),
      );
      expect(result.samples[0].qualification).toBe("invalid");
      expect(result.samples[0].reasons).toContain("outcome_attempt_membership_mismatch");
    }
  });
  it("keeps conflicting outcome causes stable when run identities differ", () => {
    const conflict = { ...outcome, record: { ...outcome.record, runs: [] } };
    expect(assembleObservationSamples(input({ outcomes: [outcome, conflict] }))).toEqual(
      assembleObservationSamples(input({ outcomes: [conflict, outcome] })),
    );
  });
  it("never promotes legacy or non-live evidence into an improvement candidate", () => {
    for (const provenance of ["live", "unknown", "seed", "injected"] as const) {
      const r = assembleObservationSamples(
        input({
          outcomes: [{ ...outcome, provenance }],
          executions: [
            { ...event, provenance },
            { ...event, eventId: "a", attemptId: "a", provenance },
          ],
        }),
      );
      expect(r.samples[0].improvementEligible).toBe(false);
      expect(r.samples[0].improvementReasons).toContain("trusted_execution_collector_unavailable");
      if (provenance !== "live") {
        expect(r.samples[0].improvementReasons).toContain("non_live_provenance");
      }
    }
  });
  it("uses an explicit lookup window only for exact cohort outcome support", () => {
    const at = Date.parse(time);
    const before = {
      ...event,
      eventId: "a",
      attemptId: "a",
      occurredAt: new Date(at - 1).toISOString(),
    };
    const args = {
      ...input({ executions: [event, before, before] }),
      evidenceLookupWindow: { from: at - 10, to: at + 1000 },
    };
    const result = assembleObservationSamples(args);
    expect(result.samples[0].qualification).toBe("fully_linked");
    expect(result.samples[0].reasons).toContain("outside_cohort_window");
    expect(result.samples[0].executionRefs).toHaveLength(2);
    expect(result.coverage.attemptedCount).toBe(1);
    expect(
      assembleObservationSamples(input({ executions: [event, before] })).samples[0].qualification,
    ).toBe("outcome_only");
  });
  it("keeps lookup boundaries half open and excludes unrelated outside-cohort candidates", () => {
    const at = Date.parse(time);
    const lookup = { from: at - 10, to: at + 1010 };
    const outside = {
      ...event,
      eventId: "support",
      attemptId: "a",
      occurredAt: new Date(at - 10).toISOString(),
    };
    const r = assembleObservationSamples({
      ...input({
        executions: [
          event,
          outside,
          { ...outside, eventId: "wrong-version", outcomeVersion: 2 },
          { ...outside, eventId: "unlinked", taskId: undefined },
          { ...outside, eventId: "wrong-scope", scope: { ...scope, subjectRef: "other" } },
          { ...outside, eventId: "at-end", occurredAt: new Date(lookup.to).toISOString() },
        ],
      }),
      evidenceLookupWindow: lookup,
    });
    expect(r.coverage.attemptedCount).toBe(1);
    expect(r.samples[0].executionRefs).toHaveLength(2);
    expect(
      assembleObservationSamples({
        ...input({ outcomes: [], executions: [outside] }),
        evidenceLookupWindow: lookup,
      }).samples,
    ).toEqual([]);
  });
  it("rejects invalid lookup windows and preserves source and improvement gates", () => {
    const at = Date.parse(time);
    for (const evidenceLookupWindow of [
      { from: at + 1, to: at + 1000 },
      { from: at - 1, to: at + 999 },
      { from: NaN, to: at + 1000 },
      { from: at - 30 * 86400000, to: at + 1000 },
    ]) {
      expect(() => assembleObservationSamples({ ...input(), evidenceLookupWindow })).toThrow(
        "invalid_evidence_lookup_window",
      );
    }
    const r = assembleObservationSamples({
      ...input({
        executions: [
          event,
          {
            ...event,
            eventId: "a",
            attemptId: "a",
            provenance: "seed",
            occurredAt: new Date(at - 1).toISOString(),
          },
        ],
      }),
      evidenceLookupWindow: { from: at - 1, to: at + 1000 },
    });
    expect(r.samples[0].qualification).toBe("fully_linked");
    expect(r.samples[0].improvementEligible).toBe(false);
    expect(r.samples[0].reasons).toContain("provenance_mixed");
  });
  it("keeps support conflict processing deterministic and excludes conflicted outcomes", () => {
    const at = Date.parse(time);
    const support = {
      ...event,
      eventId: "a",
      attemptId: "a",
      occurredAt: new Date(at - 1).toISOString(),
    };
    const conflicting = { ...support, runId: "other" };
    const events = [event, support, conflicting];
    const args = {
      ...input({ executions: events }),
      evidenceLookupWindow: { from: at - 10, to: at + 1000 },
    };
    const a = assembleObservationSamples(args);
    const b = assembleObservationSamples({ ...args, executions: events.toReversed() });
    expect(a).toEqual(b);
    expect(a.samples[0].qualification).toBe("invalid");
    expect(a.samples[0].reasons).toContain("duplicate_conflict");
    const badOutcome = {
      ...outcome,
      record: { ...outcome.record, taskJudgement: "failure" as const },
    };
    const rejected = assembleObservationSamples({ ...args, outcomes: [outcome, badOutcome] });
    expect(rejected.samples[0].executionRefs).toHaveLength(1);
    expect(() =>
      assembleObservationSamples({
        ...input(),
        evidenceLookupWindow: { from: at - 1, to: at + 2001 },
      }),
    ).toThrow("invalid_evidence_lookup_window");
    expect(assembleObservationSamples(input()).evidenceLookupWindow).toEqual({
      from: at,
      to: at + 1000,
    });
  });
});
