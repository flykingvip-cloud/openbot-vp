// @vitest-environment node

import { describe, expect, it } from "vitest";
import { BILLING_FAILED_EVENT_RETENTION_MS, compactBillingEventLog } from "./event-log-compact.ts";
import type { DurableEvent, UsageReportedEvent } from "./types.ts";

const NOW = Date.parse("2026-10-04T12:00:00.000Z");

function usage(eventId: string, key: string, quantity: number): UsageReportedEvent {
  return {
    type: "usage.reported",
    enterpriseId: "ent-1",
    userId: "user-1",
    eventId,
    key,
    quantity,
    occurredAt: "2026-10-04T01:00:00.000Z",
    agentId: "knowledge-governance",
  };
}

function row(
  seq: number,
  status: DurableEvent["status"],
  event: DurableEvent["event"],
  recordedAt: string,
  enterpriseId = "ent-1",
): DurableEvent {
  return { seq, status, enterpriseId, event, recordedAt };
}

describe("compactBillingEventLog", () => {
  it("drops delivered events and failed events that are 24 hours old", () => {
    const fresh = new Date(NOW - 60_000).toISOString();
    const exactly = new Date(NOW - BILLING_FAILED_EVENT_RETENTION_MS).toISOString();
    const justInside = new Date(NOW - BILLING_FAILED_EVENT_RETENTION_MS + 1).toISOString();
    const result = compactBillingEventLog(
      [
        row(1, "done", usage("done-1", "ai_token", 1), fresh),
        row(2, "failed", usage("expired", "ai_token", 1), exactly),
        row(3, "failed", usage("kept-failed", "ai_token", 1), justInside),
        row(4, "pending", usage("kept-pending", "ai_token", 1), exactly),
        row(5, "failed", usage("unparsed", "ai_token", 1), "not-a-date"),
        row(
          6,
          "done",
          {
            type: "bot.changed",
            enterpriseId: "ent-1",
            botId: "bot-1",
            ownerUserId: "user-1",
            action: "created",
          },
          fresh,
        ),
      ],
      [],
      NOW,
    );
    expect(result.changed).toBe(true);
    expect(result.events.map((event) => event.seq)).toEqual([3, 4, 5]);
    expect(result.deliveredUsage.map((entry) => entry.eventId)).toEqual(["done-1"]);
  });

  it("keeps call, token, and per-knowledge-base usage on one gov-llm event", () => {
    const recordedAt = new Date(NOW - 60_000).toISOString();
    const result = compactBillingEventLog(
      [
        row(
          4,
          "done",
          usage("gov-llm:call:kb_a:call-7", "knowledge_governance_llm_call", 1),
          recordedAt,
        ),
        row(
          2,
          "failed",
          usage("gov-llm:tokens:kb_a:call-7", "knowledge_governance_llm_tokens", 50),
          recordedAt,
        ),
        row(3, "failed", usage("credit:gov-llm:kb_a:call-7", "ai_credits", 4), recordedAt),
        row(5, "failed", usage("gov-llm:kb_b:call-7", "ai_credits", 6), recordedAt),
        row(
          6,
          "failed",
          usage("gov-llm:tokens:kb_b:call-7", "knowledge_governance_llm_tokens", 70),
          recordedAt,
        ),
        row(
          7,
          "failed",
          usage("gov-llm:call:kb_a:call-7", "knowledge_governance_llm_call", 1),
          recordedAt,
          "ent-2",
        ),
        row(
          8,
          "failed",
          usage("gov-llm:tokens:kb_a:call-7", "knowledge_governance_llm_tokens", 9),
          recordedAt,
          "ent-2",
        ),
      ],
      [],
      NOW,
    );
    expect(result.events).toHaveLength(2);
    const primary = result.events.find((event) => event.enterpriseId === "ent-1");
    expect(primary?.seq).toBe(2);
    expect(primary?.status).toBe("failed");
    expect(primary?.event).toMatchObject({
      type: "usage.reported",
      eventId: "gov-llm:invocation:call-7",
      key: "knowledge_governance_llm",
      quantity: 120,
      governanceLlm: {
        callId: "call-7",
        knowledgeBaseIds: ["kb_a", "kb_b"],
        callQuantity: 1,
        tokenQuantity: 120,
        creditQuantity: 10,
        sourceEventIds: [
          "credit:gov-llm:kb_a:call-7",
          "gov-llm:call:kb_a:call-7",
          "gov-llm:kb_b:call-7",
          "gov-llm:tokens:kb_a:call-7",
          "gov-llm:tokens:kb_b:call-7",
        ],
      },
    });
    const otherEnterprise = result.events.find((event) => event.enterpriseId === "ent-2");
    expect(otherEnterprise?.event).toMatchObject({
      eventId: "gov-llm:invocation:call-7",
      quantity: 9,
      governanceLlm: { callQuantity: 1, tokenQuantity: 9, creditQuantity: 0 },
    });
    expect(result.deliveredUsage).toEqual([]);
  });

  it("does not double-count a split row already stored on the invocation", () => {
    const recordedAt = new Date(NOW - 60_000).toISOString();
    const invocationEvent = {
      ...usage("gov-llm:invocation:call-3", "knowledge_governance_llm", 10),
      governanceLlm: {
        callId: "call-3",
        knowledgeBaseIds: ["kb_a"],
        callQuantity: 1,
        tokenQuantity: 10,
        creditQuantity: 2,
        sourceEventIds: [
          "gov-llm:call:kb_a:call-3",
          "gov-llm:tokens:kb_a:call-3",
          "credit:gov-llm:kb_a:call-3",
        ],
      },
    };
    const invocation = row(1, "failed", invocationEvent, recordedAt);
    const duplicateTokens = row(
      2,
      "failed",
      usage("gov-llm:tokens:kb_a:call-3", "knowledge_governance_llm_tokens", 10),
      recordedAt,
    );
    const extraKb = row(
      3,
      "failed",
      usage("gov-llm:tokens:kb_c:call-3", "knowledge_governance_llm_tokens", 5),
      recordedAt,
    );
    const once = compactBillingEventLog([invocation, duplicateTokens, extraKb], [], NOW);
    expect(once.events).toHaveLength(1);
    expect(once.events[0]?.event).toMatchObject({
      quantity: 15,
      governanceLlm: {
        tokenQuantity: 15,
        callQuantity: 1,
        creditQuantity: 2,
        knowledgeBaseIds: ["kb_a", "kb_c"],
      },
    });
    const twice = compactBillingEventLog(once.events, once.deliveredUsage, NOW);
    expect(twice.changed).toBe(false);
    expect(twice.events).toBe(once.events);
  });

  it("drops a fully delivered gov-llm invocation and remembers its source ids", () => {
    const recordedAt = new Date(NOW - 60_000).toISOString();
    const result = compactBillingEventLog(
      [
        row(
          1,
          "done",
          usage("gov-llm:call:kb_a:call-4", "knowledge_governance_llm_call", 1),
          recordedAt,
        ),
        row(
          2,
          "done",
          usage("gov-llm:tokens:kb_a:call-4", "knowledge_governance_llm_tokens", 8),
          recordedAt,
        ),
      ],
      [],
      NOW,
    );
    expect(result.events).toEqual([]);
    expect(result.deliveredUsage.map((entry) => entry.eventId).toSorted()).toEqual([
      "gov-llm:call:kb_a:call-4",
      "gov-llm:invocation:call-4",
      "gov-llm:tokens:kb_a:call-4",
    ]);
  });
});
