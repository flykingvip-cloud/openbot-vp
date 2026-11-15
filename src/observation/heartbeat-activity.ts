/** Passive platform activity. Liveness denominators appear only when a period is known. */
import { randomUUID } from "node:crypto";
import { listAgentEntries } from "../agents/agent-scope.js";
import { normalizeAgentId } from "../routing/session-key.js";
import type { OpenBotConfig } from "../config/config.js";
import { onHeartbeatEvent, type HeartbeatEventPayload } from "../infra/heartbeat-events.js";
import { resolveHeartbeatIntervalMs } from "../infra/heartbeat-runner.js";
export const HEARTBEAT_ACTIVITY_FLAG = "OPENBOT_HEARTBEAT_ACTIVITY_OBSERVATION";

export function resolveConfiguredHeartbeatPeriodMs(cfg: OpenBotConfig): number | null {
  const entries = listAgentEntries(cfg);
  const positive = new Set<number>();
  if (entries.length === 0) {
    const ms = resolveHeartbeatIntervalMs(cfg);
    return ms && ms > 0 ? ms : null;
  }
  for (const entry of entries) {
    const ms = resolveHeartbeatIntervalMs(cfg, undefined, entry.heartbeat);
    if (ms && ms > 0) {
      // Event-only / 0m neighbors must not zero out a scheduled cohort.
      positive.add(ms);
    }
  }
  const unique = [...positive];
  // A ratio needs one shared positive interval; mixed positive periods stay unknown.
  return unique.length === 1 ? unique[0] : null;
}

export function deriveHeartbeatSamples(input: {
  expectedPeriodMs: number | null | undefined;
  events: readonly { ts: number }[];
  from: number;
  to: number;
  collecting: boolean;
  collectionStartedAt: number | null;
  evictedCount: number;
  expiredCount: number;
}): {
  expectedPeriodMs: number | null;
  expectedSamples: number | null;
  observedSamples: number | null;
  reasons: string[];
} {
  const reasons: string[] = ["heartbeat_activity_not_liveness", "tenant_attribution_unavailable"];
  const period =
    typeof input.expectedPeriodMs === "number" &&
    Number.isFinite(input.expectedPeriodMs) &&
    input.expectedPeriodMs > 0
      ? input.expectedPeriodMs
      : null;
  if (!period) {
    reasons.push("expected_period_unknown");
    return { expectedPeriodMs: null, expectedSamples: null, observedSamples: null, reasons };
  }
  if (!input.collecting) {
    reasons.push("observation_disabled_or_stopped");
    return { expectedPeriodMs: period, expectedSamples: null, observedSamples: null, reasons };
  }
  if (input.evictedCount > 0 || input.expiredCount > 0) {
    reasons.push("retention_continuity_unknown");
    return { expectedPeriodMs: period, expectedSamples: null, observedSamples: null, reasons };
  }
  if (
    ![input.from, input.to].every(Number.isFinite) ||
    input.from >= input.to ||
    input.collectionStartedAt == null ||
    !Number.isFinite(input.collectionStartedAt)
  ) {
    reasons.push("expected_period_unknown");
    return { expectedPeriodMs: period, expectedSamples: null, observedSamples: null, reasons };
  }
  const start = Math.max(input.from, input.collectionStartedAt);
  if (input.to <= start) {
    return { expectedPeriodMs: period, expectedSamples: null, observedSamples: null, reasons };
  }
  const expectedSamples = Math.floor((input.to - start) / period);
  if (expectedSamples <= 0) {
    return { expectedPeriodMs: period, expectedSamples: null, observedSamples: null, reasons };
  }
  const observedSamples = input.events.filter((event) => event.ts >= start && event.ts < input.to)
    .length;
  return { expectedPeriodMs: period, expectedSamples, observedSamples, reasons };
}

export function startHeartbeatActivity(
  options: {
    enabled?: () => boolean;
    now?: () => number;
    capacity?: number;
    ttlMs?: number;
    subscribe?: typeof onHeartbeatEvent;
    resolveExpectedPeriodMs?: () => number | null;
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
    agentId: string | null;
  }[] = [];
  let sequence = 0;
  let evictedCount = 0;
  let expiredCount = 0;
  let discardedThrough: number | null = null;
  let collectionStartedAt: number | null = null;
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
    collectionStartedAt = null;
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
      const rawAgentId = typeof event.agentId === "string" ? event.agentId.trim() : "";
      const agentId = rawAgentId ? normalizeAgentId(rawAgentId) : null;
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
        agentId,
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
        collectionStartedAt = now();
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
      const collecting = Boolean(unsub && active() && !fault);
      let expectedPeriodMs: number | null = null;
      try {
        expectedPeriodMs = options.resolveExpectedPeriodMs?.() ?? null;
      } catch {
        expectedPeriodMs = null;
      }
      const at = now();
      const retainedFrom =
        collectionStartedAt != null
          ? Math.max(at - ttlMs, collectionStartedAt)
          : at - ttlMs;
      const samples = deriveHeartbeatSamples({
        expectedPeriodMs,
        events,
        from: Number.isFinite(retainedFrom) ? retainedFrom : at,
        to: Number.isFinite(at) ? at : 0,
        collecting,
        collectionStartedAt,
        evictedCount,
        expiredCount,
      });
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
        expectedPeriodMs: samples.expectedPeriodMs,
        expectedSamples: samples.expectedSamples,
        observedSamples: samples.observedSamples,
        collectionStartedAt,
        normal: null,
        uptime: null,
        reasons: [
          ...new Set([
            ...(fault ? [fault] : []),
            ...samples.reasons,
            ...(samples.expectedSamples == null ? ["retention_continuity_unknown"] : []),
            ...(active() ? [] : ["observation_disabled_or_stopped"]),
          ]),
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
