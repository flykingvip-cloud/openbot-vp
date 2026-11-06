import { describe, expect, it, vi } from "vitest";
import type { TrustedScope } from "../task-outcome/types.js";
import {
  createExecutionEvidenceStore,
  EXECUTION_EVIDENCE_FLAG,
} from "./execution-evidence-store.js";
const scope: TrustedScope = {
  kind: "enterprise",
  subjectRef: "subject:a",
  authzScopeRef: "auth",
  tenantId: "tenant",
  enterpriseDomainId: "domain",
};
const fact = (eventId = "e") => ({
  eventId,
  taskId: "task",
  runId: "run",
  scope,
  occurredAt: 100,
  stage: "started" as const,
});
const link = () => ({
  receiptId: "receipt",
  taskId: "task",
  runId: "run",
  scope,
  outcomeVersion: 2,
  attemptId: "att:run",
  attemptGranularity: "turn" as const,
  eventIds: ["e"],
});
describe("disposable execution evidence", () => {
  it("keeps disabled epochs stable until the flag changes", () => {
    let on = false;
    const store = createExecutionEvidenceStore({ enabled: () => on, now: () => 100 });
    const first = store.query(scope);
    expect(store.query(scope).epoch).toBe(first.epoch);
    on = true;
    const running = store.query(scope);
    expect(running.epoch).not.toBe(first.epoch);
    on = false;
    const stopped = store.query(scope);
    expect(stopped.epoch).not.toBe(running.epoch);
    expect(store.query(scope).epoch).toBe(stopped.epoch);
  });
  it("reports only scope-local ingest and retention statistics", () => {
    let at = 100;
    const store = createExecutionEvidenceStore({
      enabled: () => true,
      now: () => at,
      ttlMs: 10,
      capacity: 2,
    });
    store.recordFact(fact("a1"));
    store.recordFact({ ...fact("b1"), scope: { ...scope, tenantId: "other" } });
    const before = store.query(scope).scopeWatermark;
    expect(before).toMatchObject({
      state: "tracked",
      ingestSequence: 1,
      expiredCount: 0,
      capacityEvictedCount: 0,
      retainedFromSequence: 1,
      retainedToSequence: 1,
    });
    store.recordFact({ ...fact("b2"), scope: { ...scope, tenantId: "other" } });
    expect(store.query(scope).scopeWatermark).toMatchObject({
      ingestSequence: 1,
      expiredCount: 0,
      capacityEvictedCount: 1,
      retainedFromSequence: null,
      retainedToSequence: null,
    });
    at = 110;
    expect(store.query({ ...scope, tenantId: "other" }).scopeWatermark).toMatchObject({
      ingestSequence: 2,
      expiredCount: 2,
      capacityEvictedCount: 0,
    });
    expect(store.query(scope).scopeWatermark.expiredCount).toBe(0);
  });
  it("forgets bounded scope statistics without reporting false zero history", () => {
    const store = createExecutionEvidenceStore({
      enabled: () => true,
      now: () => 100,
      capacity: 1,
    });
    store.recordFact(fact("a"));
    const first = store.query(scope).scopeWatermark;
    store.recordFact({ ...fact("b"), scope: { ...scope, tenantId: "other" } });
    expect(store.query(scope).scopeWatermark).toMatchObject({
      state: "unknown",
      ingestSequence: null,
      expiredCount: null,
      capacityEvictedCount: null,
    });
    store.recordFact(fact("a2"));
    const resumed = store.query(scope).scopeWatermark;
    expect(resumed.trackingEpoch).not.toBe(first.trackingEpoch);
    expect(resumed.priorHistory).toBe("unknown");
    expect(store.query(scope).evictedCount).toBeNull();
  });
  it("defaults off and captures only whitelisted independent facts", () => {
    vi.stubEnv(EXECUTION_EVIDENCE_FLAG, "");
    expect(createExecutionEvidenceStore().recordFact(fact())).toBe(false);
    vi.unstubAllEnvs();
    const store = createExecutionEvidenceStore({ enabled: () => true, now: () => 100 });
    expect(store.recordLink(link())).toBe(false);
    expect(store.recordFact({ ...fact(), body: "SECRET" } as ReturnType<typeof fact>)).toBe(true);
    expect(store.recordLink(link())).toBe(true);
    expect(JSON.stringify(store.query(scope))).not.toContain("SECRET");
    expect(store.query({ ...scope, tenantId: "other" }).facts).toEqual([]);
    const result = store.query(scope);
    result.facts[0].scope.subjectRef = "changed";
    expect(store.query(scope).facts[0].scope.subjectRef).toBe("subject:a");
  });
  it("rejects missing and mismatched facts, conflicting versions and duplicate identities", () => {
    const store = createExecutionEvidenceStore({ enabled: () => true, now: () => 100 });
    store.recordFact(fact());
    expect(store.recordLink({ ...link(), runId: "other" })).toBe(false);
    expect(store.recordLink({ ...link(), eventIds: ["missing"] })).toBe(false);
    expect(store.recordLink({ ...link(), scope: { ...scope, tenantId: "other" } })).toBe(false);
    expect(store.recordLink(link())).toBe(true);
    expect(store.recordLink({ ...link(), outcomeVersion: 3 })).toBe(false);
    expect(store.query(scope).links).toEqual([]);
    expect(store.recordFact({ ...fact(), stage: "failed" })).toBe(false);
    expect(store.recordLink(link())).toBe(false);
  });
  it("expires sources and links with bounded retention and exposes unknown continuity", () => {
    let at = 100;
    const store = createExecutionEvidenceStore({
      enabled: () => true,
      now: () => at,
      ttlMs: 10,
      capacity: 1,
    });
    store.recordFact(fact());
    store.recordLink(link());
    store.recordFact(fact("e2"));
    expect(store.query(scope).links).toEqual([]);
    expect(store.query(scope).facts).toHaveLength(1);
    at = 110;
    expect(store.query(scope).facts).toEqual([]);
    expect(store.query(scope).reasons).toContain("retention_continuity_unknown");
    expect(store.query(scope).discardedThrough).toBeNull();
  });
  it("clears revoked observations, changes epoch and distinguishes process instances", () => {
    let enabled = true;
    const store = createExecutionEvidenceStore({ enabled: () => enabled, now: () => 100 });
    store.recordFact(fact());
    const first = store.query(scope);
    enabled = false;
    const revoked = store.query(scope);
    expect(revoked.epoch).not.toBe(first.epoch);
    expect(revoked.facts).toEqual([]);
    enabled = true;
    expect(store.query(scope).facts).toEqual([]);
    expect(createExecutionEvidenceStore().query(scope).processId).not.toBe(first.processId);
  });
  it("does not throw when clock or flag callbacks fail", () => {
    const store = createExecutionEvidenceStore({
      enabled: () => {
        throw new Error("flag");
      },
    });
    expect(store.recordFact(fact())).toBe(false);
    expect(() => store.query(scope)).not.toThrow();
    const badClock = createExecutionEvidenceStore({
      enabled: () => true,
      now: () => {
        throw new Error("clock");
      },
    });
    expect(badClock.recordFact(fact())).toBe(false);
    expect(badClock.recordLink(link())).toBe(false);
    expect(() => badClock.query(scope)).not.toThrow();
  });
});
