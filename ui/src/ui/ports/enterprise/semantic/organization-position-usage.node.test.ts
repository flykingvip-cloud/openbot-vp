import { describe, expect, it } from "vitest";
import {
  aggregateSeatAgentUsage,
  collectUniqueSeatAgentIds,
  indexOrganizationAgentUsage,
  mergePositionMonthlyUsage,
  resolveOrganizationMonthWindow,
} from "./organization-position-usage.ts";

describe("organization-position-usage", () => {
  it("collects unique agentIds ∪ defaultAgentId without double-counting", () => {
    expect(
      collectUniqueSeatAgentIds({
        agentIds: ["Bot-A", "bot-a", "Bot-B"],
        defaultAgentId: "Bot-C",
      }),
    ).toEqual(["Bot-A", "Bot-B", "Bot-C"]);
  });

  it("resolves natural month window from local calendar date", () => {
    const window = resolveOrganizationMonthWindow(new Date(2026, 6, 20));
    expect(window).toEqual({ startDate: "2026-07-01", endDate: "2026-07-20" });
  });

  it("does not treat unloaded usage as a real zero", () => {
    const result = aggregateSeatAgentUsage({
      seat: { agentIds: ["a1"], defaultAgentId: "a1" },
      loadState: { status: "unloaded" },
    });
    expect(result.display).toBe("unloaded");
    expect(result.totalCost).toBeNull();
  });

  it("aggregates multiple agents into one seat total", () => {
    const usageByAgent = indexOrganizationAgentUsage([
      {
        agentId: "a1",
        totalTokens: 100,
        totalCost: 1.5,
        sessionCount: 2,
        lastActiveAt: 10,
      },
      {
        agentId: "a2",
        totalTokens: 50,
        totalCost: 0.5,
        sessionCount: 1,
        lastActiveAt: 20,
      },
    ]);
    const result = aggregateSeatAgentUsage({
      seat: { agentIds: ["a1", "a2"], defaultAgentId: "a1" },
      loadState: {
        status: "ready",
        tenantId: "tenant-a",
        startDate: "2026-07-01",
        endDate: "2026-07-20",
        usageByAgent,
        unmatchedAgentIds: [],
      },
      knownAgentIds: new Set(["a1", "a2"]),
    });
    expect(result.display).toBe("ready");
    expect(result.totalTokens).toBe(150);
    expect(result.totalCost).toBe(2);
    expect(result.sessionCount).toBe(3);
    expect(result.lastActiveAt).toBe(20);
  });

  it("surfaces unmatched agent ids as a diagnostic state", () => {
    const result = aggregateSeatAgentUsage({
      seat: { agentIds: ["ghost-bot"], defaultAgentId: "ghost-bot" },
      loadState: {
        status: "ready",
        tenantId: "tenant-a",
        startDate: "2026-07-01",
        endDate: "2026-07-20",
        usageByAgent: new Map(),
        unmatchedAgentIds: ["ghost-bot"],
      },
      knownAgentIds: new Set(["other-bot"]),
    });
    expect(result.display).toBe("unmatched");
    expect(result.unmatchedAgentIds).toEqual(["ghost-bot"]);
    expect(result.totalCost).toBeNull();
  });

  it("keeps seat AI spend when employee usage is empty zeros", () => {
    const seatUsage = {
      totalTokens: 40,
      totalCost: 4,
      sessionCount: 2,
      lastActiveAt: 50,
      runtimeStatus: null,
      runtimeHost: null,
      groupCount: 0,
      unmatchedAgentIds: [],
      display: "ready" as const,
      errorMessage: null,
    };
    const employeeUsage = {
      ...seatUsage,
      totalTokens: 0,
      totalCost: 0,
      sessionCount: 0,
      lastActiveAt: null,
    };
    const merged = mergePositionMonthlyUsage({
      employeeAttributionUserId: "alice@example.com",
      seatUsage,
      employeeUsage,
    });
    expect(merged.totalCost).toBe(4);
    expect(merged.totalTokens).toBe(40);
  });

  it("prefers backend seat-level aggregates when seatId is present", () => {
    const result = aggregateSeatAgentUsage({
      seat: {
        seatId: "seat-1",
        agentIds: ["a1", "steward"],
        defaultAgentId: "a1",
      },
      loadState: {
        status: "ready",
        tenantId: "tenant-a",
        startDate: "2026-07-01",
        endDate: "2026-07-20",
        usageByAgent: indexOrganizationAgentUsage([
          {
            agentId: "a1",
            totalTokens: 999,
            totalCost: 99,
            sessionCount: 9,
            lastActiveAt: 1,
          },
          {
            agentId: "steward",
            totalTokens: 1000,
            totalCost: 100,
            sessionCount: 10,
            lastActiveAt: 2,
          },
        ]),
        usageBySeat: new Map([
          [
            "seat-1",
            {
              totalTokens: 40,
              totalCost: 4,
              sessionCount: 2,
              lastActiveAt: 50,
              unmatchedAgentIds: [],
            },
          ],
        ]),
        unmatchedAgentIds: [],
      },
      knownAgentIds: new Set(["a1", "steward"]),
    });
    expect(result.display).toBe("ready");
    expect(result.totalTokens).toBe(40);
    expect(result.totalCost).toBe(4);
    expect(result.sessionCount).toBe(2);
    expect(result.runtimeStatus).toBeNull();
    expect(result.runtimeHost).toBeNull();
    expect(result.groupCount).toBe(0);
  });
});
