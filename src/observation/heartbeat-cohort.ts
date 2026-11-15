/** First-screen heartbeat cohort: per-robot cadence, never a mixed-period tick mash. */
import { listAgentEntries, listAgentIds } from "../agents/agent-scope.js";
import type { OpenBotConfig } from "../config/config.js";
import { resolveHeartbeatIntervalMs } from "../infra/heartbeat-runner.js";
import { normalizeAgentId } from "../routing/session-key.js";
import { deriveHeartbeatSamples } from "./heartbeat-activity.js";

export type ScheduledHeartbeatRobot = {
  agentId: string;
  expectedPeriodMs: number;
  tenantId: string | null;
};

export type HeartbeatRobotObservation = ScheduledHeartbeatRobot & {
  expectedSamples: number | null;
  observedSamples: number | null;
  onCadence: boolean | null;
};

export type HeartbeatCohortRollup = {
  scheduledRobotCount: number;
  confirmedRobotCount: number;
  onCadenceRobotCount: number | null;
  expectedPeriodMs: number | null;
  expectedSamples: number | null;
  observedSamples: number | null;
  reasons: string[];
};

export type HeartbeatTenantRollup = HeartbeatCohortRollup & {
  tenantId: string;
};

export type HeartbeatActivityEvent = {
  ts: number;
  agentId?: string | null;
};

export function configuredAgentHeartbeatPeriodMs(
  cfg: OpenBotConfig,
  _agentId: string,
  heartbeat?: Parameters<typeof resolveHeartbeatIntervalMs>[2],
): number | null {
  const ms = resolveHeartbeatIntervalMs(cfg, undefined, heartbeat);
  return ms && ms > 0 ? ms : null;
}

function configuredTenantId(entry: {
  ownerType?: string;
  ownerId?: string;
}): string | null {
  if (entry.ownerType !== "tenant") {
    return null;
  }
  const id = typeof entry.ownerId === "string" ? entry.ownerId.trim() : "";
  return id || null;
}

export function listScheduledHeartbeatRobots(cfg: OpenBotConfig): ScheduledHeartbeatRobot[] {
  const entries = listAgentEntries(cfg);
  if (entries.length === 0) {
    const fallbackId = listAgentIds(cfg)[0] ?? "";
    const period = configuredAgentHeartbeatPeriodMs(cfg, fallbackId);
    return period
      ? [{ agentId: fallbackId, expectedPeriodMs: period, tenantId: null }]
      : [];
  }
  const seen = new Set<string>();
  const robots: ScheduledHeartbeatRobot[] = [];
  for (const entry of entries) {
    const raw = typeof entry.id === "string" ? entry.id.trim() : "";
    if (!raw) {
      continue;
    }
    const agentId = normalizeAgentId(raw);
    if (seen.has(agentId)) {
      continue;
    }
    seen.add(agentId);
    const period = configuredAgentHeartbeatPeriodMs(cfg, agentId, entry.heartbeat);
    if (!period) {
      continue;
    }
    robots.push({
      agentId,
      expectedPeriodMs: period,
      tenantId: configuredTenantId(entry),
    });
  }
  return robots;
}

export function eventAgentId(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const raw = value.trim();
  if (!raw) {
    return null;
  }
  return normalizeAgentId(raw);
}

function cadenceOf(expectedSamples: number | null, observedSamples: number | null): boolean | null {
  if (
    expectedSamples == null ||
    observedSamples == null ||
    !Number.isFinite(expectedSamples) ||
    !Number.isFinite(observedSamples) ||
    expectedSamples <= 0 ||
    observedSamples < 0
  ) {
    return null;
  }
  // First-screen cadence is observed >= expected. This is not the precise-query
  // complete-series gate (liveness_probe + continuous + expected >= 2 + equality).
  return observedSamples >= expectedSamples;
}

export function observeScheduledHeartbeatRobots(input: {
  cfg: OpenBotConfig;
  events: readonly HeartbeatActivityEvent[];
  from: number;
  to: number;
  collecting: boolean;
  collectionStartedAt: number | null;
  evictedCount: number;
  expiredCount: number;
}): { robots: HeartbeatRobotObservation[]; unattributedInWindow: number } {
  const robots = listScheduledHeartbeatRobots(input.cfg);
  const startCandidates = [input.from, input.collectionStartedAt].filter(
    (value): value is number => value != null && Number.isFinite(value),
  );
  const start = startCandidates.length ? Math.max(...startCandidates) : input.from;
  const windowEvents = input.events.filter(
    (event) => Number.isFinite(event.ts) && event.ts >= start && event.ts < input.to,
  );
  const unattributedInWindow = windowEvents.filter((event) => eventAgentId(event.agentId) == null)
    .length;
  return {
    unattributedInWindow,
    robots: robots.map((robot) => {
      const attributed = windowEvents.filter((event) => eventAgentId(event.agentId) === robot.agentId);
      const samples = deriveHeartbeatSamples({
        expectedPeriodMs: robot.expectedPeriodMs,
        events: attributed,
        from: input.from,
        to: input.to,
        collecting: input.collecting,
        collectionStartedAt: input.collectionStartedAt,
        evictedCount: input.evictedCount,
        expiredCount: input.expiredCount,
      });
      const onCadence = cadenceOf(samples.expectedSamples, samples.observedSamples);
      return {
        ...robot,
        expectedSamples: samples.expectedSamples,
        observedSamples: samples.observedSamples,
        // Unattributed window events can only raise the observed count, so a
        // confirmed hit still stands; a miss stays unconfirmed.
        onCadence: unattributedInWindow > 0 && onCadence !== true ? null : onCadence,
      };
    }),
  };
}

function uniquePositive(values: readonly (number | null | undefined)[]): number[] {
  return [
    ...new Set(
      values.filter(
        (value): value is number =>
          typeof value === "number" && Number.isFinite(value) && value > 0,
      ),
    ),
  ];
}

export function rollupHeartbeatCohort(
  robots: readonly HeartbeatRobotObservation[],
  options: { attributionIncomplete?: boolean; reasons?: readonly string[] } = {},
): HeartbeatCohortRollup {
  const reasons = new Set(options.reasons ?? []);
  const scheduledRobotCount = robots.length;
  if (scheduledRobotCount === 0) {
    reasons.add("expected_period_unknown");
    reasons.add("scheduled_cohort_empty");
    return {
      scheduledRobotCount: 0,
      confirmedRobotCount: 0,
      onCadenceRobotCount: null,
      expectedPeriodMs: null,
      expectedSamples: null,
      observedSamples: null,
      reasons: [...reasons],
    };
  }
  const confirmed = robots.filter((robot) => robot.onCadence !== null);
  if (options.attributionIncomplete) {
    reasons.add("event_agent_attribution_incomplete");
  }
  if (confirmed.length === 0) {
    reasons.add("cadence_denominator_unconfirmed");
    return {
      scheduledRobotCount,
      confirmedRobotCount: 0,
      onCadenceRobotCount: null,
      expectedPeriodMs: uniquePositive(robots.map((robot) => robot.expectedPeriodMs)).length === 1
        ? robots[0].expectedPeriodMs
        : null,
      expectedSamples: null,
      observedSamples: null,
      reasons: [...reasons],
    };
  }
  const onCadenceRobotCount = confirmed.filter((robot) => robot.onCadence === true).length;
  const periods = uniquePositive(confirmed.map((robot) => robot.expectedPeriodMs));
  const expectedPeriodMs = periods.length === 1 ? periods[0] : null;
  if (periods.length !== 1) {
    reasons.add("mixed_heartbeat_periods");
  }
  return {
    scheduledRobotCount,
    confirmedRobotCount: confirmed.length,
    onCadenceRobotCount,
    expectedPeriodMs,
    // Tick totals are only defined for a single-period confirmed cohort.
    expectedSamples:
      expectedPeriodMs == null
        ? null
        : confirmed.reduce((sum, robot) => sum + (robot.expectedSamples ?? 0), 0),
    observedSamples:
      expectedPeriodMs == null
        ? null
        : confirmed.reduce((sum, robot) => sum + (robot.observedSamples ?? 0), 0),
    reasons: [...reasons],
  };
}

export function rollupHeartbeatCohortByTenant(
  robots: readonly HeartbeatRobotObservation[],
  options: { attributionIncomplete?: boolean; reasons?: readonly string[] } = {},
): HeartbeatTenantRollup[] {
  const tenants = new Map<string, HeartbeatRobotObservation[]>();
  for (const robot of robots) {
    if (!robot.tenantId) {
      continue;
    }
    const bucket = tenants.get(robot.tenantId) ?? [];
    bucket.push(robot);
    tenants.set(robot.tenantId, bucket);
  }
  return [...tenants.keys()].toSorted().map((tenantId) => ({
    tenantId,
    ...rollupHeartbeatCohort(tenants.get(tenantId) ?? [], options),
  }));
}
