import { describe, expect, it, vi } from "vitest";
import { createSubscribedSessionHarness } from "./pi-embedded-subscribe.e2e-harness.js";

type AgentEventLike = { stream?: unknown; data?: { phase?: unknown; aborted?: unknown } };

function compactionEndEvents(onAgentEvent: ReturnType<typeof vi.fn>): AgentEventLike[] {
  return onAgentEvent.mock.calls
    .map((call) => call[0] as AgentEventLike)
    .filter((evt) => evt?.stream === "compaction" && evt?.data?.phase === "end");
}

describe("subscribeEmbeddedPiSession flushPendingCompactionEnd", () => {
  it("emits a paired compaction end when a run terminates mid-compaction", () => {
    const onAgentEvent = vi.fn();
    const { emit, subscription } = createSubscribedSessionHarness({ runId: "run-x", onAgentEvent });

    emit({ type: "auto_compaction_start" });
    expect(subscription.isCompactionInFlight()).toBe(true);

    subscription.flushPendingCompactionEnd();

    expect(subscription.isCompactionInFlight()).toBe(false);
    const ends = compactionEndEvents(onAgentEvent);
    expect(ends).toHaveLength(1);
    expect(ends[0]?.data?.aborted).toBe(true);
  });

  it("is a no-op when compaction is not in flight", () => {
    const onAgentEvent = vi.fn();
    const { subscription } = createSubscribedSessionHarness({ runId: "run-y", onAgentEvent });

    subscription.flushPendingCompactionEnd();

    expect(compactionEndEvents(onAgentEvent)).toHaveLength(0);
  });

  it("does not double-emit end after a normal compaction end", () => {
    const onAgentEvent = vi.fn();
    const { emit, subscription } = createSubscribedSessionHarness({ runId: "run-z", onAgentEvent });

    emit({ type: "auto_compaction_start" });
    emit({ type: "auto_compaction_end", willRetry: false, result: { summary: "s" } });
    expect(subscription.isCompactionInFlight()).toBe(false);

    // A normal end already fired its event; the flush must be a no-op.
    subscription.flushPendingCompactionEnd();

    expect(compactionEndEvents(onAgentEvent)).toHaveLength(1);
  });
});
