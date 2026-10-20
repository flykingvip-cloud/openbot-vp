// @vitest-environment jsdom
import { render } from "lit";
import { describe, expect, it, vi } from "vitest";
import type { MentionChipData } from "../../../../../src/organization/mention-types.js";
import {
  getMentionChipTooltip,
  handleMentionChipKeydown,
  renderMentionChip,
  toMentionChipPlainText,
} from "./mention-chip.js";

function chip(overrides: Partial<MentionChipData> = {}): MentionChipData {
  return {
    mention_id: overrides.mention_id ?? "mention-1",
    agentId: overrides.agentId ?? "agent-a",
    displayName: overrides.displayName ?? "Agent A",
    isAll: overrides.isAll ?? false,
  };
}

describe("MentionChip", () => {
  it("produces the plain text representation used for copy and metadata offsets", () => {
    expect(toMentionChipPlainText(chip({ displayName: "张管理员" }))).toBe("@张管理员");
  });

  it("builds a tooltip from role and presence state", () => {
    expect(
      getMentionChipTooltip({
        chip: chip(),
        roleName: "Reviewer",
        online: false,
      }),
    ).toBe("Reviewer · 离线");

    expect(getMentionChipTooltip({ chip: chip(), tooltip: "Custom" })).toBe("Custom");
  });

  it("removes the entire chip on Backspace or Delete", () => {
    const removeTarget = chip();
    const onRemove = vi.fn();
    const preventDefault = vi.fn();
    const stopPropagation = vi.fn();

    expect(
      handleMentionChipKeydown({
        event: { key: "Backspace", preventDefault, stopPropagation },
        chip: removeTarget,
        onRemove,
      }),
    ).toBe(true);

    expect(onRemove).toHaveBeenCalledWith(removeTarget);
    expect(preventDefault).toHaveBeenCalledOnce();
    expect(stopPropagation).toHaveBeenCalledOnce();
  });

  it("ignores unrelated keys", () => {
    const onRemove = vi.fn();
    expect(
      handleMentionChipKeydown({
        event: {
          key: "Enter",
          preventDefault: vi.fn(),
          stopPropagation: vi.fn(),
        },
        chip: chip(),
        onRemove,
      }),
    ).toBe(false);
    expect(onRemove).not.toHaveBeenCalled();
  });

  it("renders a non-editable accessible chip with all-member styling", () => {
    const container = document.createElement("div");
    render(
      renderMentionChip({
        chip: chip({
          mention_id: "mention-all",
          agentId: "__all__",
          displayName: "所有人",
          isAll: true,
        }),
        roleName: "All Members",
        online: true,
      }),
      container,
    );

    const element = container.querySelector<HTMLElement>(".mention-chip");
    expect(element?.getAttribute("role")).toBe("button");
    expect(element?.getAttribute("contenteditable")).toBe("false");
    expect(element?.getAttribute("aria-label")).toBe("Remove mention: 所有人");
    expect(element?.dataset.mentionId).toBe("mention-all");
    expect(element?.dataset.agentId).toBe("__all__");
    expect(element?.dataset.plainText).toBe("@所有人");
    expect(element?.classList.contains("mention-chip--all")).toBe(true);
    expect(element?.textContent).toContain("@所有人");
    expect(element?.getAttribute("title")).toBe("All Members · 在线");
  });

  it("wires keydown removal from the rendered chip", () => {
    const container = document.createElement("div");
    const onRemove = vi.fn();
    const renderedChip = chip({ mention_id: "mention-a" });
    render(renderMentionChip({ chip: renderedChip, onRemove }), container);

    container.querySelector<HTMLElement>(".mention-chip")?.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "Delete",
        bubbles: true,
      }),
    );

    expect(onRemove).toHaveBeenCalledWith(renderedChip);
  });
});
