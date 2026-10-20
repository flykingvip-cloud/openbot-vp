import { describe, expect, it, vi } from "vitest";
import { createMentionEventBus } from "./mention-events.js";
import type { MentionEvent } from "./mention-types.js";

function event(overrides: Partial<MentionEvent> = {}): MentionEvent {
  return {
    type: overrides.type ?? "mention.created",
    mention_id: overrides.mention_id ?? "mention-1",
    source_agent_id: overrides.source_agent_id ?? "agent-a",
    target_agent_id: overrides.target_agent_id ?? "agent-b",
    organization_id: overrides.organization_id ?? "org-1",
    timestamp: overrides.timestamp ?? "2026-05-12T00:00:00.000Z",
    payload: overrides.payload,
  };
}

describe("MentionEventBus", () => {
  it("emits events to matching subscribers", () => {
    const bus = createMentionEventBus();
    const handler = vi.fn();
    const mentionEvent = event();

    bus.subscribe({}, handler);
    bus.emit(mentionEvent);

    expect(handler).toHaveBeenCalledWith(mentionEvent);
  });

  it("matches filters with AND semantics", () => {
    const bus = createMentionEventBus();
    const handler = vi.fn();

    bus.subscribe(
      {
        type: "mention.acknowledged",
        target_agent_id: "agent-b",
        organization_id: "org-1",
      },
      handler,
    );
    bus.emit(event({ type: "mention.created" }));
    bus.emit(event({ type: "mention.acknowledged", target_agent_id: "agent-c" }));
    bus.emit(event({ type: "mention.acknowledged", target_agent_id: "agent-b" }));

    expect(handler).toHaveBeenCalledOnce();
  });

  it("removes subscriptions when unsubscribe is called", () => {
    const bus = createMentionEventBus();
    const handler = vi.fn();
    const unsubscribe = bus.subscribe({}, handler);

    unsubscribe();
    bus.emit(event());

    expect(handler).not.toHaveBeenCalled();
  });

  it("delivers the same event to multiple subscribers", () => {
    const bus = createMentionEventBus();
    const first = vi.fn();
    const second = vi.fn();

    bus.subscribe({}, first);
    bus.subscribe({}, second);
    bus.emit(event());

    expect(first).toHaveBeenCalledOnce();
    expect(second).toHaveBeenCalledOnce();
  });
});
