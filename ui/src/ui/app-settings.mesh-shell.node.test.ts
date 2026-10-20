import { afterEach, describe, expect, it, vi } from "vitest";
import {
  __resetOverviewLoadCacheForTest,
  enterpriseShellProfileForTabForTest,
  loadEnterpriseTabShell,
} from "./app-settings.ts";

describe("enterprise mesh shell data load", () => {
  afterEach(() => {
    __resetOverviewLoadCacheForTest();
    vi.restoreAllMocks();
  });

  it("maps enterpriseMesh to mesh profile", () => {
    expect(enterpriseShellProfileForTabForTest("enterpriseMesh")).toBe("mesh");
  });

  it("loads ownership, agents roster, and collaboration spaces for mesh graphs", async () => {
    __resetOverviewLoadCacheForTest();
    const request = vi.fn(async (method: string) => {
      if (method === "mesh.ownership.list") {
        return { records: [] };
      }
      if (method === "agents.list") {
        return { defaultId: "main", agents: [{ id: "main", name: "大白管家" }] };
      }
      if (method === "collaboration.spaces.list") {
        return { spaces: [] };
      }
      if (method === "sessions.usage" || method === "usage.cost") {
        return method === "sessions.usage"
          ? { sessions: [], totals: { totalTokens: 0, totalCost: 0, missingCostEntries: 0 } }
          : { totalCost: 0 };
      }
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
      meshOwnershipLoading: false,
      meshOwnershipError: null,
      meshOwnershipList: null,
      agentsLoading: false,
      agentsError: null,
      agentsList: null,
      agentsSelectedId: null,
      collaborationSpacesLoading: false,
      collaborationSpacesError: null,
      collaborationSpacesResult: null,
      configLoading: false,
      configSchemaLoading: false,
      configSchema: null,
      configSchemaRaw: null,
      configUiHints: null,
      configValue: null,
      configSnapshot: null,
      configError: null,
      usageLoading: false,
      usageResult: null,
      usageCostSummary: null,
      usageError: null,
      meshLifetimeUsageResult: null,
      settings: {},
    };

    await loadEnterpriseTabShell(host as never, "enterpriseMesh", { force: true });

    expect(request).toHaveBeenCalledWith("mesh.ownership.list", { tenantId: "tenant-a" });
    expect(request.mock.calls.some((call) => call[0] === "agents.list")).toBe(true);
    expect(request.mock.calls.some((call) => call[0] === "collaboration.spaces.list")).toBe(true);
    expect(request).toHaveBeenCalledWith("collaboration.spaces.list", { scope: "tenant" });
    expect(request.mock.calls.some((call) => call[0] === "sessions.usage")).toBe(true);
  });
});
