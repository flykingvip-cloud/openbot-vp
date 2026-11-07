/** Passive platform activity only. No tenant attribution or liveness denominator. */
import { randomUUID } from "node:crypto";
import { onHeartbeatEvent, type HeartbeatEventPayload } from "../infra/heartbeat-events.js";
export const HEARTBEAT_ACTIVITY_FLAG = "OPENBOT_HEARTBEAT_ACTIVITY_OBSERVATION";
export function startHeartbeatActivity(
  options: {
    enabled?: () => boolean;
    now?: () => number;
    capacity?: number;
    ttlMs?: number;
    subscribe?: typeof onHeartbeatEvent;
  } = {},
) {
  const enabled =
    options.enabled ??
    (() => /^(1|true|yes|on)$/i.test(process.env[HEARTBEAT_ACTIVITY_FLAG]?.trim() ?? ""));
  const now = options.now ?? Date.now;
  const capacity = options.capacity ?? 1000;
  const ttlMs = options.ttlMs ?? 900000;
  if (!Number.isSafeInteger(capacity) || capacity < 1 || !Number.isFinite(ttlMs) || ttlMs <= 0) {
    throw new Error("invalid_retention");
  }
  const processId = randomUUID();
  let epoch = randomUUID();
  let stopped = false;
  let fault: "subscription_failed" | "collection_gap" | null = null;
  let unsub: (() => void) | undefined;
  const events: {
    sequence: number;
    ts: number;
    status: HeartbeatEventPayload["status"];
    durationMs: number | null;
    receivedAt: number;
  }[] = [];
  let sequence = 0;
  let evictedCount = 0;
  let expiredCount = 0;
  let discardedThrough: number | null = null;
  const discard = (reason: "capacity" | "ttl") => {
    const event = events.shift();
    if (event) {
      discardedThrough = Math.max(discardedThrough ?? -Infinity, event.ts);
      if (reason === "capacity") {
        evictedCount++;
      } else {
        expiredCount++;
      }
    }
  };
  const clear = () => {
    events.length = 0;
    sequence = 0;
    evictedCount = 0;
    expiredCount = 0;
    discardedThrough = null;
    epoch = randomUUID();
  };
  const active = () => {
    try {
      return !stopped && enabled();
    } catch {
      return false;
    }
  };
  const sweep = () => {
    const at = now();
    if (!Number.isFinite(at)) {
      throw new Error("invalid_clock");
    }
    while (events.length && at - events[0].receivedAt >= ttlMs) {
      discard("ttl");
    }
  };
  const suspend = () => {
    const hadSubscription = Boolean(unsub);
    const dispose = unsub;
    unsub = undefined;
    stopped = true;
    try {
      dispose?.();
    } catch {
      /* fail-safe shutdown */
    }
    if (hadSubscription || events.length) {
      clear();
    }
  };
  const receive = (event: HeartbeatEventPayload) => {
    try {
      if (!active()) {
        suspend();
        return;
      }
      sweep();
      if (
        !Number.isFinite(event.ts) ||
        event.ts > now() ||
        !["sent", "ok-empty", "ok-token", "skipped", "failed"].includes(event.status)
      ) {
        return;
      }
      events.push({
        sequence: ++sequence,
        ts: event.ts,
        status: event.status,
        durationMs:
          typeof event.durationMs === "number" &&
          Number.isFinite(event.durationMs) &&
          event.durationMs >= 0
            ? event.durationMs
            : null,
        receivedAt: now(),
      });
      while (events.length > capacity) {
        discard("capacity");
      }
    } catch {
      fault = "collection_gap";
      clear();
    }
  };
  const start = () => {
    if (unsub) {
      return;
    }
    stopped = false;
    try {
      if (active()) {
        unsub = (options.subscribe ?? onHeartbeatEvent)(receive);
        fault = null;
      }
    } catch {
      fault = "subscription_failed";
      clear();
    }
  };
  start();
  return {
    start,
    query() {
      try {
        if (!active()) {
          suspend();
        } else {
          sweep();
        }
      } catch {
        fault = "collection_gap";
        clear();
      }
      return {
        collectorState: fault ?? (unsub && active() ? "collecting" : "inactive"),
        processId,
        epoch,
        scope: "platform_only" as const,
        retention: "process_memory" as const,
        capacity,
        ttlMs,
        events: events.map(({ receivedAt: _receivedAt, ...event }) => event),
        evictedCount,
        expiredCount,
        discardedThrough,
        sourceWatermark: null,
        expectedPeriodMs: null,
        normal: null,
        uptime: null,
        reasons: [
          ...(fault ? [fault] : []),
          "heartbeat_activity_not_liveness",
          "tenant_attribution_unavailable",
          "expected_period_unknown",
          "retention_continuity_unknown",
          ...(active() ? [] : ["observation_disabled_or_stopped"]),
        ],
      };
    },
    stop() {
      if (stopped) {
        return;
      }
      stopped = true;
      try {
        unsub?.();
      } catch {
        // Listener disposal must not interfere with gateway shutdown.
      } finally {
        unsub = undefined;
        clear();
      }
    },
  };
}
