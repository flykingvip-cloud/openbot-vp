// @vitest-environment jsdom
import { render } from "lit";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildHumanAttentionCard,
  type HumanAttentionCard,
} from "../../../../src/gateway/collaboration-dispatch/human-attention-card.js";
import { readHumanAttentionRow, renderHumanAttentionCards } from "./human-attention-card.ts";

function baseCard(overrides: Partial<HumanAttentionCard> = {}): HumanAttentionCard {
  const card = buildHumanAttentionCard({
    todoId: "g|i|fp",
    groupId: "g",
    taskId: "t",
    boardItemId: "i",
    fingerprint: "fp",
    version: 1,
    failureKind: "side_effect_unknown",
    reason: "started_or_unknown",
    ownerIds: ["human:amy"],
    recoveryHint: "verify first",
    taskTitle: "Demo",
    boardStatus: "in_progress",
  });
  if (!card) {
    throw new Error("card build failed");
  }
  return { ...card, ...overrides };
}

describe("human-attention-card UI", () => {
  const containers: HTMLElement[] = [];
  afterEach(() => {
    for (const el of containers) {
      el.remove();
    }
    containers.length = 0;
  });

  it("reads structured humanAttention and renders action buttons without blind retry", () => {
    const card = baseCard();
    const read = readHumanAttentionRow({ role: "assistant", humanAttention: card });
    expect(read?.authority).toBe("structured");
    expect(read?.card.options.some((o) => o.id === "retry_after_fix")).toBe(false);

    const container = document.createElement("div");
    document.body.appendChild(container);
    containers.push(container);
    const onAct = vi.fn();
    render(
      renderHumanAttentionCards([{ role: "assistant", humanAttention: card }], { onAct }),
      container,
    );
    expect(container.querySelector("[data-human-attention='g|i|fp']")).toBeTruthy();
    const actions = [...container.querySelectorAll("[data-human-attention-action]")].map((el) =>
      el.getAttribute("data-human-attention-action"),
    );
    expect(actions).toEqual(["view_evidence", "confirm_completed", "release_after_verify"]);
    expect(actions).not.toContain("retry_after_fix");
  });

  it("dedupes sticky pile by todoId keeping latest", () => {
    const v1 = baseCard({ version: 1, title: "任务需要你处理" });
    const v2 = baseCard({ version: 2, title: "任务需要你处理" });
    const container = document.createElement("div");
    document.body.appendChild(container);
    containers.push(container);
    render(
      renderHumanAttentionCards([
        { role: "assistant", humanAttention: v1 },
        { role: "assistant", humanAttention: v2 },
      ]),
      container,
    );
    const nodes = container.querySelectorAll("[data-human-attention='g|i|fp']");
    expect(nodes).toHaveLength(1);
    expect(nodes[0]?.getAttribute("data-human-attention-version")).toBe("2");
  });
});
