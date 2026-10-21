// @vitest-environment node
import { afterEach, describe, expect, it } from "vitest";
import { __clearConfirmationsForTest } from "../gateway/server-methods/steward-confirmation-store.js";
import {
  buildMeetingConfirmResumeContinuation,
  consumeMeetingApprovalConfirmation,
  invalidateMeetingApprovalConfirmations,
  issueMeetingApprovalConfirmation,
  MEETING_APPROVE_CONFIRM_ACTION,
  reissueMeetingApprovalConfirmation,
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

describe("meeting approval reissue", () => {
  function pendingMeeting(title = "Sync") {
    return transitionMeeting(
      createMeeting({
        organizerUserId: "user-1",
        title,
        startAtMs: 1,
        id: "m1",
        attendees: [{ userId: "user-2" }],
      }),
      "pending_approval",
    );
  }

  it("invalidates the old ticket and does not reuse its authorization", () => {
    const meeting = pendingMeeting();
    const oldTicket = issueMeetingApprovalConfirmation(meeting);
    const reissued = reissueMeetingApprovalConfirmation({
      meeting,
      actorUserId: "user-1",
    });
    expect(reissued.ok).toBe(true);
    if (!reissued.ok) {
      return;
    }
    expect(reissued.recovery.previousAuthorizationReused).toBe(false);
    expect(reissued.recovery.oldCardStatus).toBe("invalidated");
    expect(reissued.recovery.invalidatedProposalIds).toContain(oldTicket.proposalId);
    expect(reissued.recovery.draftRechecked).toBe(true);
    expect(reissued.recovery.permissionRechecked).toBe(true);
    expect(reissued.recovery.expiryRechecked).toBe(true);
    expect(JSON.stringify(reissued.recovery)).not.toContain(oldTicket.confirmationToken);
    expect(JSON.stringify(reissued.recovery)).not.toContain(
      reissued.confirmation.confirmationToken,
    );
    expect(
      consumeMeetingApprovalConfirmation({
        meeting,
        proposalId: oldTicket.proposalId,
        confirmationToken: oldTicket.confirmationToken,
      }),
    ).toEqual({ ok: false, reason: "not_found" });
    expect(
      consumeMeetingApprovalConfirmation({
        meeting,
        proposalId: reissued.confirmation.proposalId,
        confirmationToken: reissued.confirmation.confirmationToken,
      }),
    ).toEqual({ ok: true });
  });

  it("does not extend an expired ticket", () => {
    const meeting = pendingMeeting();
    const issuedAt = 1_000;
    const oldTicket = issueMeetingApprovalConfirmation(meeting);
    const expiredAt = oldTicket.expiresAtMs + 1;
    const reissued = reissueMeetingApprovalConfirmation({
      meeting,
      actorUserId: "user-1",
      now: expiredAt,
    });
    expect(reissued.ok).toBe(true);
    if (!reissued.ok) {
      return;
    }
    expect(reissued.confirmation.expiresAtMs).toBeGreaterThan(expiredAt);
    expect(reissued.confirmation.expiresAtMs).not.toBe(oldTicket.expiresAtMs);
    expect(reissued.confirmation.proposalId).not.toBe(oldTicket.proposalId);
    expect(
      consumeMeetingApprovalConfirmation({
        meeting,
        proposalId: oldTicket.proposalId,
        confirmationToken: oldTicket.confirmationToken,
        now: expiredAt,
      }),
    ).toEqual({ ok: false, reason: "not_found" });
    expect(issuedAt).toBeLessThan(expiredAt);
  });

  it("rechecks the current draft instead of the previous payload", () => {
    const meeting = pendingMeeting("Sync");
    const oldTicket = issueMeetingApprovalConfirmation(meeting);
    const renamed = {
      ...meeting,
      title: "Renamed",
      updatedAt: "2099-01-01T00:00:00.000Z",
    };
    const reissued = reissueMeetingApprovalConfirmation({
      meeting: renamed,
      actorUserId: "user-1",
    });
    expect(reissued.ok).toBe(true);
    if (!reissued.ok) {
      return;
    }
    expect(reissued.recovery.payloadHash).not.toBe(oldTicket.payloadHash);
    expect(
      consumeMeetingApprovalConfirmation({
        meeting: renamed,
        proposalId: oldTicket.proposalId,
        confirmationToken: oldTicket.confirmationToken,
      }),
    ).toEqual({ ok: false, reason: "not_found" });
    expect(
      consumeMeetingApprovalConfirmation({
        meeting,
        proposalId: reissued.confirmation.proposalId,
        confirmationToken: reissued.confirmation.confirmationToken,
      }),
    ).toEqual({ ok: false, reason: "payload_mismatch" });
    expect(
      consumeMeetingApprovalConfirmation({
        meeting: renamed,
        proposalId: reissued.confirmation.proposalId,
        confirmationToken: reissued.confirmation.confirmationToken,
      }),
    ).toEqual({ ok: true });
  });

  it("does not issue when the actor is not the organizer or the meeting is not pending", () => {
    const meeting = pendingMeeting();
    const existing = issueMeetingApprovalConfirmation(meeting);
    const wrongActor = reissueMeetingApprovalConfirmation({
      meeting,
      actorUserId: "user-2",
    });
    expect(wrongActor).toMatchObject({ ok: false, code: "actor_not_organizer" });
    expect(
      consumeMeetingApprovalConfirmation({
        meeting,
        proposalId: existing.proposalId,
        confirmationToken: existing.confirmationToken,
      }).ok,
    ).toBe(true);

    const draft = createMeeting({
      organizerUserId: "user-1",
      title: "Draft",
      startAtMs: 1,
      id: "m-draft",
    });
    expect(
      reissueMeetingApprovalConfirmation({ meeting: draft, actorUserId: "user-1" }),
    ).toMatchObject({ ok: false, code: "invalid_status" });
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
