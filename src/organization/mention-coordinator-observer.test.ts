import { describe, expect, it, vi } from "vitest";
import { createCoordinatorObserver } from "./mention-coordinator-observer.js";
import { createMentionEventBus } from "./mention-events.js";
import type { MentionEvent } from "./mention-types.js";

function event(overrides: Partial<MentionEvent> = {}): MentionEvent {
  return {
    type: "mention.created",
    mention_id: "mention-1",
    source_agent_id: "agent-source",
    target_agent_id: "agent-target",
    organization_id: "org-1",
    timestamp: "2026-05-12T00:00:00.000Z",
    ...overrides,
  };
}

describe("CoordinatorObserver", () => {
  it("mirrors mention.created events to the coordinator asynchronously", async () => {
    const eventBus = createMentionEventBus();
    const notifyCoordinator = vi.fn();
    createCoordinatorObserver({
      eventBus,
      organizationId: "org-1",
      coordinatorAgentId: "coordinator",
      notifyCoordinator,
    });

    eventBus.emit(event());
    expect(notifyCoordinator).not.toHaveBeenCalled();
    await vi.waitFor(() => {
      expect(notifyCoordinator).toHaveBeenCalledWith(
        expect.objectContaining({
          coordinatorAgentId: "coordinator",
          decision: { action: "none" },
          event: expect.objectContaining({ mention_id: "mention-1" }),
        }),
      );
    });
  });

  it("does not observe when no coordinator exists", async () => {
    const eventBus = createMentionEventBus();
    const notifyCoordinator = vi.fn();
    createCoordinatorObserver({
      eventBus,
      organizationId: "org-1",
      notifyCoordinator,
    });

    eventBus.emit(event());
    await Promise.resolve();
    expect(notifyCoordinator).not.toHaveBeenCalled();
  });

  it("evaluates intervention decisions before coordinator notification", async () => {
    const eventBus = createMentionEventBus();
    const notifyCoordinator = vi.fn();
    createCoordinatorObserver({
      eventBus,
      organizationId: "org-1",
      coordinatorAgentId: "coordinator",
      evaluateIntervention: () => ({ action: "escalate", reason: "urgent" }),
      notifyCoordinator,
    });

    eventBus.emit(event());
    await vi.waitFor(() => {
      expect(notifyCoordinator).toHaveBeenCalledWith(
        expect.objectContaining({
          decision: { action: "escalate", reason: "urgent" },
        }),
      );
    });
  });
});
