import { describe, it, expect } from "vitest";
import { buildCapacitySnapshot, type CapacityInput } from "./capacity-snapshot.js";
const source = {
  scopeRef: "tenant",
  sampledAt: 100,
  provenance: "injected" as const,
  sourceRef: "fixture",
};
const base = (): CapacityInput => ({
  scopeRef: "tenant",
  projectedAt: 110,
  maxAgeMs: 20,
  registry: { ...source, state: "readable", complete: true, activeRuns: 2, staleRunCount: 0 },
  entitlement: { ...source, version: "snapshot-v1", maxConcurrentRuns: 5, mode: "block" },
});
describe("capacity evidence projection", () => {
  it("calculates only registered run headroom with a qualified denominator", () => {
    const r = buildCapacitySnapshot(base());
    expect(r.concurrency.remaining).toBe(3);
    expect(r.health.normal).toBeNull();
    expect(r.heartbeat.normal).toBeNull();
    expect(r.quota.remaining).toBeNull();
    expect(r.businessOutcome.state).toBe("unknown");
  });
  it.each(["missing", "corrupt"] as const)(
    "rejects %s registry rather than showing idle",
    (state) => {
      const i = base();
      i.registry!.state = state;
      expect(buildCapacitySnapshot(i).concurrency.remaining).toBeNull();
    },
  );
  it("rejects stale, cross-tenant, incomplete and overage sources", () => {
    for (const patch of [
      { sampledAt: 1 },
      { scopeRef: "other" },
      { complete: false },
      { staleRunCount: 1 },
      { activeRuns: NaN },
    ]) {
      const i = base();
      Object.assign(i.registry!, patch);
      expect(buildCapacitySnapshot(i).concurrency.remaining).toBeNull();
    }
    for (const patch of [
      { maxConcurrentRuns: 0 },
      { maxConcurrentRuns: Infinity },
      { mode: "pay_as_you_go" },
      { version: null },
      { provenance: "live" },
    ]) {
      const i = base();
      Object.assign(i.entitlement!, patch);
      expect(buildCapacitySnapshot(i).concurrency.remaining).toBeNull();
    }
  });
  it("does not turn heartbeat activity, skipped samples or registration health into normal", () => {
    const i = base();
    i.health = {
      ...source,
      kind: "registration_snapshot",
      continuous: false,
      expectedSamples: null,
      observedSamples: null,
    };
    i.heartbeat = {
      ...source,
      kind: "activity",
      continuous: true,
      expectedSamples: 2,
      observedSamples: 1,
    };
    const r = buildCapacitySnapshot(i);
    expect(r.health.coverage).toBeNull();
    expect(r.heartbeat.coverage).toBeNull();
    expect(r.health.normal).toBeNull();
  });
  it("rejects balance fallbacks and invalid quota denominators", () => {
    for (const patch of [
      { state: "fallback" },
      { allowance: 0 },
      { remaining: -1 },
      { periodRef: null },
      { scopeRef: "other" },
    ]) {
      const i = base();
      i.quota = {
        ...source,
        state: "authoritative",
        periodRef: "period",
        unit: "credits",
        remaining: 3,
        allowance: 10,
      };
      Object.assign(i.quota, patch);
      expect(buildCapacitySnapshot(i).quota.remaining).toBeNull();
    }
  });
  it("requires explicit clocks and never mutates input", () => {
    const i = base();
    const before = JSON.stringify(i);
    buildCapacitySnapshot(i);
    expect(JSON.stringify(i)).toBe(before);
    expect(() => buildCapacitySnapshot({ ...i, projectedAt: NaN })).toThrow();
  });
});
