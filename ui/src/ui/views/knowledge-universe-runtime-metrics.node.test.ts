// @vitest-environment node
import { describe, expect, it } from "vitest";
import type { KnowledgeDiscoveryEvent } from "../capability/knowledge-universe/types.ts";
import {
  computeWorkspaceTrends,
  WORKSPACE_TREND_DAYS,
} from "./knowledge-universe-runtime-metrics.ts";

const DAY = 86_400_000;

function event(
  eventType: KnowledgeDiscoveryEvent["eventType"],
  timestamp: number,
): Pick<KnowledgeDiscoveryEvent, "eventType" | "timestamp"> {
  return { eventType, timestamp };
}

describe("computeWorkspaceTrends", () => {
  it("categorizes and buckets discovery events by day", () => {
    const now = 14 * DAY + 1000;
    const trends = computeWorkspaceTrends(
      [
        event("new_relation", now),
        event("new_relation", now - DAY),
        event("knowledge_committed", now),
        event("frequently_cited", now - 2 * DAY),
        event("new_conflict", now),
        event("new_duplicate", now),
        event("deliverable_completed", now - 100 * DAY), // outside window -> ignored
      ],
      now,
    );

    expect(trends.relations.total).toBe(2);
    expect(trends.evolution.total).toBe(1);
    expect(trends.citations.total).toBe(1);
    expect(trends.governance.total).toBe(2);
    expect(trends.relations.buckets).toHaveLength(WORKSPACE_TREND_DAYS);
    // Today is the last (newest) bucket.
    expect(trends.relations.buckets[WORKSPACE_TREND_DAYS - 1]).toBe(1);
    expect(trends.evolution.buckets[WORKSPACE_TREND_DAYS - 1]).toBe(1);
  });

  it("computes a week-over-week delta from the same window", () => {
    const now = 30 * DAY;
    const trends = computeWorkspaceTrends(
      [
        event("new_relation", now - 10 * DAY), // prior week
        event("new_relation", now - DAY), // recent week
        event("new_relation", now - 2 * DAY), // recent week
        event("new_relation", now - 3 * DAY), // recent week
      ],
      now,
    );
    // prior = 1, recent = 3 -> (3 - 1) / 1 * 100 = 200
    expect(trends.relations.deltaPct).toBe(200);
  });

  it("returns a null delta when the prior week had no activity", () => {
    const now = 30 * DAY;
    expect(computeWorkspaceTrends([event("new_relation", now)], now).relations.deltaPct).toBeNull();
    expect(computeWorkspaceTrends([], now).evolution.total).toBe(0);
  });
});
