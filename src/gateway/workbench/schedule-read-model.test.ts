// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  buildWorkbenchSchedule,
  type WorkbenchScheduleCronJob,
  type WorkbenchScheduleEntry,
} from "./schedule-read-model.js";

const NOW = 1_700_000_000_000; // fixed "now" for deterministic windows
const MIN = 60 * 1000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

function cronJob(overrides: Partial<WorkbenchScheduleCronJob>): WorkbenchScheduleCronJob {
  return {
    id: overrides.id ?? "job-1",
    name: overrides.name ?? "Daily digest",
    enabled: overrides.enabled ?? true,
    agentId: overrides.agentId,
    schedule: overrides.schedule,
    state: overrides.state ?? { nextRunAtMs: NOW + HOUR },
    ownership: overrides.ownership,
  };
}

function entry(overrides: Partial<WorkbenchScheduleEntry>): WorkbenchScheduleEntry {
  return {
    id: overrides.id ?? "entry-1",
    ownerUserId: overrides.ownerUserId ?? "user-1",
    tenantId: overrides.tenantId,
    title: overrides.title ?? "Team sync",
    startAtMs: overrides.startAtMs ?? NOW + 2 * HOUR,
    endAtMs: overrides.endAtMs,
    timezone: overrides.timezone ?? "UTC",
    kind: overrides.kind ?? "personal",
    status: overrides.status ?? "confirmed",
    sourceRef: overrides.sourceRef ?? { kind: "manual", id: "m1" },
  };
}

describe("buildWorkbenchSchedule", () => {
  it("returns an empty projection when there are no entries and no cron jobs", async () => {
    const result = await buildWorkbenchSchedule({
      userId: "user-1",
      userEmail: "u1@example.com",
      deps: { now: () => NOW, listEntries: async () => [], listCronJobs: async () => [] },
    });
    expect(result).toEqual({
      todayCount: 0,
      upcomingCount: 0,
      cronDerivedCount: 0,
      nextStartAtMs: undefined,
      nextTitle: undefined,
      hasRealEntries: false,
      items: [],
    });
  });

  it("projects an actor-owned cron job (ownership.ownerId match) as a cron-derived entry", async () => {
    const result = await buildWorkbenchSchedule({
      userId: "user-1",
      userEmail: "u1@example.com",
      deps: {
        now: () => NOW,
        listEntries: async () => [],
        listCronJobs: async () => [
          cronJob({
            id: "j1",
            name: "Standup ping",
            ownership: { ownerId: "user-1" },
            state: { nextRunAtMs: NOW + 30 * MIN },
          }),
        ],
      },
    });
    expect(result.upcomingCount).toBe(1);
    expect(result.cronDerivedCount).toBe(1);
    expect(result.hasRealEntries).toBe(false);
    expect(result.todayCount).toBe(1);
    expect(result.nextStartAtMs).toBe(NOW + 30 * MIN);
    expect(result.nextTitle).toBe("Standup ping");
    expect(result.items[0]).toMatchObject({
      id: "cron:j1",
      kind: "cron-derived",
      cronDerived: true,
      startAtMs: NOW + 30 * MIN,
    });
  });

  it("projects a cron job whose agentId is visible to the actor (seat/owned agent)", async () => {
    const result = await buildWorkbenchSchedule({
      userId: "user-1",
      visibleAgentIds: ["bot-x"],
      deps: {
        now: () => NOW,
        listEntries: async () => [],
        listCronJobs: async () => [cronJob({ id: "j2", agentId: "bot-x" })],
      },
    });
    expect(result.cronDerivedCount).toBe(1);
    expect(result.items[0]?.id).toBe("cron:j2");
  });

  it("excludes platform-global cron jobs the actor neither owns nor can see", async () => {
    const result = await buildWorkbenchSchedule({
      userId: "user-1",
      userEmail: "u1@example.com",
      visibleAgentIds: ["bot-x"],
      deps: {
        now: () => NOW,
        listEntries: async () => [],
        listCronJobs: async () => [
          cronJob({ id: "foreign", agentId: "bot-other", ownership: { ownerId: "user-2" } }),
          cronJob({ id: "no-owner", agentId: undefined, ownership: undefined }),
        ],
      },
    });
    expect(result.upcomingCount).toBe(0);
    expect(result.items).toEqual([]);
  });

  it("enforces tenant isolation: a cron job from another tenant is never included", async () => {
    const result = await buildWorkbenchSchedule({
      userId: "user-1",
      tenantId: "tenant-a",
      visibleAgentIds: ["bot-x"],
      deps: {
        now: () => NOW,
        listEntries: async () => [],
        listCronJobs: async () => [
          // agentId would match, but the job is stamped for another tenant.
          cronJob({ id: "cross", agentId: "bot-x", ownership: { tenantId: "tenant-b" } }),
        ],
      },
    });
    expect(result.upcomingCount).toBe(0);
  });

  it("skips disabled cron jobs and runs outside the upcoming window", async () => {
    const result = await buildWorkbenchSchedule({
      userId: "user-1",
      deps: {
        now: () => NOW,
        listEntries: async () => [],
        listCronJobs: async () => [
          cronJob({ id: "disabled", ownership: { ownerId: "user-1" }, enabled: false }),
          cronJob({
            id: "past",
            ownership: { ownerId: "user-1" },
            state: { nextRunAtMs: NOW - HOUR },
          }),
          cronJob({
            id: "too-far",
            ownership: { ownerId: "user-1" },
            state: { nextRunAtMs: NOW + 30 * DAY },
          }),
        ],
      },
    });
    expect(result.upcomingCount).toBe(0);
  });

  it("merges real entries with cron-derived ones (double-track) and sorts by start time", async () => {
    const result = await buildWorkbenchSchedule({
      userId: "user-1",
      userEmail: "u1@example.com",
      deps: {
        now: () => NOW,
        listEntries: async () => [
          entry({ id: "real-late", startAtMs: NOW + 3 * HOUR, title: "Late meeting" }),
        ],
        listCronJobs: async () => [
          cronJob({
            id: "cron-early",
            name: "Early ping",
            ownership: { ownerId: "user-1" },
            state: { nextRunAtMs: NOW + 1 * HOUR },
          }),
        ],
      },
    });
    expect(result.upcomingCount).toBe(2);
    expect(result.cronDerivedCount).toBe(1);
    expect(result.hasRealEntries).toBe(true);
    // Sorted by startAtMs: cron (1h) before real (3h).
    expect(result.items.map((item) => item.id)).toEqual(["cron:cron-early", "real-late"]);
    expect(result.nextStartAtMs).toBe(NOW + 1 * HOUR);
    expect(result.nextTitle).toBe("Early ping");
  });

  it("defensively drops a real entry owned by a different user (store seam not trusted)", async () => {
    const result = await buildWorkbenchSchedule({
      userId: "user-1",
      userEmail: "u1@example.com",
      deps: {
        now: () => NOW,
        listEntries: async () => [
          entry({ id: "leak", ownerUserId: "user-2", startAtMs: NOW + HOUR }),
          entry({ id: "mine", ownerUserId: "user-1", startAtMs: NOW + 2 * HOUR }),
        ],
        listCronJobs: async () => [],
      },
    });
    expect(result.items.map((item) => item.id)).toEqual(["mine"]);
    expect(result.hasRealEntries).toBe(true);
  });

  it("excludes cancelled entries and entries that have already ended", async () => {
    const result = await buildWorkbenchSchedule({
      userId: "user-1",
      deps: {
        now: () => NOW,
        listEntries: async () => [
          entry({ id: "cancelled", startAtMs: NOW + HOUR, status: "cancelled" }),
          entry({ id: "ended", startAtMs: NOW - 2 * HOUR, endAtMs: NOW - HOUR }),
          entry({ id: "ongoing", startAtMs: NOW - 30 * MIN, endAtMs: NOW + 30 * MIN }),
        ],
        listCronJobs: async () => [],
      },
    });
    // cancelled + ended dropped; ongoing kept (not ended), but not "next" (started in past).
    expect(result.items.map((item) => item.id)).toEqual(["ongoing"]);
    expect(result.upcomingCount).toBe(1);
    expect(result.nextStartAtMs).toBeUndefined();
  });

  it("counts todayCount by actor-local natural day, not rolling 24h", async () => {
    // 23:00 Asia/Shanghai; 00:30 next local day must not count as today.
    const now = Date.parse("2026-07-30T15:00:00.000Z");
    const nextLocalMorning = Date.parse("2026-07-30T16:30:00.000Z");
    const result = await buildWorkbenchSchedule({
      userId: "user-1",
      timeZone: "Asia/Shanghai",
      deps: {
        now: () => now,
        listEntries: async () => [
          entry({
            id: "tonight",
            ownerUserId: "user-1",
            startAtMs: now + 10 * MIN,
            title: "Tonight",
          }),
          entry({
            id: "tomorrow-local",
            ownerUserId: "user-1",
            startAtMs: nextLocalMorning,
            title: "Tomorrow local",
          }),
        ],
        listCronJobs: async () => [],
      },
    });
    expect(result.upcomingCount).toBe(2);
    expect(result.todayCount).toBe(1);
  });
});
