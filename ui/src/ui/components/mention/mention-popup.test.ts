// @vitest-environment jsdom
import { render } from "lit";
import { describe, expect, it, vi } from "vitest";
import type { MentionCandidate } from "../../../../../src/organization/mention-types.js";
import {
  createMentionQueryDebouncer,
  deriveMentionPopupItems,
  handleMentionPopupKeydown,
  MENTION_ALL_AGENT_ID,
  moveMentionPopupActiveIndex,
  renderMentionPopup,
  resolveMentionPopupPlacement,
  shouldIncludeAllMembers,
} from "./mention-popup.js";

function candidate(overrides: Partial<MentionCandidate>): MentionCandidate {
  return {
    agentId: overrides.agentId ?? "agent-a",
    displayName: overrides.displayName ?? "Agent A",
    roleName: overrides.roleName,
    online: overrides.online ?? true,
    isCoordinator: overrides.isCoordinator ?? false,
    isBot: overrides.isBot ?? true,
    collaborationFrequency: overrides.collaborationFrequency,
    projectParticipation: overrides.projectParticipation,
    capabilityTags: overrides.capabilityTags,
    currentTask: overrides.currentTask,
  };
}

describe("MentionPopup", () => {
  it("excludes the current agent and prepends the all-members entry for empty queries", () => {
    const items = deriveMentionPopupItems({
      query: "",
      currentAgentId: "self",
      candidates: [
        candidate({ agentId: "self", displayName: "Self" }),
        candidate({ agentId: "teammate", displayName: "Teammate" }),
      ],
    });

    expect(items.map((item) => item.agentId)).toEqual([MENTION_ALL_AGENT_ID, "teammate"]);
  });

  it("shows the all-members entry only for empty or matching all-members queries", () => {
    expect(shouldIncludeAllMembers("")).toBe(true);
    expect(shouldIncludeAllMembers("al")).toBe(true);
    expect(shouldIncludeAllMembers("所有")).toBe(true);
    expect(shouldIncludeAllMembers("agent")).toBe(false);
  });

  it("positions below when there is room and above when below space is constrained", () => {
    expect(
      resolveMentionPopupPlacement({
        caretPosition: { top: 80, left: 32 },
        itemCount: 4,
        viewportHeight: 400,
      }),
    ).toMatchObject({
      placement: "below",
      top: 88,
      left: 32,
    });

    expect(
      resolveMentionPopupPlacement({
        caretPosition: { top: 360, left: 32 },
        itemCount: 4,
        viewportHeight: 400,
      }),
    ).toMatchObject({
      placement: "above",
      top: 176,
      left: 32,
    });
  });

  it("wraps keyboard navigation", () => {
    expect(moveMentionPopupActiveIndex(0, -1, 3)).toBe(2);
    expect(moveMentionPopupActiveIndex(2, 1, 3)).toBe(0);
  });

  it("handles keyboard navigation, selection, and dismissal", () => {
    const items = deriveMentionPopupItems({
      query: "",
      candidates: [candidate({ agentId: "a" }), candidate({ agentId: "b" })],
    });
    const preventDefault = vi.fn();
    const onActiveIndexChange = vi.fn();
    const onSelect = vi.fn();
    const onDismiss = vi.fn();

    expect(
      handleMentionPopupKeydown({
        event: { key: "ArrowDown", preventDefault },
        items,
        activeIndex: 0,
        onActiveIndexChange,
      }),
    ).toBe(true);
    expect(onActiveIndexChange).toHaveBeenCalledWith(1);

    expect(
      handleMentionPopupKeydown({
        event: { key: "Enter", preventDefault },
        items,
        activeIndex: 1,
        onSelect,
      }),
    ).toBe(true);
    expect(onSelect).toHaveBeenCalledWith(items[1]);

    expect(
      handleMentionPopupKeydown({
        event: { key: "Escape", preventDefault },
        items,
        activeIndex: 1,
        onDismiss,
      }),
    ).toBe(true);
    expect(onDismiss).toHaveBeenCalledOnce();
    expect(preventDefault).toHaveBeenCalledTimes(3);
  });

  it("renders an accessible listbox with active option and candidate badges", () => {
    const container = document.createElement("div");
    render(
      renderMentionPopup({
        id: "mention-test",
        query: "",
        activeIndex: 1,
        caretPosition: { top: 120, left: 48 },
        viewportHeight: 500,
        candidates: [
          candidate({
            agentId: "coordinator",
            displayName: "张管理员",
            roleName: "Coordinator",
            isCoordinator: true,
            capabilityTags: ["调度", "审批"],
            currentTask: "处理中高优先级任务",
          }),
          candidate({
            agentId: "offline",
            displayName: "Offline Bot",
            roleName: "Reviewer",
            online: false,
          }),
        ],
      }),
      container,
    );

    const popup = container.querySelector<HTMLElement>('[role="listbox"]');
    expect(popup?.getAttribute("aria-expanded")).toBe("true");
    expect(popup?.getAttribute("aria-activedescendant")).toBe("mention-test-option-1");
    expect(popup?.style.maxHeight).toBe("132px");
    expect(container.querySelectorAll('[role="option"]')).toHaveLength(3);
    expect(container.querySelector('[aria-selected="true"]')?.textContent).toContain("张管理员");
    expect(container.textContent).toContain("Coordinator");
    expect(container.textContent).toContain("调度 / 审批");
    expect(container.textContent).toContain("处理中高优先级任务");
    expect(container.textContent).toContain("Bot");
    expect(container.textContent).toContain("离线");
  });

  it("selects candidates on click", () => {
    const container = document.createElement("div");
    const onSelect = vi.fn();
    render(
      renderMentionPopup({
        query: "age",
        caretPosition: { top: 120, left: 48 },
        candidates: [candidate({ agentId: "agent-a", displayName: "Agent A" })],
        onSelect,
      }),
      container,
    );

    container.querySelector<HTMLElement>('[role="option"]')?.click();
    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ agentId: "agent-a" }));
  });

  it("debounces query updates within the configured window", () => {
    vi.useFakeTimers();
    try {
      const onQueryChange = vi.fn();
      const debouncer = createMentionQueryDebouncer(onQueryChange, 50);

      debouncer.update("a");
      debouncer.update("ag");
      vi.advanceTimersByTime(49);
      expect(onQueryChange).not.toHaveBeenCalled();

      vi.advanceTimersByTime(1);
      expect(onQueryChange).toHaveBeenCalledOnce();
      expect(onQueryChange).toHaveBeenCalledWith("ag");
    } finally {
      vi.useRealTimers();
    }
  });
});
