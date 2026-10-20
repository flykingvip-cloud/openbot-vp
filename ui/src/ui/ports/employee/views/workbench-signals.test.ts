import { describe, expect, it } from "vitest";
import { isFreshEmployeeWorkbenchSurface } from "./workbench-home-model.ts";
import { buildWorkbenchSignalBundle } from "./workbench-signals.ts";

describe("buildWorkbenchSignalBundle", () => {
  it("returns two fresh-surface cards for new employees", () => {
    const bundle = buildWorkbenchSignalBundle({
      cronLabel: "common.na",
      sessionCount: 1,
      contactsCount: 0,
      agentsCount: 1,
      groupsCount: 0,
      activeAccounts: 3,
      onlineInstances: 3,
      connected: true,
      lastError: null,
      freshSurface: true,
    });
    expect(bundle.cards).toHaveLength(2);
    expect(bundle.cards.every((card) => (card.badgeCount ?? 0) === 0)).toBe(true);
    expect(bundle.cards[0]?.key).toBe("schedule");
    expect(bundle.cards[1]?.key).toBe("todos");
  });

  it("surfaces collaboration invites even when freshSurface is true", () => {
    const bundle = buildWorkbenchSignalBundle({
      cronLabel: "common.na",
      sessionCount: 1,
      contactsCount: 0,
      agentsCount: 1,
      groupsCount: 0,
      activeAccounts: 1,
      onlineInstances: 1,
      connected: true,
      lastError: null,
      freshSurface: true,
      pendingTasks: {
        totalCount: 1,
        taskCount: 0,
        ackRequiredCount: 0,
        governanceCount: 0,
        inviteCount: 1,
        items: [{ id: "invite:human:grp-x:ceo@example.com", title: "收到王军发来的协作邀请" }],
      },
    });
    const todos = bundle.cards.find((card) => card.key === "todos");
    expect(todos?.badgeCount).toBe(1);
    expect(todos?.entries?.map((entry) => entry.id)).toEqual([
      "invite:human:grp-x:ceo@example.com",
    ]);
  });
});

describe("buildWorkbenchSignalBundle schedule card (Phase A0)", () => {
  function baseInput() {
    return {
      cronLabel: "CRON_FALLBACK",
      sessionCount: 7,
      contactsCount: 2,
      agentsCount: 3,
      groupsCount: 1,
      activeAccounts: 2,
      onlineInstances: 2,
      connected: true,
      lastError: null,
      freshSurface: false,
    };
  }

  it("prefers the server schedule projection when it has upcoming items", () => {
    const bundle = buildWorkbenchSignalBundle({
      ...baseInput(),
      schedule: {
        todayCount: 2,
        upcomingCount: 3,
        cronDerivedCount: 1,
        nextStartAtMs: 1_700_000_000_000,
        hasRealEntries: true,
      },
      scheduleNextLabel: "SCHEDULE_NEXT",
    });
    const card = bundle.cards[0];
    expect(card?.key).toBe("schedule");
    expect(card?.badgeCount).toBe(3);
    expect(card?.items[0]).toContain("SCHEDULE_NEXT");
    expect(card?.items[0]).not.toContain("CRON_FALLBACK");
  });

  it("falls back to cronLabel + sessionCount when no schedule is present", () => {
    const bundle = buildWorkbenchSignalBundle({ ...baseInput() });
    const card = bundle.cards[0];
    expect(card?.key).toBe("schedule");
    expect(card?.badgeCount).toBe(7);
    expect(card?.items[0]).toContain("CRON_FALLBACK");
  });

  it("falls back when a schedule object is present but empty", () => {
    const bundle = buildWorkbenchSignalBundle({
      ...baseInput(),
      schedule: {
        todayCount: 0,
        upcomingCount: 0,
        cronDerivedCount: 0,
        hasRealEntries: false,
      },
      scheduleNextLabel: null,
    });
    const card = bundle.cards[0];
    expect(card?.badgeCount).toBe(7);
    expect(card?.items[0]).toContain("CRON_FALLBACK");
  });

  it("uses the upcoming count for the badge but keeps the cron label when no next-label is computed", () => {
    const bundle = buildWorkbenchSignalBundle({
      ...baseInput(),
      schedule: {
        todayCount: 1,
        upcomingCount: 2,
        cronDerivedCount: 2,
        nextStartAtMs: 1_700_000_000_000,
        hasRealEntries: false,
      },
    });
    const card = bundle.cards[0];
    expect(card?.badgeCount).toBe(2);
    expect(card?.items[0]).toContain("CRON_FALLBACK");
  });

  it("does not interpolate a dotted i18n key into the schedule primary line", () => {
    const bundle = buildWorkbenchSignalBundle({
      ...baseInput(),
      cronLabel: "frontstage.workbench.cards.cronMinutes",
    });
    expect(bundle.cards[0]?.items[0]).not.toContain("frontstage.workbench.cards.cronMinutes");
    expect(bundle.cards[0]?.items[0]).not.toContain("automation signal");
    expect(bundle.cards[0]?.items[0]).not.toContain("自动化信号");
  });
});

describe("buildWorkbenchSignalBundle todos card (merged action queue)", () => {
  function baseInput() {
    return {
      cronLabel: "CRON_FALLBACK",
      sessionCount: 7,
      contactsCount: 2,
      agentsCount: 3,
      groupsCount: 1,
      activeAccounts: 2,
      onlineInstances: 2,
      connected: true,
      lastError: null,
      freshSurface: false,
    };
  }

  it("merges pending-task, collaboration, and meeting-notice items into todos", () => {
    const bundle = buildWorkbenchSignalBundle({
      ...baseInput(),
      pendingTasks: {
        totalCount: 1,
        taskCount: 1,
        ackRequiredCount: 0,
        governanceCount: 0,
        inviteCount: 0,
        items: [{ id: "task:1", title: "审批预算" }],
      },
      upcomingCollaboration: {
        needsResponseCount: 1,
        decisionCount: 1,
        reviewCount: 0,
        activeCount: 0,
        items: [{ id: "g1", title: "产品组", meta: "等待你的决策" }],
      },
      notices: {
        conflictCount: 3,
        attentionCount: 0,
        meetingInviteReviewCount: 2,
        meetingMinutesConfirmCount: 0,
        items: [
          { id: "governance:conflict", kind: "governance-conflict", count: 3 },
          { id: "meeting:invite-review", kind: "meeting-invite-review", count: 2 },
        ],
      },
    });
    expect(bundle.cards).toHaveLength(2);
    expect(bundle.cards.map((card) => card.key)).toEqual(["schedule", "todos"]);

    const todos = bundle.cards.find((card) => card.key === "todos");
    // badge = pending(1) + collab(1) + meetingReview(2) + knowledge(3)
    expect(todos?.badgeCount).toBe(7);
    expect(todos?.entries).toEqual([
      { id: "task:1", title: "审批预算", origin: "task" },
      { id: "g1", title: "产品组", meta: "等待你的决策", origin: "collaboration" },
      {
        id: "meeting:invite-review",
        title: "Meeting invites to review",
        meta: "2",
        origin: "meeting-notice",
      },
      {
        id: "governance:conflict",
        title: "3 knowledge conflicts to resolve",
        origin: "knowledge",
      },
    ]);
  });
});

describe("isFreshEmployeeWorkbenchSurface", () => {
  it("treats unacknowledged guide as fresh surface", () => {
    expect(
      isFreshEmployeeWorkbenchSurface({
        contactsCount: 2,
        groupsCount: 1,
        agentsCount: 2,
        guideAcknowledged: false,
      }),
    ).toBe(true);
  });

  it("treats empty post-guide workspace as fresh surface", () => {
    expect(
      isFreshEmployeeWorkbenchSurface({
        contactsCount: 0,
        groupsCount: 0,
        agentsCount: 1,
        guideAcknowledged: true,
      }),
    ).toBe(true);
  });
});

describe("schedule and todos priority helpers", () => {
  it("sortTodosEntriesByUrgency puts meeting-notice before collaboration", async () => {
    const { sortTodosEntriesByUrgency } = await import("./workbench-signals.ts");
    const sorted = sortTodosEntriesByUrgency([
      { id: "g1", title: "Group", origin: "collaboration" },
      { id: "m1", title: "Meeting", origin: "meeting-notice" },
      { id: "k1", title: "Conflicts", origin: "knowledge" },
      { id: "task:1", title: "Task", origin: "task" },
    ]);
    expect(sorted.map((entry) => entry.id)).toEqual(["m1", "k1", "task:1", "g1"]);
  });

  it("resolveWorkbenchSignalsNextUp prefers soon schedule", async () => {
    const { resolveWorkbenchSignalsNextUp } = await import("./workbench-signals.ts");
    const now = 1_700_000_000_000;
    const next = resolveWorkbenchSignalsNextUp({
      scheduleItems: [
        {
          id: "soon",
          title: "Standup",
          startAtMs: now + 20 * 60_000,
          kind: "personal",
          cronDerived: false,
        },
      ],
      todosEntries: [{ id: "task:1", title: "Task", origin: "task" }],
      todosBadgeCount: 3,
      nowMs: now,
    });
    expect(next).toMatchObject({ kind: "schedule", entryId: "soon" });
  });

  it("partitionAndSortScheduleItems separates past items", async () => {
    const { partitionAndSortScheduleItems } = await import("./workbench-signals.ts");
    const now = 1_700_000_000_000;
    const { upcoming, past } = partitionAndSortScheduleItems(
      [
        {
          id: "old",
          title: "Old",
          startAtMs: now - 2 * 60 * 60_000,
          kind: "personal",
          cronDerived: false,
        },
        {
          id: "soon",
          title: "Soon",
          startAtMs: now + 60_000,
          kind: "personal",
          cronDerived: false,
        },
      ],
      now,
    );
    expect(upcoming.map((item) => item.id)).toEqual(["soon"]);
    expect(past.map((item) => item.id)).toEqual(["old"]);
  });
});
