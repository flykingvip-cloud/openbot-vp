import { describe, expect, it } from "vitest";
import { acquireLease, releaseOwnedLease } from "./lease.js";
import { EMPTY_STORE } from "./monitor-store.js";

describe("media-monitor lease", () => {
  it("enforces single concurrent lease per target", () => {
    const data = structuredClone(EMPTY_STORE);
    const first = acquireLease({ data, targetId: "t1", owner: "a", now: 1_000 });
    expect(first.ok).toBe(true);
    const second = acquireLease({ data, targetId: "t1", owner: "b", now: 1_100 });
    expect(second.ok).toBe(false);
    if (!second.ok) {
      expect(second.reason).toBe("lease_held");
    }
    expect(releaseOwnedLease({ data, targetId: "t1", owner: "a" })).toBe(true);
    const third = acquireLease({ data, targetId: "t1", owner: "b", now: 1_200 });
    expect(third.ok).toBe(true);
  });

  it("allows takeover after expiry", () => {
    const data = structuredClone(EMPTY_STORE);
    acquireLease({
      data,
      targetId: "t1",
      owner: "a",
      now: 1_000,
      leaseMs: 100,
    });
    const next = acquireLease({
      data,
      targetId: "t1",
      owner: "b",
      now: 1_500,
      leaseMs: 100,
    });
    expect(next.ok).toBe(true);
  });
});
