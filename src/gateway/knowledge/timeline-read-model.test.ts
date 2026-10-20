import { describe, expect, it } from "vitest";
import type { KnowledgeDiscoveryEvent } from "./discovery/types.js";
import { buildKnowledgeFeedDailyDigest } from "./feed/daily-digest.js";
import { bucketDiscoveryEventsForTimeline } from "./timeline-read-model.js";

function event(
  partial: Partial<KnowledgeDiscoveryEvent> &
    Pick<KnowledgeDiscoveryEvent, "eventId" | "timestamp">,
): KnowledgeDiscoveryEvent {
  return {
    eventType: "knowledge_committed",
    eventSource: "lineage",
    title: "t",
    summary: "s",
    relatedKnowledge: {},
    ...partial,
  };
}

describe("timeline + feed digest (P2)", () => {
  it("buckets discovery events by day", () => {
    // Use local calendar construction so dayKey labels are timezone-stable.
    const now = new Date(2026, 6, 14, 12, 0, 0).getTime();
    const todayMorning = new Date(2026, 6, 14, 10, 0, 0).getTime();
    const todayNoon = new Date(2026, 6, 14, 11, 0, 0).getTime();
    const yesterday = new Date(2026, 6, 13, 10, 0, 0).getTime();
    const buckets = bucketDiscoveryEventsForTimeline({
      now,
      events: [
        event({ eventId: "1", timestamp: todayMorning, title: "today" }),
        event({ eventId: "2", timestamp: yesterday, title: "yesterday" }),
        event({ eventId: "3", timestamp: todayNoon, title: "today2" }),
      ],
    });
    expect(buckets[0]?.dayKey).toBe("2026-07-14");
    expect(buckets[0]?.events).toHaveLength(2);
    expect(buckets[0]?.label).toBe("今天");
    expect(buckets[1]?.label).toBe("昨天");
  });

  it("builds daily digest counts and headline", () => {
    const now = new Date(2026, 6, 14, 12, 0, 0).getTime();
    const digest = buildKnowledgeFeedDailyDigest({
      now,
      discoveryEvents: [
        event({
          eventId: "1",
          timestamp: now,
          eventType: "knowledge_committed",
          title: "new",
        }),
        event({
          eventId: "2",
          timestamp: now,
          eventType: "new_conflict",
          title: "gov",
        }),
        event({
          eventId: "3",
          timestamp: new Date(2026, 6, 1, 12, 0, 0).getTime(),
          title: "old",
        }),
      ],
      actions: [
        {
          actionId: "a1",
          actionType: "open_governance",
          title: "Review conflict",
          reason: "open conflict",
          score: 80,
          context: {},
          executable: true,
        },
      ],
    });
    expect(digest.dayKey).toBe("2026-07-14");
    expect(digest.counts.newKnowledge).toBe(1);
    expect(digest.counts.governance).toBe(1);
    expect(digest.counts.actions).toBe(1);
    expect(digest.headline).toContain("今日");
    expect(digest.highlights.length).toBeGreaterThanOrEqual(2);
  });
});
