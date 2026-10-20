// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { GatewayBrowserClient } from "../gateway.ts";
import { GatewayRequestError } from "../gateway.ts";
import {
  cancelMeetingPendingConfirmation,
  confirmMeetingPendingApproval,
  formatMeetingConfirmationError,
  meetingConfirmReleaseShouldClear,
  syncMeetingPendingConfirmation,
  type MeetingConfirmationState,
} from "./meeting-confirmation.ts";

const request = vi.fn();
const client = { request } as unknown as GatewayBrowserClient;

function baseState(overrides: Partial<MeetingConfirmationState> = {}): MeetingConfirmationState {
  return {
    client,
    connected: true,
    collaborationSpacesLoading: false,
    collaborationSpacesResult: { spaces: [] },
    collaborationSpacesError: null,
    workbenchNotices: { conflictCount: 0, attentionCount: 0, meetingInviteReviewCount: 1 },
    ...overrides,
  };
}

const pendingMeeting = {
  id: "m1",
  title: "周会",
  status: "pending_approval" as const,
  updatedAt: "2026-07-30T08:00:00.000Z",
  startAtMs: 1,
  timezone: "Asia/Shanghai",
  organizerUserId: "u1",
  attendees: [] as Array<{ userId: string }>,
  createdAt: "2026-07-30T08:00:00.000Z",
};

describe("meeting-confirmation controller", () => {
  beforeEach(() => {
    request.mockReset();
  });

  it("syncMeetingPendingConfirmation fetches ticket for pending_approval meeting", async () => {
    request.mockImplementation(async (method: string) => {
      if (method === "meeting.list") {
        return {
          meetings: [pendingMeeting],
        };
      }
      if (method === "meeting.approve") {
        return {
          status: "pending_confirmation",
          meeting: pendingMeeting,
          confirmation: {
            proposalId: "p1",
            confirmationToken: "secret",
            payloadHash: "hash",
            expiresAtMs: Date.now() + 600_000,
          },
          confirmationDetail: {
            title: "周会",
            impact: "将写入 2 位参会人的今日日程",
            irreversible: false,
            expiresAtMs: Date.now() + 600_000,
          },
          message: "请确认会议范本",
        };
      }
      return {};
    });
    const state = baseState();
    await syncMeetingPendingConfirmation(state);
    expect(state.meetingPendingConfirmation?.confirmation.confirmationToken).toBe("secret");
    expect(state.meetingPendingConfirmation?.meeting.title).toBe("周会");
  });

  it("confirmMeetingPendingApproval clears pending but leaves release + resume signal", async () => {
    const resume = vi.fn(async () => undefined);
    request.mockImplementation(async (method: string) => {
      if (method === "meeting.approve") {
        return {
          status: "confirmed",
          meeting: { ...pendingMeeting, status: "confirmed", title: "周会" },
          scheduledCount: 2,
          scheduleComplete: true,
          deliveredCount: 1,
          failedCount: 0,
          deliveryProgress: {
            totalRecipients: 1,
            deliveredCount: 1,
            failedCount: 0,
            pendingCount: 0,
          },
          resumeContinuation: {
            kind: "meeting_confirm_release",
            meetingId: "m1",
            title: "周会",
            status: "confirmed",
            scheduleComplete: true,
            scheduledCount: 2,
            deliveredCount: 1,
            failedCount: 0,
            userMessage:
              "我已确认发送会议「周会」。 状态=confirmed；发起人日程已写入；投递：已投递 1。 请向我汇报发送与日程结果，并给出下一步建议。",
            epilogueProgressMessage: "已确认，正在发送邀请并写入日程…",
            epilogueResultMessage: "已确认发送「周会」。发起人日程已写入；投递：已投递 1。",
          },
        };
      }
      if (method === "workbench.pending-tasks.list") {
        return { totalCount: 0, items: [] };
      }
      if (method === "workbench.notices.list") {
        return { meetingInviteReviewCount: 0, items: [] };
      }
      if (method === "workbench.upcoming-collaboration.list") {
        return { activeCount: 0, items: [] };
      }
      if (method === "workbench.schedule.list") {
        return { todayCount: 1, items: [] };
      }
      if (method === "workbench.steward-suggestion.get") {
        return { suggestion: null };
      }
      return {};
    });
    const state = baseState({
      meetingPendingConfirmation: {
        meeting: pendingMeeting,
        confirmation: {
          proposalId: "p1",
          confirmationToken: "secret",
          payloadHash: "hash",
          expiresAtMs: Date.now() + 600_000,
        },
        message: "请确认",
      },
      resumeMeetingConfirmConversation: resume,
    });
    const continuation = await confirmMeetingPendingApproval(state);
    expect(state.meetingPendingConfirmation).toBeNull();
    expect(state.meetingConfirmRelease?.phase).toBe("released");
    expect(state.meetingConfirmRelease?.progressMessage).toContain("已确认");
    expect(state.meetingConfirmRelease?.resultMessage).toContain("周会");
    expect(continuation?.kind).toBe("meeting_confirm_release");
    expect(continuation?.userMessage).toContain("我已确认发送会议");
    expect(JSON.stringify(continuation)).not.toContain("secret");
    expect(resume).toHaveBeenCalledTimes(1);
    const firstResumeCall = resume.mock.calls[0] as unknown as
      | [{ userMessage?: string }]
      | undefined;
    expect(firstResumeCall?.[0]?.userMessage).toContain("周会");
    expect(request).toHaveBeenCalledWith("meeting.approve", {
      id: "m1",
      proposalId: "p1",
      confirmationToken: "secret",
    });
  });

  it("clears the release strip after the result is on screen, not while it is still sending", () => {
    expect(meetingConfirmReleaseShouldClear({ phase: "releasing" })).toBe(false);
    expect(meetingConfirmReleaseShouldClear({ phase: "released" })).toBe(true);
    expect(meetingConfirmReleaseShouldClear({ phase: "partial" })).toBe(true);
    expect(meetingConfirmReleaseShouldClear(null)).toBe(false);
  });

  it("cancelMeetingPendingConfirmation clears pending and invalidates server tickets", async () => {
    request.mockResolvedValue({
      status: "confirmation_cancelled",
      meetingId: "m1",
      meeting: pendingMeeting,
      invalidatedTickets: 1,
    });
    const state = baseState({
      meetingPendingConfirmation: {
        meeting: pendingMeeting,
        confirmation: {
          proposalId: "p1",
          confirmationToken: "secret",
          payloadHash: "hash",
          expiresAtMs: Date.now() + 600_000,
        },
        message: "请确认",
      },
      meetingConfirmRelease: {
        meetingId: "m1",
        title: "周会",
        phase: "releasing",
        progressMessage: "已确认，正在发送邀请并写入日程…",
      },
    });
    await cancelMeetingPendingConfirmation(state);
    expect(state.meetingPendingConfirmation).toBeNull();
    expect(state.meetingConfirmRelease).toBeNull();
    expect(request).toHaveBeenCalledWith("meeting.approve", {
      id: "m1",
      dismissConfirmation: true,
    });
  });

  it("skips online-without-joinUrl when a confirmable pending exists", async () => {
    const onlineNoLink = {
      id: "m-online-nolink",
      title: "线上缺链",
      status: "pending_approval",
      meetingMode: "online",
      location: "线上",
      joinUrl: null,
      updatedAt: 1,
      attendees: [],
    };
    const offline = {
      id: "m-offline",
      title: "线下可确认",
      status: "pending_approval",
      meetingMode: "offline",
      location: "3F",
      joinUrl: null,
      updatedAt: 2,
      attendees: [{ userId: "u1" }],
    };
    request.mockImplementation(async (method: string, params?: { id?: string }) => {
      if (method === "meeting.list") {
        return { meetings: [onlineNoLink, offline] };
      }
      if (method === "meeting.approve") {
        if (params?.id === "m-online-nolink") {
          throw new Error("线上会议尚未开通或缺少入会链接；请先完成开通后再确认发送。");
        }
        return {
          status: "pending_confirmation",
          meeting: offline,
          confirmation: {
            proposalId: "p-off",
            confirmationToken: "tok-off",
            payloadHash: "hash",
            expiresAtMs: Date.now() + 600_000,
          },
          confirmationDetail: {
            title: "线下可确认",
            impact: "确认后写入你的日程",
            irreversible: false,
            expiresAtMs: Date.now() + 600_000,
          },
          message: "请确认",
        };
      }
      return {};
    });
    const state = baseState();
    await syncMeetingPendingConfirmation(state);
    expect(state.meetingPendingConfirmation?.meeting.id).toBe("m-offline");
    expect(state.meetingConfirmationError).toBeNull();
    expect(request).toHaveBeenCalledWith("meeting.approve", { id: "m-offline" });
    expect(request).not.toHaveBeenCalledWith("meeting.approve", { id: "m-online-nolink" });
  });

  it("surfaces provision error when every pending meeting lacks joinUrl without calling approve", async () => {
    const onlineNoLink = {
      id: "m-online-nolink",
      title: "线上缺链",
      status: "pending_approval",
      meetingMode: "online",
      location: "线上",
      joinUrl: null,
      updatedAt: 1,
      attendees: [],
    };
    request.mockImplementation(async (method: string) => {
      if (method === "meeting.list") {
        return { meetings: [onlineNoLink] };
      }
      if (method === "meeting.approve") {
        throw new Error("should not approve unlinkable online pending");
      }
      return {};
    });
    const state = baseState();
    await syncMeetingPendingConfirmation(state);
    expect(state.meetingPendingConfirmation).toBeNull();
    expect(state.meetingConfirmationError).toContain("线上会议尚未开通");
    expect(state.meetingConfirmationError).not.toMatch(/GatewayRequestError/i);
    expect(request).not.toHaveBeenCalledWith("meeting.approve", expect.anything());
    expect(state.meetingConfirmationApproveBlockKey).toBe("m-online-nolink:1");
  });

  it("formatMeetingConfirmationError strips GatewayRequestError prefix", () => {
    const err = new GatewayRequestError({
      code: "INVALID_REQUEST",
      message: "线上会议尚未开通或缺少入会链接；请先完成开通后再确认发送。",
      details: { code: "provision_required" },
    });
    expect(err).toBeInstanceOf(GatewayRequestError);
    expect(err.name).toBe("GatewayRequestError");
    // Error#toString is `${name}: ${message}` — formatMeetingConfirmationError must not keep the name.
    expect(`${err.name}: ${err.message}`).toMatch(/^GatewayRequestError:/);
    expect(formatMeetingConfirmationError(err)).toBe(
      "线上会议尚未开通或缺少入会链接；请先完成开通后再确认发送。",
    );
    expect(formatMeetingConfirmationError(err)).not.toMatch(/GatewayRequestError/i);
    expect(formatMeetingConfirmationError(`${err.name}: ${err.message}`)).toBe(
      "线上会议尚未开通或缺少入会链接；请先完成开通后再确认发送。",
    );
  });

  it("does not re-call meeting.approve every refresh after hard provision failure", async () => {
    const onlineWithStaleModeButConfirmableShape = {
      // meetingMode offline so it is confirmable from UI ranking, but approve hard-fails
      id: "m-hard",
      title: "硬失败",
      status: "pending_approval",
      meetingMode: "offline",
      location: "3F",
      joinUrl: null,
      updatedAt: "2026-07-30T08:00:00.000Z",
      attendees: [{ userId: "u1" }],
    };
    let approveCalls = 0;
    request.mockImplementation(async (method: string) => {
      if (method === "meeting.list") {
        return { meetings: [onlineWithStaleModeButConfirmableShape] };
      }
      if (method === "meeting.approve") {
        approveCalls += 1;
        throw new GatewayRequestError({
          code: "INVALID_REQUEST",
          message: "线上会议尚未开通或缺少入会链接；请先完成开通后再确认发送。",
          details: { code: "provision_required" },
        });
      }
      return {};
    });
    const state = baseState();
    await syncMeetingPendingConfirmation(state);
    expect(approveCalls).toBe(1);
    expect(state.meetingConfirmationError).toBe(
      "线上会议尚未开通或缺少入会链接；请先完成开通后再确认发送。",
    );
    expect(state.meetingConfirmationError).not.toMatch(/GatewayRequestError/i);
    expect(state.meetingConfirmationApproveBlockKey).toBe("m-hard:2026-07-30T08:00:00.000Z");

    // Simulate WORKBENCH_SIGNALS_REFRESH (~45s) — same fingerprint must not re-invoice.
    await syncMeetingPendingConfirmation(state);
    await syncMeetingPendingConfirmation(state);
    expect(approveCalls).toBe(1);

    // Meeting updated → allow one more attempt.
    onlineWithStaleModeButConfirmableShape.updatedAt = "2026-07-30T09:00:00.000Z";
    await syncMeetingPendingConfirmation(state);
    expect(approveCalls).toBe(2);
  });

  it("skips approve for unlinkable online even when mixed with itself only across refreshes", async () => {
    const onlineNoLink = {
      id: "m-online-nolink",
      title: "线上缺链",
      status: "pending_approval",
      meetingMode: "online",
      location: "线上",
      joinUrl: null,
      updatedAt: 1,
      attendees: [],
    };
    request.mockImplementation(async (method: string) => {
      if (method === "meeting.list") {
        return { meetings: [onlineNoLink] };
      }
      return {};
    });
    const state = baseState();
    await syncMeetingPendingConfirmation(state);
    await syncMeetingPendingConfirmation(state);
    expect(request.mock.calls.filter((c) => c[0] === "meeting.approve")).toHaveLength(0);
  });
});
