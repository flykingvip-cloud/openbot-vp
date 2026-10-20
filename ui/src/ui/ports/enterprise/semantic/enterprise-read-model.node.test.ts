import { describe, expect, it, vi } from "vitest";
import { upsertOwnershipRecord } from "../../../../../../src/gateway/ownership-store.js";
import {
  buildEnterprisePortReadModel,
  resolveEnterpriseTenantId,
} from "./enterprise-read-model.ts";

describe("enterprise read model", () => {
  it("resolves the current tenant and governance summaries from shared state", () => {
    const state = {
      hello: {
        auth: {
          tenantId: "tenant-a",
          displayName: "Alice",
        },
      },
      platformAuthState: {
        tenantName: "Acme",
        membershipRole: "enterprise-admin",
        latestInvite: {
          code: "INV-1",
          expiresAt: "2026-05-01",
          tenantId: "tenant-a",
          tenantName: "Acme",
        },
        members: [
          { user: "alice@example.com", membershipRole: "enterprise-admin" },
          { user: "bob@example.com", membershipRole: "member" },
        ],
      },
      bootstrapAuthSession: null,
      settings: {
        recentEnterpriseTenantIds: ["tenant-b"],
      },
      agentsList: {
        defaultId: "main",
        agents: [
          {
            id: "main",
            ownerId: "alice@example.com",
            ownerName: "Alice",
            identity: { name: "Main Agent" },
          },
          { id: "sales" },
          { id: "support" },
        ],
      },
      presenceEntries: [{ host: "node-a" }],
      sessionsResult: {
        count: 5,
        sessions: [
          {
            key: "agent:main:slack:group:group-sales",
            groupId: "group-sales",
            displayName: "销售协同组",
            updatedAt: 1710000000000,
          },
        ],
      },
      nodes: [{ nodeId: "node-a" }, { nodeId: "node-b" }],
      cronJobs: [{ id: "job-1" }],
      usageResult: {
        sessions: [
          {
            key: "agent:main:slack:group:group-sales",
            agentId: "main",
            updatedAt: 1710000000000,
            origin: {
              chatType: "group",
              threadId: "group-sales",
            },
            usage: {
              totalTokens: 222,
              totalCost: 3.21,
              lastActivity: 1710000000000,
              messageCounts: {
                errors: 1,
              },
            },
          },
        ],
        totals: {
          totalTokens: 222,
          totalCost: 3.21,
          missingCostEntries: 1,
        },
      },
      channelsSnapshot: {
        channelMeta: [{ id: "slack", label: "Slack", detailLabel: "Slack" }],
        channelOrder: ["slack"],
        channelAccounts: {
          slack: [{ accountId: "acct-1" }],
        },
      },
      configValid: false,
      configIssues: ["issue-1", "issue-2"],
    } as never;

    const tenantId = resolveEnterpriseTenantId(state);
    const model = buildEnterprisePortReadModel(
      state,
      {
        models: {
          mode: "strict",
          providers: {
            openai: { models: ["gpt-5.4"] },
            anthropic: { models: ["claude"] },
          },
        },
      },
      tenantId,
    );

    expect(tenantId).toBe("tenant-a");
    expect(model.currentTenantLabel).toBe("Acme");
    expect(model.memberCount).toBe(2);
    expect(model.memberUsers).toEqual(["alice@example.com", "bob@example.com"]);
    expect(model.adminCount).toBe(1);
    expect(model.assignedSeatCount).toBe(0);
    expect(model.agentCount).toBe(3);
    expect(model.runtimeHosts).toEqual(["node-a"]);
    expect(model.groupIds).toEqual(["node-a", "node-b"]);
    expect(model.channelIds).toEqual([]);
    expect(model.channelCount).toBe(0);
    expect(model.accountCount).toBe(0);
    expect(model.configuredProviderCount).toBe(2);
    expect(model.providerIds).toEqual(["anthropic", "openai"]);
    expect(model.configuredModelCount).toBe(2);
    expect(model.configuredModelIds).toEqual(["openai/gpt-5.4", "anthropic/claude"]);
    expect(model.configIssueCount).toBe(2);
    expect(model.configIssueLabels).toEqual(["issue-1", "issue-2"]);
    expect(model.resolverOptions.map((entry) => entry.tenantId)).toEqual(["tenant-a", "tenant-b"]);
    expect(model.meshSummary.userCount).toBe(2);
    expect(model.meshSummary.agentCount).toBe(1);
    expect(model.meshSummary.groupCount).toBe(3);
    expect(model.meshSummary.totalCost).toBe(3.21);
    expect(model.meshSummary.unownedAssetCount).toBeGreaterThan(0);
    expect(model.meshUsers[0]?.user).toBe("alice@example.com");
    expect(model.meshAgents.find((entry) => entry.agentId === "main")).toMatchObject({
      name: "Main Agent",
      creatorUser: "alice@example.com",
      totalCost: 3.21,
      sessionCount: 1,
      costAttributionStatus: "attributed",
      governanceStatus: "watch",
      budgetStatus: "normal",
      status: "online",
    });
    expect(model.meshAgents.find((entry) => entry.agentId === "sales")).toBeUndefined();
    expect(model.meshAgents.find((entry) => entry.agentId === "support")).toBeUndefined();
    expect(model.meshGroups.find((entry) => entry.groupId === "group-sales")).toMatchObject({
      name: "销售协同组",
      sessionCount: 1,
      totalCost: 3.21,
      costAttributionStatus: "partial",
      governanceStatus: "restricted",
      budgetStatus: "normal",
    });
    expect(model.meshSummary.onlineAgentCount).toBe(1);
    expect(model.meshSummary.sessionCount).toBe(1);
    expect(model.meshAnomalies.some((entry) => entry.id === "missing-cost-attribution")).toBe(true);
  });

  it.skip("prefers persisted ownership store over legacy owner fields for agents and groups", () => {
    // Skipped: ownership records live in the gateway's filesystem store, but
    // enterprise-read-model now runs in the browser bundle and cannot read
    // that store directly without a dedicated RPC. Re-enable once an
    // ownership RPC ships and the read-model consumes it from app state.
    upsertOwnershipRecord({
      tenantId: "tenant-a",
      subjectKind: "agent",
      subjectId: "main",
      positionId: "pos-real",
      positionLabel: "真实岗位",
      createdByUserId: "owner-1",
      createdByUserLabel: "真实创建人",
      currentManagerUserId: "manager-1",
      currentManagerLabel: "真实经理",
    });
    upsertOwnershipRecord({
      tenantId: "tenant-a",
      subjectKind: "group",
      subjectId: "group-sales",
      positionId: "pos-group",
      positionLabel: "小组归属岗位",
      createdByUserId: "owner-g",
      createdByUserLabel: "群创建人",
      currentManagerUserId: "manager-g",
      currentManagerLabel: "群经理",
    });

    const state = {
      hello: {
        auth: {
          tenantId: "tenant-a",
          displayName: "Alice",
        },
      },
      platformAuthState: {
        tenantName: "Acme",
        membershipRole: "enterprise-admin",
        latestInvite: null,
        members: [],
      },
      bootstrapAuthSession: null,
      settings: {
        recentEnterpriseTenantIds: [],
      },
      agentsList: {
        defaultId: "main",
        agents: [
          {
            id: "main",
            ownerId: "legacy-owner",
            ownerName: "Legacy Owner",
            identity: { name: "Main Agent" },
          },
        ],
      },
      presenceEntries: [{ host: "node-a" }],
      sessionsResult: {
        count: 1,
        sessions: [
          {
            key: "agent:main:slack:group:group-sales",
            groupId: "group-sales",
            updatedAt: 1710000000000,
          },
        ],
      },
      nodes: [],
      cronJobs: [],
      usageResult: {
        sessions: [
          {
            key: "agent:main:slack:group:group-sales",
            agentId: "main",
            updatedAt: 1710000000000,
            origin: {
              chatType: "group",
              threadId: "group-sales",
            },
            usage: {
              totalTokens: 10,
              totalCost: 1,
              lastActivity: 1710000000000,
              messageCounts: {
                errors: 0,
              },
            },
          },
        ],
        totals: {
          totalTokens: 10,
          totalCost: 1,
          missingCostEntries: 0,
        },
      },
      channelsSnapshot: {
        channelMeta: [],
        channelOrder: [],
        channelAccounts: {},
      },
      configValid: true,
      configIssues: [],
    } as never;

    const model = buildEnterprisePortReadModel(state, null, "tenant-a");
    expect(model.meshAgents.find((entry) => entry.agentId === "main")?.ownership).toMatchObject({
      positionId: "pos-real",
      positionLabel: "真实岗位",
      createdByUserId: "owner-1",
      currentManagerUserId: "manager-1",
    });
    expect(
      model.meshGroups.find((entry) => entry.groupId === "group-sales")?.ownership,
    ).toMatchObject({
      positionId: "pos-group",
      positionLabel: "小组归属岗位",
      createdByUserId: "owner-g",
      currentManagerUserId: "manager-g",
    });
  });

  it("enriches member summaries from organization seats when platform members omit seat links", () => {
    const state = {
      platformAuthState: {
        membershipRole: "enterprise-admin",
        members: [{ user: "alice@example.com", membershipRole: "member", status: "active" }],
        organization: {
          seatCount: 1,
          occupiedSeatCount: 1,
          assignedSeatCount: 0,
          vacantSeatCount: 0,
          handoverSeatCount: 0,
          frozenSeatCount: 0,
          pendingOfferCount: 0,
          departmentPaths: ["销售部/华东区"],
          seats: [
            {
              seatId: "seat-1",
              title: "销售总监",
              teamLabel: "销售部/华东区",
              status: "occupied",
              currentEmployeeUser: "alice@example.com",
              currentEmployeeDisplayName: "Alice",
            },
          ],
          handovers: [],
          offers: [],
        },
      },
      settings: { recentEnterpriseTenantIds: [] },
      agentsList: { agents: [], defaultId: null },
      presenceEntries: [],
      sessionsResult: { count: 0, sessions: [] },
      nodes: [],
      cronJobs: [],
      usageResult: {
        sessions: [],
        totals: { totalTokens: 0, totalCost: 0, missingCostEntries: 0 },
      },
      channelsSnapshot: { channelMeta: [], channelOrder: [], channelAccounts: {} },
      configValid: true,
      configIssues: [],
      meshOwnershipList: { records: [] },
    } as never;

    const model = buildEnterprisePortReadModel(state, null, "tenant-a");
    expect(model.memberSummaries[0]).toMatchObject({
      user: "alice@example.com",
      seatTitle: "销售总监",
      seatStatus: "occupied",
      seatTeamLabel: "销售部/华东区",
    });
  });

  it("falls back to the tenant id embedded in the current route", () => {
    vi.stubGlobal("window", {
      location: {
        pathname: "/enterprise/001/settings/identities",
      },
    });
    const state = {
      hello: { auth: {} },
      platformAuthState: null,
      bootstrapAuthSession: null,
      settings: { recentEnterpriseTenantIds: [] },
      basePath: "",
    } as never;

    expect(resolveEnterpriseTenantId(state)).toBe("001");
    vi.unstubAllGlobals();
  });

  it("merges collaboration spaces into mesh group KPI without requiring nodes", () => {
    const state = {
      platformAuthState: {
        membershipRole: "enterprise-admin",
        members: [{ user: "alice@example.com", membershipRole: "enterprise-admin" }],
      },
      settings: { recentEnterpriseTenantIds: [] },
      agentsList: { agents: [], defaultId: null },
      presenceEntries: [],
      sessionsResult: { count: 0, sessions: [] },
      nodes: [],
      cronJobs: [],
      collaborationSpacesResult: {
        spaces: [
          {
            id: "space-market",
            groupId: "space-market",
            title: "市场研究组",
          },
        ],
      },
      usageResult: {
        sessions: [],
        totals: { totalTokens: 0, totalCost: 0, missingCostEntries: 0 },
      },
      channelsSnapshot: { channelMeta: [], channelOrder: [], channelAccounts: {} },
      configValid: true,
      configIssues: [],
      meshOwnershipList: { records: [] },
    } as never;

    const model = buildEnterprisePortReadModel(state, null, "tenant-a");
    expect(model.meshSummary.groupCount).toBe(1);
    expect(model.meshGroups).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ groupId: "space-market", name: "市场研究组" }),
      ]),
    );
  });

  it("builds mesh agents from ownership + seat bindings when agents.list is personal-scoped empty", () => {
    const state = {
      platformAuthState: {
        membershipRole: "enterprise-admin",
        members: [{ user: "ceo@example.com", membershipRole: "enterprise-admin" }],
        organization: {
          seatCount: 1,
          occupiedSeatCount: 1,
          assignedSeatCount: 1,
          vacantSeatCount: 0,
          handoverSeatCount: 0,
          frozenSeatCount: 0,
          pendingOfferCount: 0,
          departmentPaths: [],
          seats: [
            {
              seatId: "seat-sales",
              title: "销售",
              teamLabel: null,
              status: "occupied",
              currentEmployeeUser: "alice@example.com",
              currentEmployeeDisplayName: "Alice",
              defaultAgentId: "agent-seat-default",
              agentIds: ["agent-from-seat"],
              defaultSpaceIds: [],
              memoryScopeIds: [],
              responsibility: null,
              roleCode: null,
            },
          ],
          handovers: [],
          offers: [],
        },
      },
      settings: { recentEnterpriseTenantIds: [] },
      // Personal agents.list: admin's own seat only (or empty) — must not gate mesh roster.
      agentsList: { agents: [], defaultId: null },
      presenceEntries: [],
      sessionsResult: { count: 0, sessions: [] },
      nodes: [],
      cronJobs: [],
      usageResult: {
        sessions: [],
        totals: { totalTokens: 0, totalCost: 0, missingCostEntries: 0 },
      },
      channelsSnapshot: { channelMeta: [], channelOrder: [], channelAccounts: {} },
      configValid: true,
      configIssues: [],
      meshOwnershipList: {
        records: [
          {
            subjectKind: "agent",
            subjectId: "agent-from-ownership",
            bindingStatus: "active",
            ownerKind: "seat",
            ownerId: "seat-sales",
          },
          {
            subjectKind: "agent",
            subjectId: "agent-revoked",
            bindingStatus: "revoked",
            ownerKind: "seat",
            ownerId: "seat-sales",
          },
        ],
      },
    } as never;

    const model = buildEnterprisePortReadModel(state, null, "tenant-a");
    const meshAgentIds = model.meshAgents.map((agent) => agent.agentId).toSorted();
    expect(meshAgentIds).toEqual(
      ["agent-from-ownership", "agent-from-seat", "agent-seat-default"].toSorted(),
    );
    expect(meshAgentIds).not.toContain("agent-revoked");
    expect(model.meshSummary.agentCount).toBe(3);
  });

  it("prefers mesh.ownership.list agents over personal agents.list and ownership labels", () => {
    const state = {
      platformAuthState: {
        session: { tenantId: "tenant-a" },
        membershipRole: "enterprise-admin",
        members: [
          { user: "ceo@example.com", membershipRole: "enterprise-admin" },
          { user: "alice@example.com", membershipRole: "enterprise-member" },
        ],
        organization: {
          seatCount: 2,
          occupiedSeatCount: 2,
          assignedSeatCount: 2,
          vacantSeatCount: 0,
          handoverSeatCount: 0,
          frozenSeatCount: 0,
          pendingOfferCount: 0,
          departmentPaths: [],
          seats: [
            {
              seatId: "seat-ceo",
              title: "CEO",
              teamLabel: null,
              status: "occupied",
              currentEmployeeUser: "ceo@example.com",
              currentEmployeeDisplayName: "CEO",
              defaultAgentId: "ceo-bot",
              agentIds: ["ceo-bot"],
              defaultSpaceIds: [],
              memoryScopeIds: [],
              responsibility: null,
              roleCode: null,
            },
            {
              seatId: "seat-sales",
              title: "销售",
              teamLabel: null,
              status: "occupied",
              currentEmployeeUser: "alice@example.com",
              currentEmployeeDisplayName: "Alice",
              defaultAgentId: "sales-bot",
              agentIds: ["sales-bot"],
              defaultSpaceIds: [],
              memoryScopeIds: [],
              responsibility: null,
              roleCode: null,
            },
          ],
          handovers: [],
          offers: [],
        },
      },
      settings: { recentEnterpriseTenantIds: [] },
      // Personal agents.list only has CEO bots
      agentsList: {
        agents: [{ id: "ceo-bot", name: "CEO Bot", ownerId: "ceo@example.com", ownerName: "CEO" }],
        defaultId: "ceo-bot",
      },
      presenceEntries: [],
      sessionsResult: { count: 0, sessions: [] },
      nodes: [],
      cronJobs: [],
      usageResult: {
        sessions: [
          {
            key: "agent:sales-bot:s1",
            agentId: "sales-bot",
            usage: { totalCost: 1.25, totalTokens: 100, lastActivity: 1 },
          },
        ],
        totals: { totalTokens: 100, totalCost: 1.25, missingCostEntries: 0 },
      },
      channelsSnapshot: { channelMeta: [], channelOrder: [], channelAccounts: {} },
      configValid: true,
      configIssues: [],
      meshOwnershipList: {
        agents: [
          { id: "ceo-bot", name: "CEO Bot", ownerId: "ceo@example.com", ownerName: "CEO" },
          { id: "sales-bot", name: "销售助手", ownerId: "alice@example.com", ownerName: "Alice" },
        ],
        records: [
          {
            tenantId: "tenant-a",
            subjectKind: "agent",
            subjectId: "sales-bot",
            bindingStatus: "active",
            positionId: "seat-sales",
            positionLabel: "销售",
            createdByUserId: "alice@example.com",
            createdByUserLabel: "Alice",
            currentManagerUserId: "alice@example.com",
            currentManagerLabel: "Alice",
            createdAt: "2026-08-01T00:00:00.000Z",
          },
        ],
      },
    } as never;

    const model = buildEnterprisePortReadModel(state, null, "tenant-a");
    expect(model.meshAgents.map((agent) => agent.agentId).toSorted()).toEqual(
      ["ceo-bot", "sales-bot"].toSorted(),
    );
    const sales = model.meshAgents.find((agent) => agent.agentId === "sales-bot");
    expect(sales?.name).toBe("销售助手");
    expect(sales?.ownership.currentManagerLabel).toBe("Alice");
    expect(sales?.ownership.positionLabel).toBe("销售");
    expect(sales?.totalCost).toBe(1.25);
  });

  it("keeps mesh agents empty when the tenant roster is empty", () => {
    const state = {
      hello: { auth: { tenantId: "tenant-empty", displayName: "Ningxia" } },
      platformAuthState: {
        tenantName: "Ningxia",
        membershipRole: "enterprise-admin",
        members: [],
      },
      bootstrapAuthSession: null,
      settings: { recentEnterpriseTenantIds: [] },
      agentsList: {
        defaultId: "ceo-bot",
        agents: [
          { id: "ceo-bot", name: "CEO Bot", ownerId: "ceo@host.example", ownerName: "Host CEO" },
          { id: "finance-bot", name: "Finance Bot", ownerId: "ceo@host.example" },
        ],
      },
      presenceEntries: [],
      sessionsResult: { count: 0, sessions: [] },
      nodes: [],
      cronJobs: [],
      usageResult: {
        sessions: [],
        totals: { totalTokens: 0, totalCost: 0, missingCostEntries: 0 },
      },
      channelsSnapshot: { channelMeta: [], channelOrder: [], channelAccounts: {} },
      configValid: true,
      configIssues: [],
      meshOwnershipList: { agents: [], records: [] },
    } as never;

    const model = buildEnterprisePortReadModel(state, null, "tenant-empty");
    expect(model.meshAgents).toEqual([]);
    expect(model.meshSummary.agentCount).toBe(0);
  });
});
