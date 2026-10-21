// @vitest-environment jsdom
import { render } from "lit";
import { describe, expect, it, vi } from "vitest";
import { renderMeetingConfirmationCard } from "./workbench-stage-assistant.ts";

describe("renderMeetingConfirmationCard stale ticket", () => {
  it("shows the old card as invalid and offers reissue", () => {
    const onConfirm = vi.fn(async () => undefined);
    const container = document.createElement("div");
    render(
      renderMeetingConfirmationCard({
        meetingPendingConfirmation: {
          meeting: { id: "mtg_old", title: "周会", status: "pending_approval" },
          confirmation: {
            proposalId: "mcp_old",
            confirmationToken: "tok-old",
            payloadHash: "hash",
            expiresAtMs: Date.now() - 5_000,
          },
          confirmationDetail: {
            title: "周会",
            impact: "确认后写入日程",
            irreversible: false,
            expiresAtMs: Date.now() - 5_000,
          },
          message: "请确认",
        },
        meetingConfirmationLoading: false,
        meetingConfirmationError: null,
        meetingConfirmationOldCardInvalid: false,
        onConfirmMeetingPendingApproval: onConfirm,
        onCancelMeetingPendingConfirmation: vi.fn(),
      }),
      container,
    );
    const card = container.querySelector('[data-meeting-confirm-card="true"]');
    expect(card?.getAttribute("data-meeting-old-card-invalid")).toBe("true");
    expect(container.textContent).toContain("旧卡已失效");
    expect(container.textContent).toContain("重新确认");
    expect(container.textContent).not.toContain("tok-old");
    (container.querySelector("button.primary") as HTMLButtonElement).click();
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });
});
