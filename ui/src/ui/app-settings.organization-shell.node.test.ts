import { afterEach, describe, expect, it, vi } from "vitest";
import {
  __resetOverviewLoadCacheForTest,
  enterpriseShellProfileForTabForTest,
  loadEnterpriseTabShell,
} from "./app-settings.ts";

describe("enterprise organization shell monthly usage load", () => {
  afterEach(() => {
    __resetOverviewLoadCacheForTest();
    vi.restoreAllMocks();
  });

  it("maps enterpriseOrganization to organization profile", () => {
    expect(enterpriseShellProfileForTabForTest("enterpriseOrganization")).toBe("organization");
  });

  it("requests organization monthly seat usage when opening organization tab", async () => {
    __resetOverviewLoadCacheForTest();
    const request = vi.fn(async (method: string, params?: unknown) => {
      if (method === "enterprise.organization.monthly-seat-usage") {
        const p = params as { tenantId: string; startDate: string; endDate: string };
        return {
          tenantId: p.tenantId,
          startDate: p.startDate,
          endDate: p.endDate,
          agents: [],
          seats: [],
          unmatchedAgentIds: [],
        };
      }
      // Other shell RPCs (agents/sessions/presence/config/identity) — return empty payloads.
      return {};
    });

    const host = {
      client: { request },
      connected: true,
      platformAuthState: {
        session: { tenantId: "tenant-a" },
        enterprise: { id: "tenant-a" },
        membershipRole: "enterprise-admin",
      },
      usageTimeZone: "local" as const,
      agentsLoading: false,
      agentsError: null,
      agentsList: null,
      agentsSelectedId: null,
      sessionsLoading: false,
      sessionsError: null,
      sessionsResult: null,
      presenceLoading: false,
      presenceError: null,
      presenceEntries: [],
      presenceStatus: null,
      configLoading: false,
      configSchemaLoading: false,
      configSchema: null,
      configSchemaRaw: null,
      configUiHints: null,
      configValue: null,
      configSnapshot: null,
      configError: null,
      enterpriseOrganizationMonthlyUsageLoading: false,
      enterpriseOrganizationMonthlyUsageError: null,
      enterpriseOrganizationMonthlyUsage: null,
      enterpriseOperationalIdentitiesLoading: false,
      enterpriseOperationalIdentitiesError: null,
      enterpriseOperationalIdentities: null,
    };

    await loadEnterpriseTabShell(host as never, "enterpriseOrganization", { force: true });

    expect(request).toHaveBeenCalledWith(
      "enterprise.organization.monthly-seat-usage",
      expect.objectContaining({
        tenantId: "tenant-a",
        startDate: expect.stringMatching(/^\d{4}-\d{2}-01$/),
        endDate: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
      }),
    );
    const monthlyCall = request.mock.calls.find(
      (call) => call[0] === "enterprise.organization.monthly-seat-usage",
    );
    const monthlyParams = monthlyCall?.[1] as { startDate: string; endDate: string };
    expect(monthlyParams.startDate.endsWith("-01")).toBe(true);
    expect(monthlyParams.startDate <= monthlyParams.endDate).toBe(true);
    const monthly = host.enterpriseOrganizationMonthlyUsage as {
      tenantId: string;
    } | null;
    expect(monthly?.tenantId).toBe("tenant-a");
  });
});
