import { describe, expect, it, vi } from "vitest";
import {
  loadEnterpriseOrganizationMonthlyUsage,
  readOrganizationMonthlyUsageLoadState,
  type EnterpriseOrganizationMonthlyUsageState,
} from "./enterprise-organization-monthly-usage.ts";

function createState(
  overrides: Partial<EnterpriseOrganizationMonthlyUsageState> = {},
): EnterpriseOrganizationMonthlyUsageState {
  return {
    client: null,
    connected: true,
    platformAuthState: {
      session: { tenantId: "tenant-a" },
      enterprise: { id: "tenant-a" },
    },
    usageTimeZone: "local",
    enterpriseOrganizationMonthlyUsageLoading: false,
    enterpriseOrganizationMonthlyUsageError: null,
    enterpriseOrganizationMonthlyUsage: null,
    ...overrides,
  };
}

describe("enterprise-organization-monthly-usage controller", () => {
  it("loads natural-month window without touching shared usage dates", async () => {
    const request = vi.fn(async (_method: string, params: unknown) => {
      const p = params as { startDate: string; endDate: string; tenantId: string };
      return {
        tenantId: p.tenantId,
        startDate: p.startDate,
        endDate: p.endDate,
        agents: [
          {
            agentId: "bot-a",
            totalTokens: 10,
            totalCost: 1,
            sessionCount: 1,
            lastActiveAt: 100,
          },
        ],
        seats: [
          {
            seatId: "seat-1",
            agentIds: ["bot-a"],
            totalTokens: 10,
            totalCost: 1,
            sessionCount: 1,
            lastActiveAt: 100,
            unmatchedAgentIds: [],
          },
        ],
        unmatchedAgentIds: [],
      };
    });
    const shared = {
      usageStartDate: "2026-07-20",
      usageEndDate: "2026-07-20",
      usageResult: { marker: "shared" },
    };
    const state = createState({
      client: { request } as never,
    });
    await loadEnterpriseOrganizationMonthlyUsage(state, {
      force: true,
      now: new Date(2026, 6, 20),
    });
    expect(request).toHaveBeenCalledWith(
      "enterprise.organization.monthly-seat-usage",
      expect.objectContaining({
        tenantId: "tenant-a",
        startDate: "2026-07-01",
        endDate: "2026-07-20",
      }),
    );
    expect(shared.usageStartDate).toBe("2026-07-20");
    expect(shared.usageEndDate).toBe("2026-07-20");
    expect(shared.usageResult).toEqual({ marker: "shared" });
    expect(state.enterpriseOrganizationMonthlyUsage?.agents).toHaveLength(1);
    expect(state.enterpriseOrganizationMonthlyUsage?.seats[0]?.seatId).toBe("seat-1");
  });

  it("maps loading / error / ready into load-state without fabricating zeros", () => {
    expect(
      readOrganizationMonthlyUsageLoadState({
        enterpriseOrganizationMonthlyUsageLoading: true,
        enterpriseOrganizationMonthlyUsageError: null,
        enterpriseOrganizationMonthlyUsage: null,
      }).status,
    ).toBe("loading");

    expect(
      readOrganizationMonthlyUsageLoadState({
        enterpriseOrganizationMonthlyUsageLoading: false,
        enterpriseOrganizationMonthlyUsageError: "boom",
        enterpriseOrganizationMonthlyUsage: null,
      }),
    ).toEqual({ status: "error", message: "boom" });

    const ready = readOrganizationMonthlyUsageLoadState({
      enterpriseOrganizationMonthlyUsageLoading: false,
      enterpriseOrganizationMonthlyUsageError: null,
      enterpriseOrganizationMonthlyUsage: {
        tenantId: "tenant-a",
        startDate: "2026-07-01",
        endDate: "2026-07-20",
        agents: [],
        users: [],
        seats: [],
        unmatchedAgentIds: [],
      },
    });
    expect(ready.status).toBe("ready");
  });

  it("reloads when the natural-month window changes across days", async () => {
    const request = vi.fn(async (_method: string, params: unknown) => {
      const p = params as { startDate: string; endDate: string; tenantId: string };
      return {
        tenantId: p.tenantId,
        startDate: p.startDate,
        endDate: p.endDate,
        agents: [],
        users: [],
        seats: [],
        unmatchedAgentIds: [],
      };
    });
    const state = createState({
      client: { request } as never,
      enterpriseOrganizationMonthlyUsage: {
        tenantId: "tenant-a",
        startDate: "2026-07-01",
        endDate: "2026-07-19",
        agents: [],
        users: [],
        seats: [],
        unmatchedAgentIds: [],
      },
    });
    await loadEnterpriseOrganizationMonthlyUsage(state, {
      now: new Date(2026, 6, 20),
    });
    expect(request).toHaveBeenCalledTimes(1);
    expect(request).toHaveBeenCalledWith(
      "enterprise.organization.monthly-seat-usage",
      expect.objectContaining({
        startDate: "2026-07-01",
        endDate: "2026-07-20",
      }),
    );
  });

  it("skips reload when tenant and month window are unchanged", async () => {
    const request = vi.fn(async () => {
      throw new Error("should not request");
    });
    const state = createState({
      client: { request } as never,
      enterpriseOrganizationMonthlyUsage: {
        tenantId: "tenant-a",
        startDate: "2026-07-01",
        endDate: "2026-07-20",
        agents: [],
        users: [],
        seats: [],
        unmatchedAgentIds: [],
      },
    });
    await loadEnterpriseOrganizationMonthlyUsage(state, {
      now: new Date(2026, 6, 20),
    });
    expect(request).not.toHaveBeenCalled();
  });
});
