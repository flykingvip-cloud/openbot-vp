import { describe, it, expect, vi } from "vitest";
import { emitHeartbeatEvent } from "../infra/heartbeat-events.js";
import {
  deriveHeartbeatSamples,
  resolveConfiguredHeartbeatPeriodMs,
  startHeartbeatActivity,
  HEARTBEAT_ACTIVITY_FLAG,
} from "./heartbeat-activity.js";
describe("passive heartbeat activity", () => {
  it("reports subscription failure rather than collecting", () => {
    const handle = startHeartbeatActivity({
      enabled: () => true,
      subscribe: () => {
        throw new Error("failure");
      },
    });
    expect(handle.query().collectorState).toBe("subscription_failed");
    expect(handle.query().reasons).toContain("subscription_failed");
    expect(handle.query().uptime).toBeNull();
    handle.stop();
  });
  it("marks an exception-cleared history as a collection gap", () => {
    let at = 100;
    let listener:
      | Parameters<typeof import("../infra/heartbeat-events.js").onHeartbeatEvent>[0]
      | undefined;
    const handle = startHeartbeatActivity({
      enabled: () => true,
      now: () => at,
      subscribe: (fn) => {
        listener = fn;
        return () => {};
      },
    });
    listener!({ ts: 100, status: "sent" });
    expect(handle.query().events).toHaveLength(1);
    at = NaN;
    expect(handle.query().events).toEqual([]);
    at = 100;
    expect(handle.query().collectorState).toBe("collection_gap");
    expect(handle.query().reasons).toContain("collection_gap");
    expect(handle.query().normal).toBeNull();
    handle.stop();
  });
  it("unsubscribes on flag withdrawal and requires explicit restart", () => {
    let on = false;
    const dispose = vi.fn();
    const subscribe = vi.fn(() => dispose);
    const handle = startHeartbeatActivity({ enabled: () => on, subscribe });
    expect(subscribe).not.toHaveBeenCalled();
    on = true;
    handle.query();
    expect(subscribe).not.toHaveBeenCalled();
    handle.start();
    expect(subscribe).toHaveBeenCalledTimes(1);
    on = false;
    handle.query();
    expect(dispose).toHaveBeenCalledTimes(1);
    const epoch = handle.query().epoch;
    expect(handle.query().epoch).toBe(epoch);
    on = true;
    handle.query();
    expect(subscribe).toHaveBeenCalledTimes(1);
    handle.start();
    expect(subscribe).toHaveBeenCalledTimes(2);
    handle.stop();
  });
  it("contains subscription failures without starting a collector", () => {
    const handle = startHeartbeatActivity({
      enabled: () => true,
      subscribe: () => {
        throw new Error("subscribe");
      },
    });
    expect(handle.query().events).toEqual([]);
    expect(() => handle.stop()).not.toThrow();
  });
  it("starts and stops idempotently and contains disposal errors", () => {
    const dispose = vi.fn(() => {
      throw new Error("dispose");
    });
    const subscribe = vi.fn(() => dispose);
    const handle = startHeartbeatActivity({ enabled: () => true, subscribe });
    handle.start();
    handle.start();
    expect(subscribe).toHaveBeenCalledTimes(1);
    expect(() => handle.stop()).not.toThrow();
    handle.stop();
    expect(dispose).toHaveBeenCalledTimes(1);
    handle.start();
    expect(subscribe).toHaveBeenCalledTimes(2);
    handle.stop();
  });
  it("defaults off without subscribing or triggering heartbeats", () => {
    vi.stubEnv(HEARTBEAT_ACTIVITY_FLAG, "");
    const subscribe = vi.fn(() => () => {});
    const handle = startHeartbeatActivity({ subscribe });
    expect(subscribe).not.toHaveBeenCalled();
    expect(handle.query().events).toEqual([]);
    handle.stop();
    vi.unstubAllEnvs();
  });
  it("captures real bus events only as redacted platform activity and unsubscribes", () => {
    const handle = startHeartbeatActivity({ enabled: () => true });
    emitHeartbeatEvent({
      status: "sent",
      preview: "SECRET",
      to: "PRIVATE",
      accountId: "ACCOUNT",
      durationMs: 10,
    });
    const result = handle.query();
    expect(result.events).toHaveLength(1);
    expect(JSON.stringify(result)).not.toContain("SECRET");
    expect(JSON.stringify(result)).not.toContain("PRIVATE");
    expect(result.normal).toBeNull();
    expect(result.uptime).toBeNull();
    handle.stop();
    emitHeartbeatEvent({ status: "failed" });
    expect(handle.query().events).toEqual([]);
  });
  it("bounds retention with explicit capacity and TTL loss markers", () => {
    let at = 100;
    let listener: Parameters<
      NonNullable<NonNullable<Parameters<typeof startHeartbeatActivity>[0]>["subscribe"]>
    >[0];
    const handle = startHeartbeatActivity({
      enabled: () => true,
      now: () => at,
      capacity: 1,
      ttlMs: 10,
      subscribe: (fn) => {
        listener = fn;
        return () => {};
      },
    });
    listener!({ ts: 90, status: "skipped" });
    listener!({ ts: 95, status: "failed" });
    expect(handle.query().evictedCount).toBe(1);
    expect(handle.query().discardedThrough).toBe(90);
    at = 110;
    expect(handle.query().events).toEqual([]);
    expect(handle.query().expiredCount).toBe(1);
    handle.stop();
  });
  it("clears revoked observations and keeps failures outside the heartbeat emitter", () => {
    let on = true;
    let listener: ((event: { ts: number; status: "sent" }) => void) | undefined;
    const handle = startHeartbeatActivity({
      enabled: () => on,
      now: () => 100,
      subscribe: (fn) => {
        listener = fn;
        return () => {};
      },
    });
    listener!({ ts: 100, status: "sent" });
    const before = handle.query().epoch;
    on = false;
    expect(handle.query().events).toEqual([]);
    expect(handle.query().epoch).not.toBe(before);
    handle.stop();
  });
});

describe("deriveHeartbeatSamples", () => {
  it("leaves the ratio unknown without a period, or when collection did not cover the window", () => {
    expect(
      deriveHeartbeatSamples({
        expectedPeriodMs: null,
        events: [{ ts: 100 }],
        from: 0,
        to: 400,
        collecting: true,
        collectionStartedAt: 0,
        evictedCount: 0,
        expiredCount: 0,
      }).expectedSamples,
    ).toBeNull();
    expect(
      deriveHeartbeatSamples({
        expectedPeriodMs: 100,
        events: [],
        from: 0,
        to: 400,
        collecting: false,
        collectionStartedAt: 0,
        evictedCount: 0,
        expiredCount: 0,
      }).observedSamples,
    ).toBeNull();
    expect(
      deriveHeartbeatSamples({
        expectedPeriodMs: 100,
        events: [{ ts: 50 }],
        from: 0,
        to: 400,
        collecting: true,
        collectionStartedAt: 0,
        evictedCount: 1,
        expiredCount: 0,
      }).expectedSamples,
    ).toBeNull();
  });

  it("counts expected and observed samples only when the period and retained window are known", () => {
    const result = deriveHeartbeatSamples({
      expectedPeriodMs: 100,
      events: [{ ts: 10 }, { ts: 110 }, { ts: 210 }],
      from: 0,
      to: 400,
      collecting: true,
      collectionStartedAt: 0,
      evictedCount: 0,
      expiredCount: 0,
    });
    expect(result).toMatchObject({ expectedPeriodMs: 100, expectedSamples: 4, observedSamples: 3 });
  });
});

describe("resolveConfiguredHeartbeatPeriodMs", () => {
  it("returns a period only when every configured agent shares one positive interval", () => {
    expect(resolveConfiguredHeartbeatPeriodMs({})).toBeNull();
    expect(
      resolveConfiguredHeartbeatPeriodMs({
        agents: { defaults: { heartbeat: { every: "2m" } }, list: [{ id: "a" }, { id: "b" }] },
      }),
    ).toBe(120000);
    expect(
      resolveConfiguredHeartbeatPeriodMs({
        agents: {
          defaults: { heartbeat: { every: "2m" } },
          list: [{ id: "a", heartbeat: { every: "2m" } }, { id: "b", heartbeat: { every: "1m" } }],
        },
      }),
    ).toBeNull();
  });
});

describe("heartbeat activity period query", () => {
  it("fills expected and observed samples when the runner period is known", () => {
    let at = 1000;
    let listener: ((event: { ts: number; status: "sent" }) => void) | undefined;
    const handle = startHeartbeatActivity({
      enabled: () => true,
      now: () => at,
      ttlMs: 10_000,
      resolveExpectedPeriodMs: () => 1000,
      subscribe: (fn) => {
        listener = fn;
        return () => {};
      },
    });
    listener!({ ts: 1000, status: "sent" });
    at = 5000;
    const result = handle.query();
    expect(result.expectedPeriodMs).toBe(1000);
    expect(result.expectedSamples).toBe(4);
    expect(result.observedSamples).toBe(1);
    handle.stop();
  });
});
