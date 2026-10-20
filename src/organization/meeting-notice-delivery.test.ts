// @vitest-environment node
import { describe, expect, it } from "vitest";
import { deliverMeetingReleaseNotifications } from "./meeting-lifecycle.js";
import { buildMeetingAttendeeNotice, planMeetingNoticeRoute } from "./meeting-notice-delivery.js";
import type { Meeting } from "./meeting-store.js";

const peers = [
  {
    agentId: "bot-2",
    displayName: "市场助手",
    sessionKey: "agent:bot-2:main",
  },
  {
    agentId: "panda",
    displayName: "熊猫学习",
    sessionKey: "agent:panda:main",
  },
];

function meeting(): Meeting {
  return {
    id: "m-notice",
    organizerUserId: "user-1",
    tenantId: "tenant-a",
    title: "openbot体验交流会",
    startAtMs: Date.parse("2026-09-28T08:15:00.000Z"),
    endAtMs: Date.parse("2026-09-28T08:45:00.000Z"),
    timezone: "Asia/Shanghai",
    location: "线上",
    agenda: ["体验主流程"],
    status: "confirmed",
    attendees: [
      { userId: "user-1", role: "organizer", rsvpStatus: "accepted", kind: "human" },
      { userId: "市场助手", role: "required", rsvpStatus: "invited", kind: "human" },
      { userId: "熊猫学习", role: "required", rsvpStatus: "invited", kind: "human" },
      {
        userId: "90fed19a-1c8b-4420-87e0-bcc6165e32fa",
        role: "required",
        rsvpStatus: "invited",
        kind: "human",
      },
      { userId: "王军", role: "optional", rsvpStatus: "invited", kind: "human" },
      { userId: "user-2", role: "required", rsvpStatus: "invited", kind: "human" },
      { userId: "agent-bot-1", role: "required", rsvpStatus: "invited", kind: "agent" },
    ],
    createdAt: "2026-09-28T00:00:00.000Z",
    updatedAt: "2026-09-28T00:00:00.000Z",
  };
}

describe("meeting notice delivery", () => {
  it("writes a plain notice without session keys or handoff labels", () => {
    const text = buildMeetingAttendeeNotice(meeting());
    expect(text).toContain("会议通知：openbot体验交流会");
    expect(text).toContain("地点：线上");
    expect(text).toContain("- 体验主流程");
    expect(text).not.toContain("agent:");
    expect(text).not.toContain("角色");
    expect(text).not.toContain("任务接收");
  });

  it("includes the join link and meeting code once the room is booked", () => {
    const text = buildMeetingAttendeeNotice({
      ...meeting(),
      joinUrl: "https://meeting.tencent.com/dm/abc",
      externalMeetingCode: "137883890",
    });
    expect(text).toContain("链接：https://meeting.tencent.com/dm/abc");
    expect(text).toContain("会议号：137883890");
  });

  it("routes a display name to that digital human's main session", () => {
    expect(planMeetingNoticeRoute({ recipientId: "市场助手", kind: "human", peers })).toEqual({
      route: "conversation",
      agentId: "bot-2",
      sessionKey: "agent:bot-2:main",
    });
    expect(planMeetingNoticeRoute({ recipientId: "bot-2", kind: "human", peers })).toEqual({
      route: "conversation",
      agentId: "bot-2",
      sessionKey: "agent:bot-2:main",
    });
  });

  it("keeps platform user ids and opaque human ids on the workbench", () => {
    expect(
      planMeetingNoticeRoute({
        recipientId: "90fed19a-1c8b-4420-87e0-bcc6165e32fa",
        kind: "human",
        peers,
      }).route,
    ).toBe("workbench");
    expect(planMeetingNoticeRoute({ recipientId: "user-2", kind: "human", peers }).route).toBe(
      "workbench",
    );
  });

  it("fails a display name that is not a digital human or a platform user", () => {
    expect(planMeetingNoticeRoute({ recipientId: "王军", kind: "human", peers })).toEqual({
      route: "failed",
      error: "找不到这位参会人的会话",
    });
  });

  it("sends agent ids into the main session even without a directory row", () => {
    expect(
      planMeetingNoticeRoute({ recipientId: "agent-bot-1", kind: "agent", peers: [] }),
    ).toEqual({
      route: "conversation",
      agentId: "agent-bot-1",
      sessionKey: "agent:agent-bot-1:main",
    });
  });

  it("counts a main-session notice as sent and a bare name as failed", async () => {
    const sent: Array<{ attendeeId: string; agentId: string; sessionKey: string; notice: string }> =
      [];
    const humans: string[] = [];
    const result = await deliverMeetingReleaseNotifications(meeting(), {
      peers,
      deliverConversation: async (input) => {
        sent.push({
          attendeeId: input.attendeeId,
          agentId: input.agentId,
          sessionKey: input.sessionKey,
          notice: input.notice,
        });
        return { ok: true };
      },
      adapters: {
        deliverHuman: async ({ recipientUserId }) => {
          humans.push(recipientUserId);
          return { ok: true };
        },
        deliverAgent: async () => {
          throw new Error("org bus must not receive meeting notices");
        },
      },
    });

    expect(sent.map((row) => row.attendeeId).toSorted()).toEqual(
      ["agent-bot-1", "市场助手", "熊猫学习"].toSorted(),
    );
    expect(sent.find((row) => row.attendeeId === "市场助手")).toMatchObject({
      agentId: "bot-2",
      sessionKey: "agent:bot-2:main",
    });
    expect(sent[0]?.notice).toContain("会议通知：openbot体验交流会");
    expect(humans.toSorted()).toEqual(
      ["90fed19a-1c8b-4420-87e0-bcc6165e32fa", "user-2"].toSorted(),
    );
    expect(result.deliveredCount).toBe(5);
    expect(result.failedCount).toBe(1);
    expect(result.results.find((row) => row.userId === "市场助手")).toMatchObject({
      status: "sent",
      channel: "conversation",
    });
    expect(result.results.find((row) => row.userId === "王军")).toMatchObject({
      status: "failed",
      error: "找不到这位参会人的会话",
    });
  });
});
