// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { listEnterpriseKnowledgeProjectionBindings } from "../../gateway/enterprise-data/enterprise-knowledge-projection-binding-store.js";
import { runProjectionMaterialization } from "../../gateway/enterprise-data/projection-materializer.js";
import { seedEnterpriseDataCatalog } from "../../gateway/enterprise-data/seeds.js";
import { normalizeEnterpriseDataStore } from "../../gateway/enterprise-data/store.js";
import type { EnterpriseDataStore } from "../../gateway/enterprise-data/types.js";
import { resolveKnowledgeSourceContext } from "../../gateway/knowledge/context.js";
import { buildKnowledgeUniverseSystemPrompt } from "./knowledge-universe-context.js";

const tenantId = "tenant-acme";
const nowIso = "2026-06-05T12:00:00.000Z";

async function buildSeededEnterpriseStore(): Promise<EnterpriseDataStore> {
  const store = normalizeEnterpriseDataStore(null);
  seedEnterpriseDataCatalog({ store, tenantId, nowIso });
  const binding = listEnterpriseKnowledgeProjectionBindings({ store, tenantId }).find((item) => {
    const spec = store.enterpriseKnowledgeProjectionSpecs[item.projectionId];
    return spec?.projectionKey === "customer.profile";
  });
  if (binding) {
    await runProjectionMaterialization({
      store,
      tenantId,
      bindingId: binding.bindingId,
      nowIso,
    });
  }
  return store;
}

let enterpriseStore!: EnterpriseDataStore;

vi.mock("../../config/config.js", () => ({
  loadConfig: () => ({
    gateway: { auth: { trustedProxy: { enabled: true } } },
  }),
}));

vi.mock("../../gateway/platform-auth.js", () => ({
  resolvePlatformAuthConfig: () => ({ enabled: true }),
  // Realistic store shape: the authoritative resolver validates normalizedEmail,
  // user status, a single unambiguous membership, and enterprise availability.
  loadPlatformAuthStore: async () => ({
    users: {
      "user-mgr-001": {
        id: "user-mgr-001",
        email: "mgr@acme.test",
        normalizedEmail: "mgr@acme.test",
        status: "active",
      },
    },
    memberships: {
      "mem-1": {
        id: "mem-1",
        userId: "user-mgr-001",
        enterpriseId: tenantId,
        membershipRole: "member",
      },
    },
    enterprises: { [tenantId]: { id: tenantId, status: "paid" } },
  }),
  findUserByEmail: (_store: unknown, email: string) =>
    email === "mgr@acme.test" ? { id: "user-mgr-001", email } : null,
  findUserById: (_store: unknown, userId: string) =>
    userId === "user-mgr-001" ? { id: "user-mgr-001", email: "mgr@acme.test" } : null,
  findMembershipByUserId: (_store: unknown, userId: string) =>
    userId === "user-mgr-001"
      ? { id: "mem-1", userId, enterpriseId: tenantId, membershipRole: "member" }
      : null,
}));

vi.mock("../../gateway/enterprise-seat-assets-store.js", () => ({
  loadEnterpriseSeatAssetsStore: async () => ({
    seats: {
      "seat-sales-mgr-east": {
        seatId: "seat-sales-mgr-east",
        tenantId,
        title: "华东销售经理",
        teamLabel: "华东销售",
        roleCode: "sales-mgr",
        status: "occupied",
        currentEmployeeId: "user-mgr-001",
        defaultSpaceIds: [],
        defaultAgentAssetIds: [],
        createdAt: nowIso,
        updatedAt: nowIso,
      },
    },
    bindings: {
      "bind-1": {
        bindingId: "bind-1",
        seatId: "seat-sales-mgr-east",
        tenantId,
        employeeId: "user-mgr-001",
        bindingStatus: "active",
        effectiveAt: nowIso,
      },
    },
  }),
}));

vi.mock("../../gateway/enterprise-data/store.js", async () => {
  const actual = await vi.importActual<typeof import("../../gateway/enterprise-data/store.js")>(
    "../../gateway/enterprise-data/store.js",
  );
  return {
    ...actual,
    loadEnterpriseDataStore: async () => enterpriseStore,
  };
});

describe("knowledge universe auto-reply context", () => {
  beforeEach(async () => {
    enterpriseStore = await buildSeededEnterpriseStore();
    vi.clearAllMocks();
  });

  it("resolves tenant and seat scope from gateway client user", async () => {
    const context = await resolveKnowledgeSourceContext({
      connect: {} as never,
      user: "mgr@acme.test",
    });
    expect(context.tenantId).toBe(tenantId);
    expect(context.seatId).toBe("seat-sales-mgr-east");
    expect(context.hasEnterpriseScope).toBe(true);
  });

  it("builds enterprise-scoped prompt when gateway client user is present", async () => {
    const prompt = await buildKnowledgeUniverseSystemPrompt({
      message: "客户成交率为什么下降，帮我分析销售数据",
      sessionKey: "agent:main:webchat:dm:user-1",
      agentId: "employee-agent",
      gatewayClientUser: "mgr@acme.test",
      gatewayClientSessionDomain: "employee",
    });

    expect(prompt).toBeTruthy();
    expect(prompt).toContain("Knowledge Universe context");
    expect(prompt).toContain("Do not call external CRM/ERP/Connector APIs directly");
    expect(prompt).toContain("knowledge_search");
    expect(prompt).toContain("knowledge_get");
    expect(prompt).toContain("华东客户A 画像");
    expect(prompt).toContain("customer.profile");
    expect(prompt).toContain("enterprise");
  });

  it("does not surface enterprise knowledge without trusted gateway client user", async () => {
    const prompt = await buildKnowledgeUniverseSystemPrompt({
      message: "客户成交率为什么下降，帮我分析销售数据",
      sessionKey: "agent:main:webchat:dm:user-1",
      agentId: "employee-agent",
    });

    if (prompt) {
      expect(prompt).not.toMatch(/客户画像能力/);
      expect(prompt).not.toContain("(enterprise/");
    } else {
      expect(prompt).toBeUndefined();
    }
  });

  it("surfaces enterprise knowledge from a cron/group owner user id", async () => {
    const prompt = await buildKnowledgeUniverseSystemPrompt({
      message: "客户成交率为什么下降，帮我分析销售数据",
      sessionKey: "cron:price-monitor",
      agentId: "bot-skill",
      ownerUserId: "user-mgr-001",
    });

    expect(prompt).toBeTruthy();
    expect(prompt).toContain("华东客户A 画像");
    expect(prompt).toContain("customer.profile");
    expect(prompt).toContain("enterprise");
  });
});
