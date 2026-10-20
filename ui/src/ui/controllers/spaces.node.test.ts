import { describe, expect, it, vi } from "vitest";
import type { GatewayBrowserClient } from "../gateway.ts";
import {
  cancelWorkbenchScheduleEntry,
  leaveWorkbenchSpace,
  loadWorkbenchSpaces,
  refreshWorkbenchSignals,
  resetWorkbenchSpace,
  dissolveWorkbenchSpace,
  resolveWorkbenchScheduleListParams,
  transferWorkbenchSpaceOwnership,
  updateWorkbenchSpaceMembers,
  upsertWorkbenchScheduleEntry,
  type WorkbenchSpacesState,
} from "./spaces.ts";

function createState(
  requestImpl?: (method: string, params: unknown) => Promise<unknown>,
): WorkbenchSpacesState & {
  request: ReturnType<typeof vi.fn>;
  sessionsLoading: boolean;
  sessionsResult: { sessions: unknown[] } | null;
  sessionsError: string | null;
  sessionsFilterActive: string;
  sessionsFilterLimit: string;
  sessionsIncludeGlobal: boolean;
  sessionsIncludeUnknown: boolean;
} {
  const request = vi.fn(requestImpl);
  return {
    client: { request } as unknown as GatewayBrowserClient,
    request,
    connected: true,
    collaborationSpacesLoading: false,
    collaborationSpacesResult: { spaces: [] },
    collaborationSpacesError: null,
    sessionsLoading: false,
    sessionsResult: { sessions: [] },
    sessionsError: null,
    sessionsFilterActive: "0",
    sessionsFilterLimit: "0",
    sessionsIncludeGlobal: true,
    sessionsIncludeUnknown: true,
  };
}

/** Default tail RPCs for `refreshWorkbenchSignals` (+ meeting sync). */
function refreshTailStub(method: string): unknown {
  if (method === "workbench.schedule.list") {
    return {
      todayCount: 0,
      upcomingCount: 0,
      cronDerivedCount: 0,
      hasRealEntries: false,
      items: [],
    };
  }
  if (method === "workbench.steward-suggestion.get") {
    return { suggestion: null };
  }
  if (method === "workbench.my-tasks.list") {
    return {
      totalCount: 0,
      cronCount: 0,
      supervisedCount: 0,
      assignedCount: 0,
      cronJobs: [],
      supervisedTasks: [],
      assignedTasks: [],
    };
  }
  if (method === "meeting.list") {
    return { meetings: [] };
  }
  return null;
}

describe("spaces controller", () => {
  it("loads collaboration.spaces.list into state", async () => {
    const state = createState(async (method) => {
      expect(method).toBe("collaboration.spaces.list");
      return {
        spaces: [{ id: "grp_product", groupId: "grp_product", title: "Aegis" }],
      };
    });

    await loadWorkbenchSpaces(state);

    expect(state.collaborationSpacesResult).toEqual({
      spaces: [{ id: "grp_product", groupId: "grp_product", title: "Aegis" }],
    });
  });

  it("persists members then reloads collaboration.spaces.list", async () => {
    const state = createState(async (method) => {
      if (method === "collaboration.spaces.members.update") {
        return { ok: true };
      }
      if (method === "collaboration.spaces.list") {
        return {
          spaces: [{ id: "grp_product", groupId: "grp_product", title: "Aegis" }],
        };
      }
      throw new Error(`unexpected method: ${method}`);
    });
    const { request } = state;
    await updateWorkbenchSpaceMembers(state, {
      groupId: "grp_product",
      title: "Aegis",
      avatar: "🛰️",
      members: {
        humans: [{ userId: "user-1", name: "UPBEYOND" }],
        bots: [{ agentId: "aegis", name: "大白管家" }],
      },
      invites: {
        humans: [{ userId: "user-2", name: "Alice" }],
      },
    });

    expect(request).toHaveBeenNthCalledWith(1, "collaboration.spaces.members.update", {
      groupId: "grp_product",
      title: "Aegis",
      avatar: "🛰️",
      members: {
        humans: [{ userId: "user-1", name: "UPBEYOND" }],
        bots: [{ agentId: "aegis", name: "大白管家" }],
      },
      invites: {
        humans: [{ userId: "user-2", name: "Alice" }],
      },
    });
    expect(request).toHaveBeenNthCalledWith(2, "collaboration.spaces.list", {});
    expect(state.collaborationSpacesResult).toEqual({
      spaces: [{ id: "grp_product", groupId: "grp_product", title: "Aegis" }],
    });
  });

  it("retries members update without avatar for legacy gateways", async () => {
    let membersUpdateCount = 0;
    const state = createState(async (method, params) => {
      if (method === "collaboration.spaces.members.update") {
        membersUpdateCount += 1;
        if (membersUpdateCount === 1) {
          expect(params).toMatchObject({
            groupId: "grp_product",
            avatar: "🛰️",
          });
          throw new Error(
            "GatewayRequestError: invalid collaboration.spaces.members.update params: at root: unexpected property 'avatar'",
          );
        }
        expect(params).toMatchObject({
          groupId: "grp_product",
          title: "Aegis",
          members: {
            humans: [{ userId: "user-1", name: "UPBEYOND" }],
          },
        });
        expect(
          params && typeof params === "object" && "avatar" in (params as Record<string, unknown>),
        ).toBe(false);
        return { ok: true };
      }
      if (method === "collaboration.spaces.list") {
        return {
          spaces: [{ id: "grp_product", groupId: "grp_product", title: "Aegis" }],
        };
      }
      throw new Error(`unexpected method: ${method}`);
    });
    const { request } = state;

    await updateWorkbenchSpaceMembers(state, {
      groupId: "grp_product",
      title: "Aegis",
      avatar: "🛰️",
      members: {
        humans: [{ userId: "user-1", name: "UPBEYOND" }],
      },
    });

    expect(request).toHaveBeenNthCalledWith(1, "collaboration.spaces.members.update", {
      groupId: "grp_product",
      title: "Aegis",
      avatar: "🛰️",
      members: {
        humans: [{ userId: "user-1", name: "UPBEYOND" }],
      },
    });
    expect(request).toHaveBeenNthCalledWith(2, "collaboration.spaces.members.update", {
      groupId: "grp_product",
      title: "Aegis",
      members: {
        humans: [{ userId: "user-1", name: "UPBEYOND" }],
      },
    });
    expect(request).toHaveBeenNthCalledWith(3, "collaboration.spaces.list", {});
  });

  it("resets a collaboration space then reloads collaboration.spaces.list", async () => {
    const state = createState(async (method) => {
      if (method === "collaboration.spaces.reset") {
        return { ok: true };
      }
      if (method === "collaboration.spaces.list") {
        return {
          spaces: [{ id: "grp_product", groupId: "grp_product", title: "Aegis" }],
        };
      }
      throw new Error(`unexpected method: ${method}`);
    });
    const { request } = state;

    await resetWorkbenchSpace(state, { groupId: "grp_product" });

    expect(request).toHaveBeenNthCalledWith(1, "collaboration.spaces.reset", {
      groupId: "grp_product",
    });
    expect(request).toHaveBeenNthCalledWith(2, "collaboration.spaces.list", {});
    expect(state.collaborationSpacesResult).toEqual({
      spaces: [{ id: "grp_product", groupId: "grp_product", title: "Aegis" }],
    });
    expect(request).toHaveBeenCalledWith("sessions.list", {
      includeGlobal: true,
      includeUnknown: true,
      includeDerivedTitles: true,
      includeLastMessage: true,
    });
  });

  it("dissolves a collaboration space then reloads spaces and sessions", async () => {
    const state = createState(async (method) => {
      if (method === "collaboration.spaces.dissolve") {
        return { dissolved: true, groupId: "grp_product" };
      }
      if (method === "collaboration.spaces.list") {
        return { spaces: [] };
      }
      if (method === "sessions.list") {
        return { sessions: [] };
      }
      return {};
    });
    const { request } = state;

    await dissolveWorkbenchSpace(state, { groupId: "grp_product" });

    expect(request).toHaveBeenNthCalledWith(1, "collaboration.spaces.dissolve", {
      groupId: "grp_product",
    });
    expect(request).toHaveBeenNthCalledWith(2, "collaboration.spaces.list", {});
    expect(request).toHaveBeenCalledWith("sessions.list", {
      includeGlobal: true,
      includeUnknown: true,
      includeDerivedTitles: true,
      includeLastMessage: true,
    });
  });

  it("leaves a collaboration space then reloads collaboration.spaces.list", async () => {
    const state = createState(async (method) => {
      if (method === "collaboration.spaces.leave") {
        return { left: true };
      }
      if (method === "collaboration.spaces.list") {
        return {
          spaces: [{ id: "grp_other", groupId: "grp_other", title: "Other" }],
        };
      }
      throw new Error(`unexpected method: ${method}`);
    });
    const { request } = state;

    await leaveWorkbenchSpace(state, { groupId: "grp_product" });

    expect(request).toHaveBeenNthCalledWith(1, "collaboration.spaces.leave", {
      groupId: "grp_product",
    });
    expect(request).toHaveBeenNthCalledWith(2, "collaboration.spaces.list", {});
    expect(state.collaborationSpacesResult).toEqual({
      spaces: [{ id: "grp_other", groupId: "grp_other", title: "Other" }],
    });
  });

  it("transfers collaboration space ownership then reloads collaboration.spaces.list", async () => {
    const state = createState(async (method) => {
      if (method === "collaboration.spaces.transferOwnership") {
        return { transferred: true };
      }
      if (method === "collaboration.spaces.list") {
        return {
          spaces: [{ id: "grp_product", groupId: "grp_product", title: "Aegis" }],
        };
      }
      throw new Error(`unexpected method: ${method}`);
    });
    const { request } = state;

    await transferWorkbenchSpaceOwnership(state, {
      groupId: "grp_product",
      newOwnerUserId: "user-2",
      newOwnerLabel: "Alice",
    });

    expect(request).toHaveBeenNthCalledWith(1, "collaboration.spaces.transferOwnership", {
      groupId: "grp_product",
      newOwnerUserId: "user-2",
      newOwnerLabel: "Alice",
    });
    expect(request).toHaveBeenNthCalledWith(2, "collaboration.spaces.list", {});
  });
});

describe("workbench signal cards co-load", () => {
  it("co-loads pending tasks and governance notices after collaboration.spaces.list", async () => {
    const pending = {
      totalCount: 2,
      taskCount: 1,
      ackRequiredCount: 1,
      governanceCount: 1,
      inviteCount: 0,
      items: [],
    };
    const state = createState(async (method) => {
      if (method === "collaboration.spaces.list") {
        return { spaces: [] };
      }
      if (method === "workbench.pending-tasks.list") {
        return pending;
      }
      if (method === "workbench.notices.list") {
        // Server-side read-model returns flat, actor-scoped counts.
        return { totalCount: 6, conflictCount: 3, attentionCount: 3, items: [] };
      }
      if (method === "workbench.upcoming-collaboration.list") {
        return {
          needsResponseCount: 2,
          decisionCount: 1,
          reviewCount: 1,
          activeCount: 4,
          items: [],
        };
      }
      if (method === "workbench.schedule.list") {
        return {
          todayCount: 2,
          upcomingCount: 3,
          cronDerivedCount: 1,
          nextStartAtMs: 1_700_000_000_000,
          nextTitle: "Standup",
          hasRealEntries: false,
          items: [],
        };
      }
      if (method === "workbench.steward-suggestion.get") {
        return {
          suggestion: {
            text: "有 1 项待确认任务需要你先处理",
            kind: "ack",
            source: "template",
            generatedAtMs: 1,
          },
          signature: "sig",
          fromCache: false,
          llmUsed: false,
        };
      }
      if (method === "meeting.list") {
        return { meetings: [] };
      }
      if (method === "workbench.my-tasks.list") {
        return {
          totalCount: 4,
          cronCount: 1,
          supervisedCount: 1,
          assignedCount: 2,
        };
      }
      throw new Error(`unexpected method: ${method}`);
    });
    const { request } = state;

    await loadWorkbenchSpaces(state);

    // The home signal cards must be co-loaded alongside the spaces list, not
    // left to a separate trigger.
    expect(request).toHaveBeenCalledWith("workbench.pending-tasks.list", {});
    expect(request).toHaveBeenCalledWith("workbench.notices.list", {});
    expect(request).toHaveBeenCalledWith("workbench.upcoming-collaboration.list", {});
    expect(request).toHaveBeenCalledWith(
      "workbench.schedule.list",
      expect.objectContaining({ timeZone: expect.any(String) }),
    );
    expect(request).toHaveBeenCalledWith("workbench.steward-suggestion.get", {});
    expect(request).toHaveBeenCalledWith("workbench.my-tasks.list", {});
    expect(state.workbenchMyTasks).toEqual({
      totalCount: 4,
      cronCount: 1,
      supervisedCount: 1,
      assignedCount: 2,
    });
    expect(state.workbenchPendingTasks).toEqual(pending);
    expect(state.workbenchNotices).toEqual({
      conflictCount: 3,
      attentionCount: 3,
      meetingInviteReviewCount: 0,
      meetingMinutesConfirmCount: 0,
      items: [],
    });
    expect(state.workbenchUpcomingCollaboration).toEqual({
      needsResponseCount: 2,
      decisionCount: 1,
      reviewCount: 1,
      activeCount: 4,
      items: [],
    });
    // Schedule projection is normalized to the lean summary shape (Phase A0).
    expect(state.workbenchSchedule).toEqual({
      todayCount: 2,
      upcomingCount: 3,
      cronDerivedCount: 1,
      nextStartAtMs: 1_700_000_000_000,
      nextTitle: "Standup",
      hasRealEntries: false,
      items: [],
    });
    // Steward suggestion is normalized to the lean {text,kind,source} shape.
    expect(state.workbenchStewardSuggestion).toEqual({
      text: "有 1 项待确认任务需要你先处理",
      kind: "ack",
      source: "template",
    });
  });

  it("normalizes pending-task and collaboration items into clickable card entries", async () => {
    const state = createState(async (method) => {
      if (method === "collaboration.spaces.list") {
        return { spaces: [] };
      }
      if (method === "workbench.pending-tasks.list") {
        return {
          totalCount: 2,
          taskCount: 1,
          ackRequiredCount: 0,
          governanceCount: 1,
          inviteCount: 0,
          items: [
            { id: "task:1", kind: "task", title: "审批预算", source: "space:x" },
            { id: "gov:2", kind: "governance", title: "治理项" },
            { kind: "task", title: "缺少 id 应被丢弃" },
          ],
        };
      }
      if (method === "workbench.notices.list") {
        return {
          totalCount: 5,
          conflictCount: 3,
          attentionCount: 0,
          meetingInviteReviewCount: 2,
          meetingMinutesConfirmCount: 0,
          items: [
            {
              id: "governance:conflict",
              kind: "governance-conflict",
              severity: "warning",
              count: 3,
            },
            {
              id: "meeting:invite-review",
              kind: "meeting-invite-review",
              severity: "info",
              count: 2,
            },
            { id: "bad", kind: "not-a-real-kind", severity: "info", count: 1 },
          ],
        };
      }
      if (method === "workbench.upcoming-collaboration.list") {
        return {
          needsResponseCount: 1,
          decisionCount: 1,
          reviewCount: 0,
          activeCount: 0,
          items: [
            {
              id: "g1",
              title: "产品组",
              kind: "decision",
              phase: "decide",
              summary: "等待你的决策",
            },
            { id: "g2", title: "无摘要组", kind: "response", phase: "execute" },
          ],
        };
      }
      if (method === "workbench.schedule.list") {
        return { todayCount: 0, upcomingCount: 0, cronDerivedCount: 0, hasRealEntries: false };
      }
      if (method === "workbench.steward-suggestion.get") {
        return { suggestion: null };
      }
      if (method === "meeting.list") {
        return { meetings: [] };
      }
      if (method === "workbench.my-tasks.list") {
        return { totalCount: 0, cronCount: 0, supervisedCount: 0, assignedCount: 0 };
      }
      throw new Error(`unexpected method: ${method}`);
    });

    await loadWorkbenchSpaces(state);

    // Pending-task items normalize to {id,title}; the id-less item is filtered out.
    expect(state.workbenchPendingTasks?.items).toEqual([
      { id: "task:1", title: "审批预算" },
      { id: "gov:2", title: "治理项" },
    ]);
    // Collaboration items carry the operating-state summary as the entry meta; a
    // missing summary yields no meta key.
    expect(state.workbenchUpcomingCollaboration?.items).toEqual([
      { id: "g1", title: "产品组", meta: "等待你的决策" },
      { id: "g2", title: "无摘要组" },
    ]);
    // Notice items keep {id,kind,count} (severity dropped) and unknown kinds are
    // filtered out, so the card can render a localized title per kind.
    expect(state.workbenchNotices?.items).toEqual([
      { id: "governance:conflict", kind: "governance-conflict", count: 3 },
      { id: "meeting:invite-review", kind: "meeting-invite-review", count: 2 },
    ]);
  });

  it("clears stale pending tasks when the request fails", async () => {
    const stale = {
      totalCount: 9,
      taskCount: 9,
      ackRequiredCount: 0,
      governanceCount: 0,
      inviteCount: 0,
    };
    const state = createState(async (method) => {
      if (method === "workbench.pending-tasks.list") {
        throw new Error("pending-tasks unavailable");
      }
      if (method === "workbench.notices.list") {
        return { totalCount: 0, conflictCount: 0, attentionCount: 0, items: [] };
      }
      if (method === "workbench.upcoming-collaboration.list") {
        return {
          needsResponseCount: 0,
          decisionCount: 0,
          reviewCount: 0,
          activeCount: 0,
          items: [],
        };
      }
      const tail = refreshTailStub(method);
      if (tail !== null) {
        return tail;
      }
      throw new Error(`unexpected method: ${method}`);
    });
    state.workbenchPendingTasks = stale;

    await refreshWorkbenchSignals(state);

    expect(state.workbenchPendingTasks).toBeNull();
  });

  it("clears stale governance notices when the notices request fails", async () => {
    const stale = {
      conflictCount: 5,
      attentionCount: 5,
      meetingInviteReviewCount: 0,
      meetingMinutesConfirmCount: 0,
      items: [],
    };
    const state = createState(async (method) => {
      if (method === "workbench.pending-tasks.list") {
        return {
          totalCount: 0,
          taskCount: 0,
          ackRequiredCount: 0,
          governanceCount: 0,
          inviteCount: 0,
        };
      }
      if (method === "workbench.notices.list") {
        throw new Error("notices unavailable");
      }
      if (method === "workbench.upcoming-collaboration.list") {
        return {
          needsResponseCount: 0,
          decisionCount: 0,
          reviewCount: 0,
          activeCount: 0,
          items: [],
        };
      }
      const tail = refreshTailStub(method);
      if (tail !== null) {
        return tail;
      }
      throw new Error(`unexpected method: ${method}`);
    });
    state.workbenchNotices = stale;

    await refreshWorkbenchSignals(state);

    expect(state.workbenchNotices).toBeNull();
  });

  it("clears stale upcoming collaboration when the request fails", async () => {
    const stale = {
      needsResponseCount: 4,
      decisionCount: 2,
      reviewCount: 1,
      activeCount: 1,
      items: [],
    };
    const state = createState(async (method) => {
      if (method === "workbench.pending-tasks.list") {
        return {
          totalCount: 0,
          taskCount: 0,
          ackRequiredCount: 0,
          governanceCount: 0,
          inviteCount: 0,
        };
      }
      if (method === "workbench.notices.list") {
        return { totalCount: 0, conflictCount: 0, attentionCount: 0, items: [] };
      }
      if (method === "workbench.upcoming-collaboration.list") {
        throw new Error("collaboration unavailable");
      }
      const tail = refreshTailStub(method);
      if (tail !== null) {
        return tail;
      }
      throw new Error(`unexpected method: ${method}`);
    });
    state.workbenchUpcomingCollaboration = stale;

    await refreshWorkbenchSignals(state);

    expect(state.workbenchUpcomingCollaboration).toBeNull();
  });

  it("clears stale schedule when the request fails", async () => {
    const stale = {
      todayCount: 3,
      upcomingCount: 5,
      cronDerivedCount: 2,
      hasRealEntries: true,
      items: [],
    };
    const state = createState(async (method) => {
      if (method === "workbench.pending-tasks.list") {
        return {
          totalCount: 0,
          taskCount: 0,
          ackRequiredCount: 0,
          governanceCount: 0,
          inviteCount: 0,
        };
      }
      if (method === "workbench.notices.list") {
        return { totalCount: 0, conflictCount: 0, attentionCount: 0, items: [] };
      }
      if (method === "workbench.upcoming-collaboration.list") {
        return {
          needsResponseCount: 0,
          decisionCount: 0,
          reviewCount: 0,
          activeCount: 0,
          items: [],
        };
      }
      if (method === "workbench.schedule.list") {
        throw new Error("schedule unavailable");
      }
      const tail = refreshTailStub(method);
      if (tail !== null) {
        return tail;
      }
      throw new Error(`unexpected method: ${method}`);
    });
    state.workbenchSchedule = stale;

    await refreshWorkbenchSignals(state);

    expect(state.workbenchSchedule).toBeNull();
  });

  it("clears stale steward suggestion when the request fails", async () => {
    const stale = { text: "stale", kind: "task", source: "template" as const };
    const state = createState(async (method) => {
      if (method === "workbench.pending-tasks.list") {
        return {
          totalCount: 0,
          taskCount: 0,
          ackRequiredCount: 0,
          governanceCount: 0,
          inviteCount: 0,
        };
      }
      if (method === "workbench.notices.list") {
        return { totalCount: 0, conflictCount: 0, attentionCount: 0, items: [] };
      }
      if (method === "workbench.upcoming-collaboration.list") {
        return {
          needsResponseCount: 0,
          decisionCount: 0,
          reviewCount: 0,
          activeCount: 0,
          items: [],
        };
      }
      if (method === "workbench.steward-suggestion.get") {
        throw new Error("steward suggestion unavailable");
      }
      const tail = refreshTailStub(method);
      if (tail !== null) {
        return tail;
      }
      throw new Error(`unexpected method: ${method}`);
    });
    state.workbenchStewardSuggestion = stale;

    await refreshWorkbenchSignals(state);

    expect(state.workbenchStewardSuggestion).toBeNull();
  });

  it("passes the resolved local time zone to workbench.schedule.list", async () => {
    const state = createState(async (method) => {
      const tail = refreshTailStub(method);
      if (tail !== null) {
        return tail;
      }
      if (
        method === "workbench.pending-tasks.list" ||
        method === "workbench.notices.list" ||
        method === "workbench.upcoming-collaboration.list"
      ) {
        return {
          totalCount: 0,
          taskCount: 0,
          ackRequiredCount: 0,
          governanceCount: 0,
          inviteCount: 0,
          conflictCount: 0,
          attentionCount: 0,
          needsResponseCount: 0,
          decisionCount: 0,
          reviewCount: 0,
          activeCount: 0,
          items: [],
        };
      }
      throw new Error(`unexpected method: ${method}`);
    });

    await refreshWorkbenchSignals(state);

    expect(state.request).toHaveBeenCalledWith(
      "workbench.schedule.list",
      resolveWorkbenchScheduleListParams(),
    );
  });

  it("drops a steward suggestion with empty text to null", async () => {
    const state = createState(async (method) => {
      if (method === "workbench.pending-tasks.list") {
        return {
          totalCount: 0,
          taskCount: 0,
          ackRequiredCount: 0,
          governanceCount: 0,
          inviteCount: 0,
        };
      }
      if (method === "workbench.notices.list") {
        return { totalCount: 0, conflictCount: 0, attentionCount: 0, items: [] };
      }
      if (method === "workbench.upcoming-collaboration.list") {
        return {
          needsResponseCount: 0,
          decisionCount: 0,
          reviewCount: 0,
          activeCount: 0,
          items: [],
        };
      }
      if (method === "workbench.steward-suggestion.get") {
        // Server says "nothing worth surfacing" → suggestion is null.
        return { suggestion: null, signature: "", fromCache: false, llmUsed: false };
      }
      throw new Error(`unexpected method: ${method}`);
    });

    await refreshWorkbenchSignals(state);

    expect(state.workbenchStewardSuggestion).toBeNull();
  });

  it("does not issue requests when the gateway is disconnected", async () => {
    const state = createState(async (method) => {
      throw new Error(`unexpected method: ${method}`);
    });
    state.connected = false;

    await refreshWorkbenchSignals(state);

    expect(state.request).not.toHaveBeenCalled();
  });
});

describe("schedule manual write controller actions", () => {
  it("upsertWorkbenchScheduleEntry posts schedule.entry.upsert then refreshes signals", async () => {
    const seen: Array<{ method: string; params: unknown }> = [];
    const state = createState(async (method, params) => {
      seen.push({ method, params });
      return {};
    });

    await upsertWorkbenchScheduleEntry(state, {
      title: "Demo",
      startAtMs: 1_700_000_000_000,
      kind: "reminder",
    });

    const upsertCall = seen.find((c) => c.method === "schedule.entry.upsert");
    expect(upsertCall?.params).toMatchObject({
      title: "Demo",
      startAtMs: 1_700_000_000_000,
      kind: "reminder",
    });
    // The signal cards are refreshed afterwards so the new entry surfaces.
    expect(seen.some((c) => c.method === "workbench.schedule.list")).toBe(true);
  });

  it("cancelWorkbenchScheduleEntry posts schedule.entry.cancel then refreshes signals", async () => {
    const seen: string[] = [];
    const state = createState(async (method) => {
      seen.push(method);
      return {};
    });

    await cancelWorkbenchScheduleEntry(state, "entry-1");

    expect(seen).toContain("schedule.entry.cancel");
    expect(seen).toContain("workbench.schedule.list");
  });

  it("schedule writes are no-ops when disconnected", async () => {
    const state = createState(async () => ({}));
    state.connected = false;

    expect(await upsertWorkbenchScheduleEntry(state, { title: "x", startAtMs: 1 })).toBeNull();
    expect(await cancelWorkbenchScheduleEntry(state, "a")).toBeNull();
    expect(state.request).not.toHaveBeenCalled();
  });
});
