// @vitest-environment jsdom
import { render } from "lit";
import { describe, expect, it, vi } from "vitest";
import { createMentionEventBus } from "../../../../../src/organization/mention-events.js";
import type { MentionMetadata } from "../../../../../src/organization/mention-types.js";
import {
  buildMentionRenderParts,
  createMentionRenderStateTracker,
  renderMentionedMessage,
} from "./mention-renderer.js";

function mention(overrides: Partial<MentionMetadata> = {}): MentionMetadata {
  return {
    mention_id: overrides.mention_id ?? "mention-1",
    agentId: overrides.agentId ?? "agent-a",
    displayName: overrides.displayName ?? "Agent A",
    offset: overrides.offset ?? 3,
    length: overrides.length ?? 8,
  };
}

describe("mention renderer", () => {
  it("builds text and mention parts from offset metadata", () => {
    expect(
      buildMentionRenderParts({
        text: "Hi @Agent A",
        mentions: [mention()],
      }),
    ).toEqual([
      { type: "text", text: "Hi " },
      {
        type: "mention",
        text: "@Agent A",
        mention: mention(),
      },
    ]);
  });

  it("renders mention spans with chip-compatible classes", () => {
    const container = document.createElement("div");
    render(
      renderMentionedMessage({
        text: "Hi @Agent A",
        mentions: [mention()],
      }),
      container,
    );

    const renderedMention = container.querySelector<HTMLElement>(".mention-renderer__mention");
    expect(renderedMention?.dataset.mentionId).toBe("mention-1");
    expect(renderedMention?.dataset.agentId).toBe("agent-a");
    expect(renderedMention?.classList.contains("mention-chip")).toBe(true);
    expect(renderedMention?.textContent).toContain("@Agent A");
  });

  it("uses internal anchors when available and resolves agent ids from known metadata", () => {
    const container = document.createElement("div");
    render(
      renderMentionedMessage({
        text: 'Hi <mention id="mention-1">@Agent A</mention>',
        mentions: [mention({ agentId: "agent-a", displayName: "Agent A" })],
      }),
      container,
    );

    expect(container.textContent?.replace(/\s+/g, " ").trim()).toContain("Hi @Agent A");
    expect(
      container.querySelector<HTMLElement>(".mention-renderer__mention")?.dataset.agentId,
    ).toBe("agent-a");
  });

  it("marks self mentions and removed members", () => {
    const container = document.createElement("div");
    render(
      renderMentionedMessage({
        text: "@Agent A and @Old Agent",
        mentions: [
          mention({ mention_id: "mention-self", agentId: "agent-a", offset: 0, length: 8 }),
          mention({
            mention_id: "mention-removed",
            agentId: "old-agent",
            displayName: "Old Agent",
            offset: 13,
            length: 10,
          }),
        ],
        currentAgentId: "agent-a",
        removedAgentIds: ["old-agent"],
      }),
      container,
    );

    expect(container.querySelector(".is-self-mentioned")?.textContent).toContain("你");
    expect(container.querySelector(".is-removed")?.getAttribute("title")).toBe("成员已移除");
  });

  it("highlights human mentions and mutes removed humans", () => {
    const container = document.createElement("div");
    render(
      renderMentionedMessage({
        text: "@Alice and @Old Human",
        mentions: [
          {
            mention_id: "m-alice",
            displayName: "Alice",
            offset: 0,
            length: 6,
            target: { kind: "human", userId: "alice" },
            targetKind: "human",
            targetId: "alice",
          },
          {
            mention_id: "m-old",
            displayName: "Old Human",
            offset: 11,
            length: 10,
            target: { kind: "human", userId: "old-human" },
            targetKind: "human",
            targetId: "old-human",
          },
        ],
        removedUserIds: ["old-human"],
      }),
      container,
    );

    const alice = container.querySelector<HTMLElement>('[data-mention-id="m-alice"]');
    const old = container.querySelector<HTMLElement>('[data-mention-id="m-old"]');
    expect(alice?.dataset.targetKind).toBe("human");
    expect(alice?.dataset.userId).toBe("alice");
    expect(alice?.classList.contains("mention-chip--human")).toBe(true);
    expect(old?.classList.contains("is-removed")).toBe(true);
    expect(old?.classList.contains("is-muted")).toBe(true);
    expect(old?.textContent).toContain("@Old Human");
  });

  it("renders mention state indicators", () => {
    const container = document.createElement("div");
    render(
      renderMentionedMessage({
        text: "Hi @Agent A",
        mentions: [mention()],
        mentionStates: new Map([["mention-1", "acknowledged"]]),
      }),
      container,
    );

    expect(
      container.querySelector(".mention-renderer__state--acknowledged")?.textContent,
    ).toContain("✅");
  });

  it("tracks mention event bus states and unsubscribes cleanly", () => {
    const eventBus = createMentionEventBus();
    const onChange = vi.fn();
    const tracker = createMentionRenderStateTracker({
      eventBus,
      targetAgentId: "agent-a",
      organizationId: "org-1",
      onChange,
    });

    eventBus.emit({
      type: "mention.created",
      mention_id: "mention-1",
      source_agent_id: "source",
      target_agent_id: "agent-a",
      organization_id: "org-1",
      timestamp: "2026-05-12T00:00:00.000Z",
    });
    expect(tracker.getState("mention-1")).toBe("awaiting");

    eventBus.emit({
      type: "mention.responded",
      mention_id: "mention-1",
      source_agent_id: "source",
      target_agent_id: "agent-a",
      organization_id: "org-1",
      timestamp: "2026-05-12T00:01:00.000Z",
    });
    expect(tracker.getState("mention-1")).toBe("taskAccepted");
    expect(onChange).toHaveBeenCalledTimes(2);

    tracker.dispose();
    eventBus.emit({
      type: "mention.acknowledged",
      mention_id: "mention-1",
      source_agent_id: "source",
      target_agent_id: "agent-a",
      organization_id: "org-1",
      timestamp: "2026-05-12T00:02:00.000Z",
    });
    expect(tracker.getState("mention-1")).toBe("taskAccepted");
  });
});
