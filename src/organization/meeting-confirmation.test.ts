// @vitest-environment node
import { afterEach, describe, expect, it } from "vitest";
import { __clearConfirmationsForTest } from "../gateway/server-methods/steward-confirmation-store.js";
import {
  buildMeetingConfirmResumeContinuation,
  consumeMeetingApprovalConfirmation,
  invalidateMeetingApprovalConfirmations,
  issueMeetingApprovalConfirmation,
  MEETING_APPROVE_CONFIRM_ACTION,
} from "./meeting-confirmation.js";
import { createMeeting, transitionMeeting } from "./meeting-store.js";

afterEach(() => {
  __clearConfirmationsForTest();
});

describe("meeting approval confirmation", () => {
  it("issues a consumable ticket bound to meeting content", () => {
    const meeting = transitionMeeting(
      createMeeting({
        organizerUserId: "user-1",
        title: "Sync",
        startAtMs: 1,
        id: "m1",
        attendees: [{ userId: "user-2" }],
      }),
      "pending_approval",
    );
    const ticket = issueMeetingApprovalConfirmation(meeting);
    const ok = consumeMeetingApprovalConfirmation({
      meeting,
      proposalId: ticket.proposalId,
      confirmationToken: ticket.confirmationToken,
    });
    expect(ok).toEqual({ ok: true });
  });

  it("rejects when meeting content changed after ticket issue", () => {
    const meeting = transitionMeeting(
      createMeeting({
        organizerUserId: "user-1",
        title: "Sync",
        startAtMs: 1,
        id: "m1",
      }),
      "pending_approval",
    );
    const ticket = issueMeetingApprovalConfirmation(meeting);
    const mutated = { ...meeting, title: "Renamed", updatedAt: "2099-01-01T00:00:00.000Z" };
    const res = consumeMeetingApprovalConfirmation({
      meeting: mutated,
      proposalId: ticket.proposalId,
      confirmationToken: ticket.confirmationToken,
    });
    expect(res).toEqual({ ok: false, reason: "payload_mismatch" });
  });

  it("is single-consume", () => {
    const meeting = transitionMeeting(
      createMeeting({
        organizerUserId: "user-1",
        title: "Sync",
        startAtMs: 1,
        id: "m1",
      }),
      "pending_approval",
    );
    const ticket = issueMeetingApprovalConfirmation(meeting);
    expect(
      consumeMeetingApprovalConfirmation({
        meeting,
        proposalId: ticket.proposalId,
        confirmationToken: ticket.confirmationToken,
      }).ok,
    ).toBe(true);
    expect(
      consumeMeetingApprovalConfirmation({
        meeting,
        proposalId: ticket.proposalId,
        confirmationToken: ticket.confirmationToken,
      }),
    ).toEqual({ ok: false, reason: "not_found" });
  });
});

describe("meeting confirm resume continuation", () => {
  it("builds a token-free pause-release wake payload", () => {
    const continuation = buildMeetingConfirmResumeContinuation({
      meetingId: "m1",
      title: "周会",
      scheduleComplete: true,
      scheduledCount: 1,
      deliveredCount: 2,
      failedCount: 0,
    });
    expect(continuation.kind).toBe("meeting_confirm_release");
    expect(continuation.userMessage).toContain("我已确认发送会议「周会」");
    expect(continuation.epilogueProgressMessage).toContain("正在发送邀请");
    expect(continuation.epilogueResultMessage).toContain("发起人日程已写入");
    expect(JSON.stringify(continuation)).not.toMatch(/confirmationToken|proposalId|secret/i);
  });

  it("marks partial schedule in epilogue copy", () => {
    const continuation = buildMeetingConfirmResumeContinuation({
      meetingId: "m2",
      title: "Standup",
      scheduleComplete: false,
      scheduledCount: 0,
      failedCount: 1,
    });
    expect(continuation.epilogueResultMessage).toContain("未完成");
    expect(continuation.epilogueResultMessage).toContain("失败 1");
  });
});

describe("meeting approval confirmation cancel invalidate", () => {
  it("invalidateMeetingApprovalConfirmations drops unused tickets", () => {
    const meeting = transitionMeeting(
      createMeeting({
        organizerUserId: "user-1",
        title: "Sync",
        startAtMs: 1,
        id: "m1",
      }),
      "pending_approval",
    );
    const ticket = issueMeetingApprovalConfirmation(meeting);
    expect(invalidateMeetingApprovalConfirmations("m1")).toBe(1);
    expect(
      consumeMeetingApprovalConfirmation({
        meeting,
        proposalId: ticket.proposalId,
        confirmationToken: ticket.confirmationToken,
      }),
    ).toEqual({ ok: false, reason: "not_found" });
    expect(invalidateMeetingApprovalConfirmations("m1")).toBe(0);
  });

  it("descriptor onCancel aligns with invalidate helper", () => {
    const meeting = transitionMeeting(
      createMeeting({
        organizerUserId: "user-1",
        title: "Sync",
        startAtMs: 1,
        id: "m2",
      }),
      "pending_approval",
    );
    issueMeetingApprovalConfirmation(meeting);
    expect(MEETING_APPROVE_CONFIRM_ACTION.onCancel?.("m2")).toBe(1);
  });
});
