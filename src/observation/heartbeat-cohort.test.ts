import { describe, expect, it } from "vitest";
import type { OpenBotConfig } from "../config/config.js";
import {
  listScheduledHeartbeatRobots,
  observeScheduledHeartbeatRobots,
  rollupHeartbeatCohort,
  rollupHeartbeatCohortByTenant,
} from "./heartbeat-cohort.js";

const window = {
  from: 0,
  to: 400,
  collecting: true,
  collectionStartedAt: 0,
  evictedCount: 0,
  expiredCount: 0,
};

describe("listScheduledHeartbeatRobots", () => {
  it("resolves a positive period per robot and excludes 0m and event-only neighbors", () => {
    expect(listScheduledHeartbeatRobots({})).toEqual([]);
    expect(
      listScheduledHeartbeatRobots({
        agents: { defaults: { heartbeat: { every: "0m" } }, list: [{ id: "a" }, { id: "b" }] },
      }),
    ).toEqual([]);
    expect(
      listScheduledHeartbeatRobots({
        agents: {
          defaults: { heartbeat: { every: "0m" } },
          list: [
            { id: "scheduled", heartbeat: { every: "2m" } },
            { id: "event-only", heartbeat: { every: "0m" } },
          ],
        },
      }),
    ).toEqual([{ agentId: "scheduled", expectedPeriodMs: 120_000, tenantId: null }]);
    const mixed = listScheduledHeartbeatRobots({
      agents: {
        list: [
          { id: "fast", heartbeat: { every: "1m" } },
          { id: "slow", heartbeat: { every: "2m" } },
        ],
      },
    });
    expect(mixed).toEqual([
      { agentId: "fast", expectedPeriodMs: 60_000, tenantId: null },
      { agentId: "slow", expectedPeriodMs: 120_000, tenantId: null },
    ]);
  });

  it("does not invent tenant attribution unless the agent is configured for a tenant owner", () => {
    expect(
      listScheduledHeartbeatRobots({
        agents: {
          list: [
            { id: "owned", heartbeat: { every: "1m" }, ownerType: "tenant", ownerId: "tenant-a" },
            {
              id: "platform-owned",
              heartbeat: { every: "1m" },
              ownerType: "platform",
              ownerId: "tenant-a",
            },
            { id: "plain", heartbeat: { every: "1m" } },
          ],
        },
      } as OpenBotConfig),
    ).toEqual([
      { agentId: "owned", expectedPeriodMs: 60_000, tenantId: "tenant-a" },
      { agentId: "platform-owned", expectedPeriodMs: 60_000, tenantId: null },
      { agentId: "plain", expectedPeriodMs: 60_000, tenantId: null },
    ]);
  });
});

describe("observeScheduledHeartbeatRobots and rollupHeartbeatCohort", () => {
  const cfg: OpenBotConfig = {
    agents: {
      list: [
        { id: "fast", heartbeat: { every: "100ms" } },
        { id: "slow", heartbeat: { every: "200ms" } },
        { id: "idle", heartbeat: { every: "0m" } },
      ],
    },
  };

  it("computes expected and observed samples per robot without mashing mixed periods", () => {
    const { robots, unattributedInWindow } = observeScheduledHeartbeatRobots({
      cfg,
      events: [
        { ts: 10, agentId: "fast" },
        { ts: 110, agentId: "fast" },
        { ts: 210, agentId: "fast" },
        { ts: 220, agentId: "fast" },
        { ts: 50, agentId: "slow" },
        { ts: 300, agentId: "idle" },
      ],
      ...window,
    });
    expect(unattributedInWindow).toBe(0);
    expect(robots.map((row) => row.agentId)).toEqual(["fast", "slow"]);
    expect(robots[0]).toMatchObject({
      expectedPeriodMs: 100,
      expectedSamples: 4,
      observedSamples: 4,
      onCadence: true,
    });
    expect(robots[1]).toMatchObject({
      expectedPeriodMs: 200,
      expectedSamples: 2,
      observedSamples: 1,
      onCadence: false,
    });
    const rollup = rollupHeartbeatCohort(robots);
    expect(rollup.onCadenceRobotCount).toBe(1);
    expect(rollup.confirmedRobotCount).toBe(2);
    expect(rollup.scheduledRobotCount).toBe(2);
    expect(rollup.expectedSamples).toBeNull();
    expect(rollup.observedSamples).toBeNull();
    expect(rollup.expectedPeriodMs).toBeNull();
    expect(rollup.reasons).toContain("mixed_heartbeat_periods");
  });

  it("keeps an empty scheduled cohort unknown rather than 0%", () => {
    const { robots } = observeScheduledHeartbeatRobots({
      cfg: { agents: { list: [{ id: "event-only", heartbeat: { every: "0m" } }] } },
      events: [{ ts: 10, agentId: "event-only" }],
      ...window,
    });
    expect(robots).toEqual([]);
    const rollup = rollupHeartbeatCohort(robots);
    expect(rollup.scheduledRobotCount).toBe(0);
    expect(rollup.onCadenceRobotCount).toBeNull();
    expect(rollup.expectedSamples).toBeNull();
    expect(rollup.reasons).toContain("scheduled_cohort_empty");
    expect(JSON.stringify(rollup)).not.toContain("0%");
  });

  it("reports 0 on cadence out of a confirmed scheduled cohort", () => {
    const { robots } = observeScheduledHeartbeatRobots({
      cfg: { agents: { list: [{ id: "fast", heartbeat: { every: "100ms" } }] } },
      events: [],
      ...window,
    });
    const rollup = rollupHeartbeatCohort(robots);
    expect(rollup).toMatchObject({
      scheduledRobotCount: 1,
      confirmedRobotCount: 1,
      onCadenceRobotCount: 0,
      expectedPeriodMs: 100,
      expectedSamples: 4,
      observedSamples: 0,
    });
  });

  it("does not treat unattributed events as a confirmed miss, and does not invent tenants", () => {
    const { robots, unattributedInWindow } = observeScheduledHeartbeatRobots({
      cfg,
      events: [{ ts: 10 }, { ts: 110, agentId: "fast" }],
      ...window,
    });
    expect(unattributedInWindow).toBe(1);
    expect(robots[0]?.onCadence).toBeNull();
    expect(robots[1]?.onCadence).toBeNull();
    const rollup = rollupHeartbeatCohort(robots, { attributionIncomplete: true });
    expect(rollup.onCadenceRobotCount).toBeNull();
    expect(rollup.reasons).toContain("event_agent_attribution_incomplete");
    expect(rollupHeartbeatCohortByTenant(robots)).toEqual([]);
  });

  it("rolls up a tenant cohort only from honestly attributed robots", () => {
    const { robots } = observeScheduledHeartbeatRobots({
      cfg: {
        agents: {
          list: [
            {
              id: "a",
              heartbeat: { every: "100ms" },
              ownerType: "tenant",
              ownerId: "tenant-a",
            },
            {
              id: "b",
              heartbeat: { every: "100ms" },
              ownerType: "tenant",
              ownerId: "tenant-a",
            },
            { id: "c", heartbeat: { every: "100ms" } },
          ],
        },
      } as OpenBotConfig,
      events: [
        { ts: 10, agentId: "a" },
        { ts: 110, agentId: "a" },
        { ts: 210, agentId: "a" },
        { ts: 310, agentId: "a" },
        { ts: 10, agentId: "b" },
        { ts: 10, agentId: "c" },
      ],
      ...window,
    });
    const tenants = rollupHeartbeatCohortByTenant(robots);
    expect(tenants).toHaveLength(1);
    expect(tenants[0]?.tenantId).toBe("tenant-a");
    expect(tenants[0]?.onCadenceRobotCount).toBe(1);
    expect(tenants[0]?.confirmedRobotCount).toBe(2);
    expect(tenants[0]?.expectedPeriodMs).toBe(100);
    expect(tenants[0]?.expectedSamples).toBe(8);
    expect(tenants[0]?.observedSamples).toBe(5);
    expect(rollupHeartbeatCohort(robots).onCadenceRobotCount).toBe(1);
  });
});
