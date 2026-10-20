import { describe, expect, it } from "vitest";
import {
  buildOrganizationMonthlySeatUsage,
  normalizeOrganizationUsageUserId,
  resolveOrganizationMonthlyUsageTimeRange,
  tokensForRecord,
} from "./organization-monthly-seat-usage.ts";
import type { OrgPositionContext } from "./position-attribution.ts";
import type { UsageRecord } from "./types.ts";

function usage(
  partial: Partial<UsageRecord> & Pick<UsageRecord, "id" | "userId" | "key">,
): UsageRecord {
  return {
    enterpriseId: "ent-a",
    eventId: partial.id,
    quantity: 100,
    occurredAt: "2026-07-10T12:00:00.000Z",
    ingestedAt: "2026-07-10T12:00:01.000Z",
    ...partial,
  };
}

const positions: OrgPositionContext[] = [
  {
    orgSeatId: "seat-occupied",
    positionTitle: "产品",
    teamLabel: "研发",
    memberUserId: "Alice@Example.com",
    agentIds: ["bot-a", "bot-b"],
  },
  {
    orgSeatId: "seat-vacant",
    positionTitle: "空岗",
    teamLabel: "研发",
    memberUserId: null,
    agentIds: ["bot-orphan"],
  },
];

describe("organization-monthly-seat-usage", () => {
  it("normalizes user ids for employee lookup", () => {
    expect(normalizeOrganizationUsageUserId(" Alice@Example.com ")).toBe("alice@example.com");
    expect(normalizeOrganizationUsageUserId("  ")).toBeNull();
  });

  it("resolves inclusive date range with exclusive end bound", () => {
    expect(
      resolveOrganizationMonthlyUsageTimeRange({
        startDate: "2026-07-01",
        endDate: "2026-07-20",
        mode: "utc",
      }),
    ).toEqual({
      startDate: "2026-07-01",
      endDate: "2026-07-20",
      startTime: "2026-07-01T00:00:00.000+00:00",
      endTime: "2026-07-21T00:00:00.000+00:00",
    });
  });

  it("counts ai_token quantity as tokens", () => {
    expect(tokensForRecord(usage({ id: "1", userId: "u", key: "ai_token", quantity: 42 }))).toBe(
      42,
    );
    expect(tokensForRecord(usage({ id: "2", userId: "u", key: "task", quantity: 3 }))).toBe(0);
  });

  it("merges the same employee across agents into users[]", () => {
    const result = buildOrganizationMonthlySeatUsage({
      positions,
      usageRecords: [
        usage({
          id: "r1",
          userId: "alice@example.com",
          key: "ai_token",
          quantity: 100,
          agentId: "bot-a",
          occurredAt: "2026-07-05T10:00:00.000Z",
        }),
        usage({
          id: "r2",
          userId: "Alice@Example.com",
          key: "ai_token",
          quantity: 50,
          agentId: "bot-b",
          occurredAt: "2026-07-12T10:00:00.000Z",
        }),
      ],
    });

    expect(result.users).toHaveLength(1);
    expect(result.users[0]?.userId.toLowerCase()).toBe("alice@example.com");
    expect(result.users[0]?.totalTokens).toBe(150);
    expect(result.users[0]?.sessionCount).toBe(2);
    expect(result.users[0]?.lastActiveAt).toBe(Date.parse("2026-07-12T10:00:00.000Z"));

    expect(result.agents).toHaveLength(2);
    expect(result.agents.map((row) => row.agentId).toSorted()).toEqual(["bot-a", "bot-b"]);

    const occupied = result.seats.find((row) => row.seatId === "seat-occupied");
    expect(occupied?.totalTokens).toBe(150);
    expect(occupied?.sessionCount).toBe(2);
  });

  it("does not invent users[] rows for vacant seats without members", () => {
    const result = buildOrganizationMonthlySeatUsage({
      positions,
      usageRecords: [
        usage({
          id: "r3",
          userId: "ghost@example.com",
          key: "ai_token",
          quantity: 10,
          agentId: "bot-orphan",
          orgSeatId: "seat-vacant",
        }),
      ],
    });

    // ghost has usage so they appear in users[]; vacant seat member is still null —
    // empty-member seats do not synthesize a user from the seat alone.
    expect(result.users.map((row) => row.userId.toLowerCase())).toEqual(["ghost@example.com"]);
    const vacant = result.seats.find((row) => row.seatId === "seat-vacant");
    expect(vacant?.totalTokens).toBe(10);
    expect(vacant?.unmatchedAgentIds).toEqual([]);
    // vacant seat itself is still listed; no synthetic member-only user is invented from the seat
    expect(result.users.some((row) => !row.userId.trim())).toBe(false);
  });

  it("lists unmatched seat-bound agents with zero usage", () => {
    const result = buildOrganizationMonthlySeatUsage({
      positions,
      usageRecords: [],
    });
    const vacant = result.seats.find((row) => row.seatId === "seat-vacant");
    expect(vacant?.unmatchedAgentIds).toEqual(["bot-orphan"]);
    expect(result.unmatchedAgentIds).toContain("bot-orphan");
    expect(result.users).toEqual([]);
  });
});
