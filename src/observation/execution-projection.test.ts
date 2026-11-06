import { describe, it, expect } from "vitest";
import { createExecutionEvidenceStore } from "./execution-evidence-store.js";
import { projectExecutionEvidence } from "./execution-projection.js";
const scope = {
  kind: "personal",
  personalDomainId: "d",
  subjectRef: "s",
  authzScopeRef: "g",
} as const;
function setup(capacity = 10) {
  let now = 100;
  let enabled = true;
  const store = createExecutionEvidenceStore({
    now: () => now,
    enabled: () => enabled,
    capacity,
    ttlMs: 20,
  });
  const fact = (eventId: string, stage: "started" | "completed", occurredAt: number) =>
    store.recordFact({ eventId, stage, occurredAt, scope, taskId: "t", runId: "r" });
  fact("start", "started", 90);
  fact("end", "completed", 95);
  const link = () =>
    store.recordLink({
      receiptId: "link",
      scope,
      taskId: "t",
      runId: "r",
      outcomeVersion: 2,
      attemptId: "a",
      attemptGranularity: "turn",
      eventIds: ["start", "end"],
    });
  const project = (version = 2) =>
    projectExecutionEvidence({
      snapshot: store.query(scope),
      scope,
      taskId: "t",
      outcomeVersion: version,
    });
  return {
    store,
    link,
    project,
    advance: () => {
      now = 121;
    },
    disable: () => {
      enabled = false;
    },
  };
}
describe("execution evidence projection", () => {
  it("projects scoped retention without claiming complete history", () => {
    const x = setup();
    const source = x.project().executionSource;
    expect(source.sourceWatermark).toBeNull();
    expect(source.scopeWatermark).toMatchObject({
      state: "tracked",
      ingestSequence: 2,
      priorHistory: "unknown",
    });
    const snapshot = x.store.query(scope);
    source.scopeWatermark.ingestSequence = 999;
    expect(snapshot.scopeWatermark.ingestSequence).toBe(2);
    x.disable();
    expect(x.project().executionSource.scopeWatermark).toMatchObject({
      state: "unknown",
      ingestSequence: null,
      priorHistory: "unknown",
    });
  });
  it("preserves unknown scope statistics after bounded tracking eviction", () => {
    const x = setup(1);
    x.store.recordFact({
      eventId: "other",
      stage: "started",
      occurredAt: 100,
      scope: { ...scope, personalDomainId: "other" },
      taskId: "other-task",
      runId: "other-run",
    });
    const source = x.project().executionSource;
    expect(source.scopeWatermark).toMatchObject({
      state: "unknown",
      trackingEpoch: null,
      ingestSequence: null,
      expiredCount: null,
      capacityEvictedCount: null,
      priorHistory: "unknown",
    });
    expect(source.sourceWatermark).toBeNull();
    expect(JSON.stringify(source)).not.toContain("other-task");
  });
  it("requires retained started and terminal facts plus exact version receipt", () => {
    const x = setup();
    expect(x.project().executions).toEqual([]);
    expect(x.link()).toBe(true);
    expect(x.project().executions.map((e) => e.eventId)).toEqual(["end", "start"]);
    expect(x.project(3).executions).toEqual([]);
    expect(JSON.stringify(x.project().executionSource)).not.toContain("authzScopeRef");
  });
  it("does not manufacture events from expired or evicted receipts", () => {
    const x = setup();
    x.link();
    x.advance();
    expect(x.project().executions).toEqual([]);
    const evicted = setup(1);
    expect(evicted.link()).toBe(false);
    expect(evicted.project().executions).toEqual([]);
  });
  it("clears evidence after observation is disabled", () => {
    const x = setup();
    x.link();
    x.disable();
    expect(x.project().executions).toEqual([]);
    expect(x.project().executionSource.reasons).toContain("observation_disabled_or_scope_invalid");
  });
  it("rejects terminal-only receipt and time-reversed stages", () => {
    const store = createExecutionEvidenceStore({ enabled: () => true, now: () => 100 });
    for (const [eventId, stage, occurredAt] of [
      ["s", "started", 99],
      ["e", "completed", 90],
    ] as const) {
      store.recordFact({ eventId, stage, occurredAt, scope, taskId: "t", runId: "r" });
    }
    store.recordLink({
      receiptId: "l",
      scope,
      taskId: "t",
      runId: "r",
      outcomeVersion: 2,
      attemptId: "a",
      attemptGranularity: "turn",
      eventIds: ["s", "e"],
    });
    expect(
      projectExecutionEvidence({
        snapshot: store.query(scope),
        scope,
        taskId: "t",
        outcomeVersion: 2,
      }).executions,
    ).toEqual([]);
  });
});
