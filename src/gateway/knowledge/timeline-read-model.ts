import type { GatewayClient } from "../server-methods/types.js";
import { listKnowledgeDiscoveryEvents } from "./discovery/event-projector.js";
/**
 * P2 Timeline read model — aggregates discovery events into day buckets.
 * Answers: recently added knowledge, frequently cited, governance alerts.
 */
import type { KnowledgeDiscoveryEvent } from "./discovery/types.js";

export type KnowledgeTimelineBucket = {
  dayKey: string;
  label: string;
  events: KnowledgeDiscoveryEvent[];
};

export type KnowledgeTimelineResponse = {
  buckets: KnowledgeTimelineBucket[];
  totalEvents: number;
  lookbackMs: number;
  generatedAt: number;
};

function dayKeyOf(timestamp: number): string {
  const d = new Date(timestamp);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function labelForDayKey(dayKey: string, now: number): string {
  const today = dayKeyOf(now);
  const yesterday = dayKeyOf(now - 24 * 60 * 60 * 1000);
  if (dayKey === today) {
    return "今天";
  }
  if (dayKey === yesterday) {
    return "昨天";
  }
  return dayKey;
}

export function bucketDiscoveryEventsForTimeline(params: {
  events: KnowledgeDiscoveryEvent[];
  now?: number;
  maxBuckets?: number;
}): KnowledgeTimelineBucket[] {
  const now = params.now ?? Date.now();
  const maxBuckets = params.maxBuckets ?? 14;
  const byDay = new Map<string, KnowledgeDiscoveryEvent[]>();
  for (const event of params.events) {
    const key = dayKeyOf(event.timestamp);
    const list = byDay.get(key) ?? [];
    list.push(event);
    byDay.set(key, list);
  }
  return [...byDay.entries()]
    .toSorted((a, b) => b[0].localeCompare(a[0]))
    .slice(0, maxBuckets)
    .map(([dayKey, events]) => ({
      dayKey,
      label: labelForDayKey(dayKey, now),
      events: events.toSorted((left, right) => right.timestamp - left.timestamp),
    }));
}

export async function listKnowledgeTimeline(params: {
  client: GatewayClient | null;
  limit?: number;
  lookbackMs?: number;
}): Promise<KnowledgeTimelineResponse> {
  const lookbackMs = params.lookbackMs ?? 14 * 24 * 60 * 60 * 1000;
  const events = await listKnowledgeDiscoveryEvents({
    client: params.client,
    limit: Math.min(Math.max(params.limit ?? 40, 1), 80),
    lookbackMs,
  });
  const generatedAt = Date.now();
  const buckets = bucketDiscoveryEventsForTimeline({ events, now: generatedAt });
  return {
    buckets,
    totalEvents: events.length,
    lookbackMs,
    generatedAt,
  };
}
