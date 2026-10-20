/* @vitest-environment jsdom */
import { render } from "lit";
import { describe, expect, it, vi } from "vitest";
import { renderCollaborationObservabilityPanel } from "./collaboration-observability-panel.ts";

describe("collaboration observability panel", () => {
  it("renders wake timeline and claim/peer sections", () => {
    const container = document.createElement("div");
    const onRefresh = vi.fn();
    render(
      renderCollaborationObservabilityPanel({
        loading: false,
        error: null,
        onRefresh,
        snapshot: {
          groupId: "grp_product",
          taskId: "task-1",
          events: [],
          timeline: [
            {
              from: "bot-a",
              to: "bot-b",
              source: "assistant_inline_at",
              outcome: "dispatched",
              at: 1_700_000_000_000,
              wakeId: "wake_1",
            },
          ],
          boardItems: [
            {
              itemId: "item-1",
              groupId: "grp_product",
              taskId: "task-1",
              title: "Ship claim UI",
              status: "claimed",
              claimantId: "bot-b",
            },
          ],
          peerReviews: [
            {
              reviewId: "pr-1",
              groupId: "grp_product",
              taskId: "task-1",
              itemId: "item-1",
              submissionId: "sub-1",
              reviewerId: "bot-c",
              authorId: "bot-b",
              verdict: "approve",
              at: 1_700_000_000_100,
            },
          ],
          memberProgress: {
            itemCount: 1,
            memberCount: 1,
            members: [],
            unclaimed: [],
            gaps: [],
          },
        },
      }),
      container,
    );

    expect(container.querySelector('[data-testid="collab-obs-panel"]')).toBeTruthy();
    expect(container.querySelector('[data-testid="collab-obs-wake-table"]')?.textContent).toContain(
      "bot-a",
    );
    expect(container.querySelector('[data-testid="collab-obs-claim-list"]')?.textContent).toContain(
      "Ship claim UI",
    );
    expect(container.querySelector('[data-testid="collab-obs-peer-list"]')?.textContent).toContain(
      "approve",
    );
    container.querySelector<HTMLButtonElement>('[data-testid="collab-obs-refresh"]')?.click();
    expect(onRefresh).toHaveBeenCalledTimes(1);
  });

  it("shows empty wake state", () => {
    const container = document.createElement("div");
    render(
      renderCollaborationObservabilityPanel({
        snapshot: {
          groupId: "grp_product",
          taskId: null,
          events: [],
          timeline: [],
          boardItems: [],
          peerReviews: [],
          memberProgress: null,
        },
      }),
      container,
    );
    expect(container.querySelector('[data-testid="collab-obs-wake-empty"]')).toBeTruthy();
  });
});
