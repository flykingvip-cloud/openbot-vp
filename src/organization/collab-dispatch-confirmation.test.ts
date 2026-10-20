// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  buildCollabDispatchApprovalPayload,
  collabDispatchApproveActionId,
  collabDispatchApprovalConfirmationDetail,
  consumeCollabDispatchApprovalConfirmation,
  issueCollabDispatchApprovalConfirmation,
} from "./collab-dispatch-confirmation.js";
import { createCollabDispatch } from "./collab-dispatch-store.js";

describe("collab-dispatch confirmation", () => {
  it("issues steward ticket bound to fingerprint; consume succeeds once", () => {
    const dispatch = createCollabDispatch({
      organizerUserId: "user-1",
      tenantId: "tenant-1",
      kind: "notice",
      title: "All-hands note",
      body: "Please read",
      recipients: [{ id: "user-2" }],
    });
    expect(collabDispatchApproveActionId(dispatch.id)).toBe(
      `collab.dispatch.approve:${dispatch.id}`,
    );
    const payload = buildCollabDispatchApprovalPayload(dispatch);
    expect(payload.kind).toBe("notice");
    expect(payload.timeWindow).toBeNull();

    const issued = issueCollabDispatchApprovalConfirmation(dispatch);
    expect(issued.proposalId).toBeTruthy();
    expect(issued.confirmationToken).toBeTruthy();
    // Token must not be confused with proposalId.
    expect(issued.confirmationToken).not.toBe(issued.proposalId);

    const detail = collabDispatchApprovalConfirmationDetail(dispatch, issued.expiresAtMs);
    expect(detail.title).toBe("All-hands note");
    expect(detail.impact).toContain("待办");

    const ok = consumeCollabDispatchApprovalConfirmation({
      dispatch,
      proposalId: issued.proposalId,
      confirmationToken: issued.confirmationToken,
    });
    expect(ok.ok).toBe(true);

    const again = consumeCollabDispatchApprovalConfirmation({
      dispatch,
      proposalId: issued.proposalId,
      confirmationToken: issued.confirmationToken,
    });
    expect(again.ok).toBe(false);
  });

  it("payload fingerprint includes time window when present", () => {
    const dispatch = createCollabDispatch({
      organizerUserId: "user-1",
      tenantId: "tenant-1",
      kind: "summon",
      title: "War room",
      timeWindow: { startAtMs: 1_700_000_000_000, timezone: "UTC" },
      recipients: [{ id: "user-2" }],
    });
    const payload = buildCollabDispatchApprovalPayload(dispatch);
    expect(payload.timeWindow).toEqual({
      startAtMs: 1_700_000_000_000,
      endAtMs: null,
      timezone: "UTC",
    });
    const detail = collabDispatchApprovalConfirmationDetail(dispatch, Date.now() + 60_000);
    expect(detail.impact).toContain("日程");
  });
});
