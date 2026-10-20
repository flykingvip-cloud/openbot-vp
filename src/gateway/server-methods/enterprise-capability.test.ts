import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { GatewayRequestHandlerOptions } from "./types.js";

const tmpDir = path.join(os.tmpdir(), `openbot-enterprise-capability-${Date.now()}`);

vi.mock("../../utils.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../utils.js")>();
  return {
    ...actual,
    CONFIG_DIR: tmpDir,
  };
});

vi.mock("../../config/config.js", () => ({
  loadConfig: () => ({
    meta: { lastTouchedVersion: "2026.3.9" },
    gateway: {
      auth: {
        trustedProxy: {
          userHeader: "x-forwarded-user",
          platformAuth: {
            enabled: true,
            store: path.join(tmpDir, "openbot-platform-auth.json"),
          },
        },
      },
    },
  }),
}));

const { enterpriseCapabilityHandlers } = await import("./enterprise-capability.js");
const { employeeCapabilityHandlers } = await import("./employee-capability.js");
const { listBindings, listAgents, __agentRuntimeStoreInternals } =
  await import("../agent-runtime-store.js");
const {
  getProposal,
  getRegistryEntry,
  registerCapability,
  submitProposal,
  updateRegistryLifecycle,
} = await import("../capability-governance-store.js");
const { savePlatformAuthStore } = await import("../platform-auth.js");
const { ensureSeatForProvision, loadEnterpriseSeatAssetsStore, saveEnterpriseSeatAssetsStore } =
  await import("../enterprise-seat-assets-store.js");
const { createEnterpriseSubmission, updateEnterpriseSubmission } =
  await import("../capability-install-governance-store.js");

type HandlerResponse = {
  ok: boolean;
  payload?: unknown;
  error?: unknown;
};

function cleanStore() {
  fs.rmSync(tmpDir, { recursive: true, force: true });
  fs.mkdirSync(tmpDir, { recursive: true });
  // The agent-runtime store is an in-memory singleton (file rm does not clear
  // it); reset so runtime agents/bindings don't leak across tests.
  __agentRuntimeStoreInternals.reset();
}

async function invoke(
  method: string,
  params: Record<string, unknown> = {},
  userEmail = "alice@example.com",
): Promise<HandlerResponse> {
  const handler = enterpriseCapabilityHandlers[method];
  if (!handler) {
    throw new Error(`missing handler ${method}`);
  }
  let response: HandlerResponse | null = null;
  await handler({
    req: { type: "req", id: "test", method, params },
    params,
    client: {
      connect: {
        minProtocol: 1,
        maxProtocol: 1,
        client: {
          id: "openbot-control-ui",
          version: "2026.3.9",
          platform: "macos",
          mode: "control-ui",
        },
      } as never,
      user: userEmail,
    },
    isWebchatConnect: () => false,
    respond: (ok, payload, error) => {
      response = { ok, payload, error };
    },
    context: {} as GatewayRequestHandlerOptions["context"],
  });
  if (!response) {
    throw new Error(`handler ${method} did not respond`);
  }
  return response;
}

async function invokeEmployee(
  method: string,
  params: Record<string, unknown> = {},
  userEmail = "alice@example.com",
): Promise<HandlerResponse> {
  const handler = employeeCapabilityHandlers[method];
  if (!handler) {
    throw new Error(`missing handler ${method}`);
  }
  let response: HandlerResponse | null = null;
  await handler({
    req: { type: "req", id: "test", method, params },
    params,
    client: {
      connect: {
        minProtocol: 1,
        maxProtocol: 1,
        client: {
          id: "openbot-control-ui",
          version: "2026.3.9",
          platform: "macos",
          mode: "control-ui",
        },
      } as never,
      user: userEmail,
    },
    isWebchatConnect: () => false,
    respond: (ok, payload, error) => {
      response = { ok, payload, error };
    },
    context: {} as GatewayRequestHandlerOptions["context"],
  });
  if (!response) {
    throw new Error(`handler ${method} did not respond`);
  }
  return response;
}

async function prepareTenantStore() {
  await savePlatformAuthStore(
    {
      enabled: true,
      storePath: path.join(tmpDir, "openbot-platform-auth.json"),
      sessionTtlHours: 24,
      activationTtlHours: 24,
      passwordResetTtlMinutes: 30,
      cookieName: "openbot_platform_auth",
      requireMfaForPlatformAdmins: true,
    },
    {
      version: 4,
      secret: "test-secret",
      policy: {
        defaultTrialDays: 7,
        allowedTrialDays: [7],
        defaultTrialSeatCount: 5,
        trialSeatOptions: [5],
        allowCustomTrialSeatCount: false,
        trialExpiryPolicy: "redirect_to_upgrade",
        updatedAt: "2026-05-18T00:00:00.000Z",
      },
      enterprises: {
        "tenant-a": {
          id: "tenant-a",
          name: "Tenant A",
          slug: "tenant-a",
          status: "paid",
          plan: "pro",
          createdSource: "platform-created",
          billingStatus: "paid",
          createdAt: "2026-05-18T00:00:00.000Z",
          updatedAt: "2026-05-18T00:00:00.000Z",
          seatQuota: 10,
          seatUsed: 2,
        },
      },
      users: {
        "user-a": {
          id: "user-a",
          email: "alice@example.com",
          normalizedEmail: "alice@example.com",
          displayName: "Alice",
          passwordHash: "x",
          passwordUpdatedAt: "2026-05-18T00:00:00.000Z",
          loginFailedCount: 0,
          status: "active",
          source: "platform-created",
          role: "operator",
          scopes: ["operator.read", "operator.write"],
          createdAt: "2026-05-18T00:00:00.000Z",
          updatedAt: "2026-05-18T00:00:00.000Z",
        },
      },
      sessions: {},
      memberships: {
        "membership-a": {
          id: "membership-a",
          userId: "user-a",
          enterpriseId: "tenant-a",
          membershipRole: "admin",
          createdAt: "2026-05-18T00:00:00.000Z",
          updatedAt: "2026-05-18T00:00:00.000Z",
        },
      },
      adminProvisions: {},
      employeeProvisions: {},
      activationCodes: {},
      trialApplications: {},
      leadNotifications: {},
    } as never,
  );
}

function registerFixtureCapabilities() {
  registerCapability({
    id: "urn:openclaw:skill:customer-summary@1.0.0",
    kind: "skill",
    version: "1.0.0",
    skillKey: "customer-summary",
    name: "客户沟通整理",
    description: "把客户对话整理为清晰摘要",
    descriptionZh: "把客户对话整理为清晰摘要",
    source: { kind: "personal", origin: "employee-capability:customer-summary", trustTier: "user" },
    risk: { level: "low", network: false, filesystem: false, subprocess: false, secrets: false },
  });
  registerCapability({
    id: "urn:openclaw:skill:invoice-reader@1.0.0",
    kind: "skill",
    version: "1.0.0",
    skillKey: "invoice-reader",
    name: "发票识别",
    description: "识别发票和报销单据",
    descriptionZh: "识别发票和报销单据",
    source: { kind: "platform", origin: "openclaw-bundled", trustTier: "first-party" },
    risk: { level: "low", network: false, filesystem: false, subprocess: false, secrets: false },
  });
}

describe("enterprise-capability handlers", () => {
  beforeEach(async () => {
    cleanStore();
    await prepareTenantStore();
    registerFixtureCapabilities();
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("tracks this enterprise's platform submissions (scoped read + status mapping)", async () => {
    // The incubation center tracker reads the canonical submission store via
    // enterprise-capability.platform-submissions. Seed submissions directly to
    // assert enterprise scoping + status -> display mapping.
    createEnterpriseSubmission({
      submissionId: "sub-track-approved",
      capabilityId: "cap-track-approved",
      capabilityName: "已发布追踪能力",
      enterpriseId: "tenant-a",
      enterpriseName: "Tenant A",
      sanitized: true,
      sanitizationFindings: 0,
      sourceProvenance: "enterprise-sanitization",
    });
    updateEnterpriseSubmission("sub-track-approved", { status: "published" });
    createEnterpriseSubmission({
      submissionId: "sub-track-pending",
      capabilityId: "cap-track-pending",
      capabilityName: "待审追踪能力",
      enterpriseId: "tenant-a",
      enterpriseName: "Tenant A",
      sanitized: true,
      sanitizationFindings: 0,
      sourceProvenance: "enterprise-sanitization",
    });
    createEnterpriseSubmission({
      submissionId: "sub-track-other",
      capabilityId: "cap-track-other",
      capabilityName: "其他企业能力",
      enterpriseId: "tenant-other",
      enterpriseName: "Other Tenant",
      sanitized: true,
      sanitizationFindings: 0,
      sourceProvenance: "enterprise-sanitization",
    });

    const res = await invoke("enterprise-capability.platform-submissions");
    expect(res.ok).toBe(true);
    const reports = (
      res.payload as {
        reports: Array<{ reportId: string; capabilityId: string; proposalStatus: string }>;
      }
    ).reports;

    const approved = reports.find((r) => r.capabilityId === "cap-track-approved");
    const pending = reports.find((r) => r.capabilityId === "cap-track-pending");
    expect(approved?.proposalStatus).toBe("approved");
    expect(pending?.proposalStatus).toBe("pending");
    // Enterprise scoping: another enterprise's submission is not visible.
    expect(reports.some((r) => r.capabilityId === "cap-track-other")).toBe(false);
  });

  it("certify + promote-to-standard persist maturity grants that floor the projected maturity", async () => {
    const capId = "urn:openclaw:skill:customer-summary@1.0.0";
    // Seed a tenant runtime agent, then bind the capability so its usage-computed
    // maturity reaches 稳定使用 (1 robot) — the certify precondition.
    await invoke("enterprise-capability.stats");
    const agent = listAgents({
      lifecycle: null,
      health: null,
      tenantId: "tenant-a",
      searchQuery: "",
    })[0];
    expect(agent?.runtimeAgentId).toBeTruthy();
    await invoke("enterprise-capability.install-to-robots", {
      capabilityId: "customer-summary",
      robotIds: [agent?.runtimeAgentId],
    });

    // Before certification, 企业标准 promotion is gated.
    const prematurePromote = await invoke("enterprise-capability.promote-to-standard", {
      capabilityId: "customer-summary",
      reason: "希望推广",
    });
    expect((prematurePromote.payload as { succeeded: boolean }).succeeded).toBe(false);
    expect(getRegistryEntry(capId)?.manualMaturityGrant).toBeUndefined();

    // certify persists the 企业认证 grant on the canonical registry entry.
    const certified = await invoke("enterprise-capability.certify", {
      capabilityId: "customer-summary",
      reason: "跨部门稳定复用，达到企业认证标准",
    });
    expect((certified.payload as { succeeded: boolean }).succeeded).toBe(true);
    expect(getRegistryEntry(capId)?.manualMaturityGrant).toBe("企业认证");

    // With certification in place, promotion to 企业标准 now succeeds and persists.
    const promoted = await invoke("enterprise-capability.promote-to-standard", {
      capabilityId: "customer-summary",
      reason: "企业全员推广",
    });
    expect((promoted.payload as { succeeded: boolean }).succeeded).toBe(true);
    expect(getRegistryEntry(capId)?.manualMaturityGrant).toBe("企业标准");

    // The grant floors the projected maturity in the enterprise list view.
    const list = await invoke("enterprise-capability.list", {
      filters: {
        searchQuery: "客户",
        usageScenario: null,
        applicableTarget: null,
        domain: null,
        maturity: null,
        healthStatus: null,
        onlyInstallable: false,
      },
      pagination: { page: 1, pageSize: 10 },
      sorting: { field: "createdAt", direction: "desc" },
      sidebarEntry: "all",
    });
    const item = (list.payload as { items: Array<{ id: string; maturity: string }> }).items.find(
      (entry) => entry.id === capId,
    );
    expect(item?.maturity).toBe("企业标准");
  });

  it("hides a registry draft from the public capability catalog", async () => {
    const draftId = "urn:openclaw:skill:private-draft@1.0.0";
    registerCapability({
      id: draftId,
      kind: "skill",
      version: "1.0.0",
      skillKey: "private-draft",
      name: "私人草稿",
      description: "还没有进入企业公共目录",
      source: { kind: "personal", origin: "employee-capability:private-draft", trustTier: "user" },
      risk: { level: "low", network: false, filesystem: false, subprocess: false, secrets: false },
    });
    updateRegistryLifecycle(draftId, "draft");

    const list = await invoke("enterprise-capability.list", {
      filters: {
        searchQuery: "私人草稿",
        usageScenario: null,
        applicableTarget: null,
        domain: null,
        maturity: null,
        healthStatus: null,
        onlyInstallable: false,
      },
      pagination: { page: 1, pageSize: 10 },
      sorting: { field: "createdAt", direction: "desc" },
      sidebarEntry: "all",
    });
    expect(list.ok).toBe(true);
    expect((list.payload as { items: unknown[] }).items).toEqual([]);
  });

  it("projects registry and runtime seed into enterprise stats and list responses", async () => {
    const stats = await invoke("enterprise-capability.stats");
    expect(stats.ok).toBe(true);
    expect(
      (stats.payload as { stats: { totalCapabilities: number } }).stats.totalCapabilities,
    ).toBe(2);

    const list = await invoke("enterprise-capability.list", {
      filters: {
        searchQuery: "客户",
        usageScenario: null,
        applicableTarget: null,
        domain: null,
        maturity: null,
        healthStatus: null,
        onlyInstallable: false,
      },
      pagination: { page: 1, pageSize: 10 },
      sorting: { field: "createdAt", direction: "desc" },
      sidebarEntry: "all",
    });
    expect(list.ok).toBe(true);
    const items = (list.payload as { items: Array<{ name: string; domain: string }> }).items;
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ name: "客户沟通整理", domain: "销售" });

    const runtimeAgents = listAgents({
      lifecycle: null,
      health: null,
      tenantId: "tenant-a",
      searchQuery: "",
    });
    expect(runtimeAgents).toHaveLength(1);
    const runtimeBindings = listBindings({
      runtimeAgentId: runtimeAgents[0]?.runtimeAgentId ?? null,
      capabilityId: null,
      bindingType: null,
      bindingState: null,
      health: null,
    });
    expect(runtimeBindings).toHaveLength(1);
    expect(runtimeBindings[0]?.bindingType).toBe("platform-default");
  });

  it("installs a capability to tenant runtime and exposes it in install management", async () => {
    await invoke("enterprise-capability.stats");
    const agent = listAgents({
      lifecycle: null,
      health: null,
      tenantId: "tenant-a",
      searchQuery: "",
    })[0];
    expect(agent?.runtimeAgentId).toBeTruthy();

    const installed = await invoke("enterprise-capability.install-to-robots", {
      capabilityId: "customer-summary",
      robotIds: [agent?.runtimeAgentId],
    });
    expect(installed.ok).toBe(true);
    expect((installed.payload as { successfulRobotIds: string[] }).successfulRobotIds).toContain(
      agent?.runtimeAgentId,
    );

    const management = await invoke("enterprise-capability.install-management", {
      filters: {
        capabilityNameQuery: "客户",
        robotNameQuery: "",
        installedAfter: null,
        installedBefore: null,
        source: null,
        status: null,
      },
      pagination: { page: 1, pageSize: 10 },
    });
    expect(management.ok).toBe(true);
    const relations = (management.payload as { items: Array<{ capabilityName: string }> }).items;
    expect(relations.some((relation) => relation.capabilityName === "客户沟通整理")).toBe(true);
  });

  it("pushes enterprise capabilities to selected position markets", async () => {
    const seatStore = await loadEnterpriseSeatAssetsStore();
    const salesSeat = ensureSeatForProvision({
      store: seatStore,
      tenantId: "tenant-a",
      seatTitle: "销售顾问",
      teamLabel: "销售中心/华东大区",
      nowIso: "2026-05-22T00:00:00.000Z",
      agentIds: ["sales-assistant"],
    });
    const financeSeat = ensureSeatForProvision({
      store: seatStore,
      tenantId: "tenant-a",
      seatTitle: "财务专员",
      teamLabel: "财务中心",
      nowIso: "2026-05-22T00:00:00.000Z",
      agentIds: ["finance-assistant"],
    });
    await saveEnterpriseSeatAssetsStore(undefined, seatStore);

    const pushed = await invoke("enterprise-capability.push-to-positions", {
      capabilityId: "customer-summary",
      positionIds: [salesSeat.seatId, financeSeat.seatId],
    });

    expect(pushed.ok).toBe(true);
    expect((pushed.payload as { successfulPositionIds: string[] }).successfulPositionIds).toEqual([
      salesSeat.seatId,
      financeSeat.seatId,
    ]);
    const afterStore = await loadEnterpriseSeatAssetsStore();
    const grants = Object.values(afterStore.accessPolicies).filter(
      (policy) =>
        policy.resourceType === "capability" &&
        policy.resourceId === "urn:openclaw:skill:customer-summary@1.0.0" &&
        policy.action === "execute" &&
        !policy.revokedAt,
    );
    expect(grants.map((grant) => grant.subjectId).toSorted()).toEqual(
      [salesSeat.seatId, financeSeat.seatId].toSorted(),
    );

    const duplicate = await invoke("enterprise-capability.push-to-positions", {
      capabilityId: "customer-summary",
      positionIds: [salesSeat.seatId],
    });
    expect(duplicate.ok).toBe(true);
    expect(
      (duplicate.payload as { failures: Array<{ positionId: string; reason: string }> }).failures,
    ).toContainEqual({ positionId: salesSeat.seatId, reason: "已推送" });
    expect((pushed.payload as { mcpMount: unknown }).mcpMount).toBeNull();
  });

  it("mounts an MCP onto every tenant robot when pushed to all positions", async () => {
    const { listRobotSkillAssets, saveSkillAsset } = await import("../skill-lifecycle-store.js");
    saveSkillAsset({
      skillId: "consult-win-advisor",
      ownerUserId: "alice@example.com",
      lifecycle: "published",
      profile: {
        name: "打单参谋",
        summary: "会前推演",
        assetType: "mcp",
        visibility: "enterprise",
      },
      runtimeDefinition: {
        prompts: ["Call advisor for 会前推演."],
        mcpBinding: {
          serverName: "consult-win-advisor",
          transport: "stdio",
          command: "bash",
          args: ["/tmp/openbot-launch.sh"],
        },
      },
    });
    registerCapability({
      id: "urn:openclaw:skill:consult-win-advisor@1.0.2",
      kind: "skill",
      version: "1.0.2",
      skillKey: "consult-win-advisor",
      name: "打单参谋",
      description: "会前推演",
      source: {
        kind: "personal",
        origin: "employee-capability:consult-win-advisor",
        trustTier: "user",
      },
      risk: { level: "low", network: false, filesystem: false, subprocess: false, secrets: false },
    });
    __agentRuntimeStoreInternals.seed({
      agents: {
        "robot-sales": {
          runtimeAgentId: "robot-sales",
          name: "销售机器人",
          runtimeVersion: "1.0.0",
          lifecycle: "deployed",
          health: "healthy",
          tenantCoverage: ["tenant-a"],
          boundCapabilityCount: 0,
          activeSessionCount: 0,
          resourceUsage: { cpuPercent: 1, memoryPercent: 1, tokenBudgetUsedPercent: 1 },
          deployedAt: 1,
          lastActiveAt: 1,
        },
        "robot-finance": {
          runtimeAgentId: "robot-finance",
          name: "财务机器人",
          runtimeVersion: "1.0.0",
          lifecycle: "deployed",
          health: "healthy",
          tenantCoverage: ["tenant-a"],
          boundCapabilityCount: 0,
          activeSessionCount: 0,
          resourceUsage: { cpuPercent: 1, memoryPercent: 1, tokenBudgetUsedPercent: 1 },
          deployedAt: 1,
          lastActiveAt: 1,
        },
      },
    });
    const seatStore = await loadEnterpriseSeatAssetsStore();
    const salesSeat = ensureSeatForProvision({
      store: seatStore,
      tenantId: "tenant-a",
      seatTitle: "销售顾问",
      teamLabel: "销售中心",
      nowIso: "2026-05-22T00:00:00.000Z",
      agentIds: ["robot-sales"],
    });
    const financeSeat = ensureSeatForProvision({
      store: seatStore,
      tenantId: "tenant-a",
      seatTitle: "财务专员",
      teamLabel: "财务中心",
      nowIso: "2026-05-22T00:00:00.000Z",
      agentIds: ["robot-finance"],
    });
    await saveEnterpriseSeatAssetsStore(undefined, seatStore);

    const partial = await invoke("enterprise-capability.push-to-positions", {
      capabilityId: "consult-win-advisor",
      positionIds: [salesSeat.seatId],
    });
    expect(partial.ok).toBe(true);
    const partialMount = (
      partial.payload as {
        mcpMount: { scope: string; mountedRobotIds: string[] } | null;
      }
    ).mcpMount;
    expect(partialMount?.scope).toBe("positions");
    expect(partialMount?.mountedRobotIds).toContain("robot-sales");
    expect(partialMount?.mountedRobotIds).not.toContain("robot-finance");

    const pushed = await invoke("enterprise-capability.push-to-positions", {
      capabilityId: "consult-win-advisor",
      positionIds: [salesSeat.seatId, financeSeat.seatId],
    });
    expect(pushed.ok).toBe(true);
    const mount = (
      pushed.payload as {
        mcpMount: { scope: string; mountedRobotIds: string[]; failures: unknown[] } | null;
      }
    ).mcpMount;
    expect(mount?.scope).toBe("tenant");
    expect(mount?.mountedRobotIds).toEqual(
      expect.arrayContaining(["robot-sales", "robot-finance"]),
    );
    expect(mount?.failures).toEqual([]);
    for (const agentId of ["robot-sales", "robot-finance"]) {
      expect(
        listRobotSkillAssets(agentId).some((entry) => entry.id === "consult-win-advisor"),
      ).toBe(true);
      const bindRoot = path.join(tmpDir, "skill-execution-bindings", agentId);
      const skillFile = fs
        .readdirSync(bindRoot)
        .map((name) => path.join(bindRoot, name, "SKILL.md"))
        .find((file) => fs.existsSync(file));
      expect(skillFile).toBeTruthy();
      expect(fs.readFileSync(skillFile ?? "", "utf8")).toContain("Call advisor for 会前推演.");
    }
    const mcporter = JSON.parse(
      fs.readFileSync(path.join(tmpDir, "mcp-asset-bindings", "mcporter.json"), "utf8"),
    ) as { mcpServers: Record<string, { command?: string }> };
    expect(mcporter.mcpServers["consult-win-advisor"]?.command).toBe("bash");
  });

  it("carries an employee asset through enterprise review and back to employee visibility", async () => {
    const saved = await invokeEmployee("employee-capability.quick-save", {
      sourceAgentId: "sales-assistant",
      sourceContextId: "weekly-followup",
      form: {
        name: "销售客户进展整理",
        summary: "用于周会前快速整理客户进展、风险与行动项",
      },
    });
    expect(saved.ok).toBe(true);
    const capabilityId = (saved.payload as { capability: { id: string } }).capability.id;

    const submitted = await invokeEmployee(
      "employee-capability.submit-to-enterprise",
      { capabilityId },
      "alice@example.com",
    );
    expect(submitted).toMatchObject({
      ok: true,
      payload: { capabilityId, shareVisibility: "审核中" },
    });

    const reviewQueue = await invoke("enterprise-capability.review-queue", {
      filters: { status: null, searchQuery: "销售客户进展" },
      pagination: { page: 1, pageSize: 10 },
    });
    expect(reviewQueue.ok).toBe(true);
    const reviewItems = (
      reviewQueue.payload as {
        items: Array<{ item: { id: string; sourceEmployee: { name: string } } }>;
      }
    ).items;
    expect(reviewItems).toHaveLength(1);
    expect(reviewItems[0]?.item.sourceEmployee.name).toBe("Alice");

    const reviewed = await invoke("enterprise-capability.review", {
      reviewTaskId: reviewItems[0].item.id,
      result: "通过",
      opinion: "适合沉淀为销售周报标准模版",
      approval: {
        domain: "销售",
        applicableScope: { kind: "enterprise" },
      },
    });
    expect(reviewed.ok).toBe(true);

    const employeeDetail = await invokeEmployee("employee-capability.detail", { capabilityId });
    expect(employeeDetail.ok).toBe(true);
    expect(
      (employeeDetail.payload as { capability: { shareVisibility: string } }).capability
        .shareVisibility,
    ).toBe("已进入企业资产库");

    const enterpriseList = await invoke("enterprise-capability.list", {
      filters: {
        searchQuery: "销售客户进展",
        usageScenario: null,
        applicableTarget: null,
        domain: null,
        maturity: null,
        healthStatus: null,
        onlyInstallable: false,
      },
      pagination: { page: 1, pageSize: 10 },
      sorting: { field: "createdAt", direction: "desc" },
      sidebarEntry: "all",
    });
    expect(enterpriseList.ok).toBe(true);
    expect(
      (
        enterpriseList.payload as {
          items: Array<{ name: string; sourceEmployeeName: string }>;
        }
      ).items,
    ).toContainEqual(
      expect.objectContaining({
        name: "销售客户进展整理",
        sourceEmployeeName: "Alice",
      }),
    );

    const records = await invoke("enterprise-capability.contribution-records", {
      filters: {
        employeeId: "alice@example.com",
        departmentId: null,
        submittedAfter: null,
        submittedBefore: null,
        reviewStatus: "已通过",
      },
      pagination: { page: 1, pageSize: 10 },
    });
    expect(records.ok).toBe(true);
    expect(
      (
        records.payload as {
          items: Array<{ capabilityName: string; reviewStatus: string }>;
        }
      ).items,
    ).toContainEqual(
      expect.objectContaining({ capabilityName: "销售客户进展整理", reviewStatus: "已通过" }),
    );
  });

  it("moves revision-requested submissions out of the review queue and into contribution feedback", async () => {
    submitProposal({
      proposalId: "proposal:customer-followup",
      submittedAt: "2026-05-22T08:00:00.000Z",
      submittedBy: "Alice",
      enterpriseId: "tenant-a",
      status: "proposed",
      manifest: {
        id: "customer-followup",
        kind: "skill",
        version: "1.0.0",
        skillKey: "customer-followup",
        name: "客户跟进摘要",
        description: "自动整理客户跟进重点和下一步行动",
        source: {
          kind: "personal",
          origin: "employee-capability:customer-followup",
          trustTier: "user",
        },
        risk: {
          level: "low",
          network: false,
          filesystem: false,
          subprocess: false,
          secrets: false,
        },
      },
      findings: [],
    });

    const reviewQueueBefore = await invoke("enterprise-capability.review-queue", {
      filters: { status: null, searchQuery: "客户跟进" },
      pagination: { page: 1, pageSize: 10 },
    });
    expect(reviewQueueBefore.ok).toBe(true);
    expect((reviewQueueBefore.payload as { items: unknown[] }).items).toHaveLength(1);

    const reviewed = await invoke("enterprise-capability.review", {
      reviewTaskId: "proposal:customer-followup",
      result: "需修改",
      opinion: "请补充适用范围和输出示例后再次提交",
    });

    expect(reviewed.ok).toBe(true);
    expect(getProposal("proposal:customer-followup")?.status).toBe("withdrawn");

    const reviewQueueAfter = await invoke("enterprise-capability.review-queue", {
      filters: { status: null, searchQuery: "客户跟进" },
      pagination: { page: 1, pageSize: 10 },
    });
    expect(reviewQueueAfter.ok).toBe(true);
    expect((reviewQueueAfter.payload as { items: unknown[] }).items).toHaveLength(0);

    const records = await invoke("enterprise-capability.contribution-records", {
      filters: {
        employeeId: null,
        departmentId: null,
        submittedAfter: null,
        submittedBefore: null,
        reviewStatus: "需修改",
      },
      pagination: { page: 1, pageSize: 10 },
    });
    expect(records.ok).toBe(true);
    expect(
      (records.payload as { items: Array<{ capabilityName: string; reviewStatus: string }> }).items,
    ).toContainEqual(
      expect.objectContaining({ capabilityName: "客户跟进摘要", reviewStatus: "需修改" }),
    );
  });

  it("sorts contribution records by employee and review status before pagination", async () => {
    submitProposal({
      proposalId: "proposal:zeta-approved",
      submittedAt: "2026-05-22T10:00:00.000Z",
      submittedBy: "Zeta",
      enterpriseId: "tenant-a",
      status: "approved",
      manifest: {
        id: "zeta-approved",
        kind: "skill",
        version: "1.0.0",
        skillKey: "zeta-approved",
        name: "Zeta 通过能力",
        description: "用于验证贡献记录排序",
        source: {
          kind: "personal",
          origin: "employee-capability:zeta-approved",
          trustTier: "user",
        },
        risk: {
          level: "low",
          network: false,
          filesystem: false,
          subprocess: false,
          secrets: false,
        },
      },
      findings: [],
    });
    submitProposal({
      proposalId: "proposal:alpha-pending",
      submittedAt: "2026-05-22T09:00:00.000Z",
      submittedBy: "Alpha",
      enterpriseId: "tenant-a",
      status: "proposed",
      manifest: {
        id: "alpha-pending",
        kind: "skill",
        version: "1.0.0",
        skillKey: "alpha-pending",
        name: "Alpha 待审核能力",
        description: "用于验证贡献记录排序",
        source: {
          kind: "personal",
          origin: "employee-capability:alpha-pending",
          trustTier: "user",
        },
        risk: {
          level: "low",
          network: false,
          filesystem: false,
          subprocess: false,
          secrets: false,
        },
      },
      findings: [],
    });
    submitProposal({
      proposalId: "proposal:beta-revision",
      submittedAt: "2026-05-22T08:00:00.000Z",
      submittedBy: "Beta",
      enterpriseId: "tenant-a",
      status: "withdrawn",
      manifest: {
        id: "beta-revision",
        kind: "skill",
        version: "1.0.0",
        skillKey: "beta-revision",
        name: "Beta 需修改能力",
        description: "用于验证贡献记录排序",
        source: {
          kind: "personal",
          origin: "employee-capability:beta-revision",
          trustTier: "user",
        },
        risk: {
          level: "low",
          network: false,
          filesystem: false,
          subprocess: false,
          secrets: false,
        },
      },
      findings: [],
    });

    const byEmployee = await invoke("enterprise-capability.contribution-records", {
      filters: {
        employeeId: null,
        departmentId: null,
        submittedAfter: null,
        submittedBefore: null,
        reviewStatus: null,
      },
      pagination: { page: 1, pageSize: 10 },
      sorting: { field: "employeeName", direction: "asc" },
    });
    expect(byEmployee.ok).toBe(true);
    expect(
      (
        byEmployee.payload as {
          items: Array<{ contribution: { employeeName: string } }>;
        }
      ).items.map((item) => item.contribution.employeeName),
    ).toEqual(["Alpha", "Beta", "Zeta"]);

    const byStatus = await invoke("enterprise-capability.contribution-records", {
      filters: {
        employeeId: null,
        departmentId: null,
        submittedAfter: null,
        submittedBefore: null,
        reviewStatus: null,
      },
      pagination: { page: 1, pageSize: 10 },
      sorting: { field: "reviewStatus", direction: "asc" },
    });
    expect(byStatus.ok).toBe(true);
    expect(
      (
        byStatus.payload as {
          items: Array<{ reviewStatus: string }>;
        }
      ).items.map((item) => item.reviewStatus),
    ).toEqual(["待审核", "需修改", "已通过"]);
  });

  it("persists approval domain and applicable scope when registering an employee asset", async () => {
    submitProposal({
      proposalId: "proposal:contract-review",
      submittedAt: "2026-05-22T08:00:00.000Z",
      submittedBy: "Alice",
      enterpriseId: "tenant-a",
      status: "proposed",
      manifest: {
        id: "contract-review",
        kind: "skill",
        version: "1.0.0",
        skillKey: "contract-review",
        name: "合同审阅意见整理",
        description: "汇总合同审阅意见并形成结构化结论",
        source: {
          kind: "personal",
          origin: "employee-capability:contract-review",
          trustTier: "user",
        },
        risk: {
          level: "low",
          network: false,
          filesystem: false,
          subprocess: false,
          secrets: false,
        },
      },
      findings: [],
    });

    const reviewed = await invoke("enterprise-capability.review", {
      reviewTaskId: "proposal:contract-review",
      result: "通过",
      opinion: "适合进入法务团队范围复用",
      approval: {
        domain: "法务",
        applicableScope: { kind: "department", id: "legal", name: "法务部" },
        executionMode: "semi_automatic",
        needsEnterpriseSecrets: true,
        promoteToIncubation: true,
      },
    });

    expect(reviewed.ok).toBe(true);
    expect(getProposal("proposal:contract-review")?.status).toBe("approved");
    expect(getRegistryEntry("contract-review")?.manifest).toMatchObject({
      enterpriseDomain: "法务",
      applicableScope: { kind: "department", id: "legal", name: "法务部" },
      enterpriseAssetPackage: {
        executionMode: "semi_automatic",
        needsEnterpriseSecrets: true,
        promotionIntent: "platform_candidate",
      },
    });

    const detail = await invoke("enterprise-capability.detail", {
      capabilityId: "contract-review",
    });
    expect(detail.ok).toBe(true);
    expect(
      (
        detail.payload as {
          capability: { domain: string; applicableScope: { kind: string; id?: string } };
        }
      ).capability,
    ).toMatchObject({
      domain: "法务",
      applicableScope: { kind: "department", id: "legal" },
    });
  });

  it("lists an approved unbound MCP in the MCP catalog, not all-skills or my-installed", async () => {
    const { getPersonalSkillAssetDetail, saveSkillAsset } =
      await import("../skill-lifecycle-store.js");
    saveSkillAsset({
      skillId: "consult-win-advisor",
      ownerUserId: "daniel.hhd@gmail.com",
      lifecycle: "reviewing",
      profile: {
        name: "打单参谋",
        summary: "会前推演与异议应对",
        assetType: "mcp",
        visibility: "enterprise",
      },
      runtimeDefinition: {
        prompts: ["Call advisor for 会前推演."],
        mcpBinding: {
          serverName: "consult-win-advisor",
          transport: "stdio",
          command: "bash",
          args: ["/tmp/openbot-launch.sh"],
        },
      },
    });
    submitProposal({
      proposalId: "proposal:urn:openclaw:skill:consult-win-advisor@1.0.2",
      submittedAt: "2026-09-18T14:00:00.000Z",
      submittedBy: "daniel.hhd@gmail.com",
      enterpriseId: "tenant-a",
      status: "proposed",
      manifest: {
        id: "urn:openclaw:skill:consult-win-advisor@1.0.2",
        kind: "skill",
        version: "1.0.2",
        skillKey: "consult-win-advisor",
        name: "打单参谋",
        description: "会前推演与异议应对",
        assetType: "mcp",
        mcpServerName: "consult-win-advisor",
        source: {
          kind: "personal",
          origin: "employee-capability:consult-win-advisor",
          trustTier: "user",
        },
        risk: {
          level: "low",
          network: true,
          filesystem: false,
          subprocess: true,
          secrets: true,
        },
      },
      findings: [],
    });

    const reviewQueue = await invoke("enterprise-capability.review-queue", {
      filters: { status: null, searchQuery: "打单参谋" },
      pagination: { page: 1, pageSize: 10 },
    });
    expect(reviewQueue.ok).toBe(true);
    expect(
      (
        reviewQueue.payload as {
          items: Array<{ item: { assetType?: string; mcpServerName?: string | null } }>;
        }
      ).items,
    ).toContainEqual(
      expect.objectContaining({
        item: expect.objectContaining({
          capabilityName: "打单参谋",
          assetType: "mcp",
          mcpServerName: "consult-win-advisor",
        }),
      }),
    );

    const reviewed = await invoke("enterprise-capability.review", {
      reviewTaskId: "proposal:urn:openclaw:skill:consult-win-advisor@1.0.2",
      result: "通过",
      opinion: "可进入企业销售复用",
      approval: {
        domain: "销售",
        applicableScope: { kind: "enterprise" },
      },
    });
    expect(reviewed.ok).toBe(true);
    expect(getPersonalSkillAssetDetail("consult-win-advisor").lifecycle).toBe("published");
    expect(getPersonalSkillAssetDetail("consult-win-advisor").profile.visibility).toBe(
      "enterprise",
    );

    const emptyFilters = {
      searchQuery: "打单参谋",
      usageScenario: null,
      applicableTarget: null,
      domain: null,
      maturity: null,
      healthStatus: null,
      onlyInstallable: false,
    };
    const all = await invoke("enterprise-capability.list", {
      filters: emptyFilters,
      pagination: { page: 1, pageSize: 10 },
      sorting: { field: "createdAt", direction: "desc" },
      sidebarEntry: "all",
    });
    expect(all.ok).toBe(true);
    expect(
      (all.payload as { items: Array<{ name: string }> }).items.some(
        (item) => item.name === "打单参谋",
      ),
    ).toBe(false);

    const mcpCatalog = await invoke("enterprise-capability.list", {
      catalog: "mcp",
      filters: emptyFilters,
      pagination: { page: 1, pageSize: 10 },
      sorting: { field: "createdAt", direction: "desc" },
      sidebarEntry: "all",
    });
    expect(mcpCatalog.ok).toBe(true);
    expect(
      (
        mcpCatalog.payload as {
          items: Array<{ name: string; assetType?: string; mcpServerName?: string | null }>;
        }
      ).items,
    ).toContainEqual(
      expect.objectContaining({
        name: "打单参谋",
        assetType: "mcp",
        mcpServerName: "consult-win-advisor",
      }),
    );

    const installed = await invoke("enterprise-capability.list", {
      filters: emptyFilters,
      pagination: { page: 1, pageSize: 10 },
      sorting: { field: "createdAt", direction: "desc" },
      sidebarEntry: "my-installed",
    });
    expect(installed.ok).toBe(true);
    expect(
      (installed.payload as { items: Array<{ name: string }> }).items.some(
        (item) => item.name === "打单参谋",
      ),
    ).toBe(false);
  });

  it("requires domain and applicable scope when approving a review task", async () => {
    submitProposal({
      proposalId: "proposal:missing-approval",
      submittedAt: "2026-05-22T08:00:00.000Z",
      submittedBy: "Alice",
      enterpriseId: "tenant-a",
      status: "proposed",
      manifest: {
        id: "missing-approval",
        kind: "skill",
        version: "1.0.0",
        skillKey: "missing-approval",
        name: "缺少审核参数",
        description: "用于确认审核通过必须携带适用范围",
        source: {
          kind: "personal",
          origin: "employee-capability:missing-approval",
          trustTier: "user",
        },
        risk: {
          level: "low",
          network: false,
          filesystem: false,
          subprocess: false,
          secrets: false,
        },
      },
      findings: [],
    });

    const reviewed = await invoke("enterprise-capability.review", {
      reviewTaskId: "proposal:missing-approval",
      result: "通过",
      opinion: "通过但没有填写适用范围",
    });

    expect(reviewed.ok).toBe(false);
    expect(getProposal("proposal:missing-approval")?.status).toBe("proposed");
  });

  it("keeps an empty tenant ranking empty when other tenants and platform imports exist", async () => {
    await savePlatformAuthStore(
      {
        enabled: true,
        storePath: path.join(tmpDir, "openbot-platform-auth.json"),
        sessionTtlHours: 24,
        activationTtlHours: 24,
        passwordResetTtlMinutes: 30,
        cookieName: "openbot_platform_auth",
        requireMfaForPlatformAdmins: true,
      },
      {
        version: 4,
        secret: "test-secret",
        policy: {
          defaultTrialDays: 7,
          allowedTrialDays: [7],
          defaultTrialSeatCount: 5,
          trialSeatOptions: [5],
          allowCustomTrialSeatCount: false,
          trialExpiryPolicy: "redirect_to_upgrade",
          updatedAt: "2026-05-18T00:00:00.000Z",
        },
        enterprises: {
          "tenant-a": {
            id: "tenant-a",
            name: "Tenant A",
            slug: "tenant-a",
            status: "paid",
            plan: "pro",
            createdSource: "platform-created",
            billingStatus: "paid",
            createdAt: "2026-05-18T00:00:00.000Z",
            updatedAt: "2026-05-18T00:00:00.000Z",
            seatQuota: 10,
            seatUsed: 1,
          },
          "tenant-b": {
            id: "tenant-b",
            name: "Ningxia Must Not See This",
            slug: "tenant-b",
            status: "paid",
            plan: "pro",
            createdSource: "platform-created",
            billingStatus: "paid",
            createdAt: "2026-05-17T00:00:00.000Z",
            updatedAt: "2026-05-17T00:00:00.000Z",
            seatQuota: 10,
            seatUsed: 1,
          },
        },
        users: {
          "user-a": {
            id: "user-a",
            email: "alice@example.com",
            normalizedEmail: "alice@example.com",
            displayName: "Alice",
            passwordHash: "x",
            passwordUpdatedAt: "2026-05-18T00:00:00.000Z",
            loginFailedCount: 0,
            status: "active",
            source: "platform-created",
            role: "operator",
            scopes: ["operator.read"],
            createdAt: "2026-05-18T00:00:00.000Z",
            updatedAt: "2026-05-18T00:00:00.000Z",
          },
          "user-ceo": {
            id: "user-ceo",
            email: "ceo@host.example",
            normalizedEmail: "ceo@host.example",
            displayName: "Host CEO",
            passwordHash: "x",
            passwordUpdatedAt: "2026-05-17T00:00:00.000Z",
            loginFailedCount: 0,
            status: "active",
            source: "platform-created",
            role: "operator",
            scopes: ["operator.read"],
            createdAt: "2026-05-17T00:00:00.000Z",
            updatedAt: "2026-05-17T00:00:00.000Z",
          },
        },
        sessions: {},
        memberships: {
          "membership-a": {
            id: "membership-a",
            userId: "user-a",
            enterpriseId: "tenant-a",
            membershipRole: "admin",
            createdAt: "2026-05-18T00:00:00.000Z",
            updatedAt: "2026-05-18T00:00:00.000Z",
          },
          "membership-ceo": {
            id: "membership-ceo",
            userId: "user-ceo",
            enterpriseId: "tenant-b",
            membershipRole: "admin",
            createdAt: "2026-05-17T00:00:00.000Z",
            updatedAt: "2026-05-17T00:00:00.000Z",
          },
        },
        adminProvisions: {},
        employeeProvisions: {},
        activationCodes: {},
        trialApplications: {},
        leadNotifications: {},
      } as never,
    );

    const skill = (id: string, name: string, origin: string) => ({
      id,
      kind: "skill",
      version: "1.0.0",
      skillKey: id,
      name,
      description: name,
      source: { kind: "managed", origin, trustTier: "first-party" },
      risk: {
        level: "low",
        network: false,
        filesystem: false,
        subprocess: false,
        secrets: false,
      },
    });
    submitProposal({
      proposalId: "proposal:host-managed",
      submittedAt: "2026-05-22T08:00:00.000Z",
      submittedBy: "openclaw-managed",
      enterpriseId: "tenant-b",
      status: "approved",
      manifest: skill("host-managed", "主机 CEO 技能", "openclaw-managed"),
      findings: [],
    });
    submitProposal({
      proposalId: "proposal:host-ceo",
      submittedAt: "2026-05-22T08:30:00.000Z",
      submittedBy: "ceo@host.example",
      enterpriseId: "tenant-b",
      status: "approved",
      manifest: skill("host-ceo", "CEO 周报", "employee-capability:host-ceo"),
      findings: [],
    });
    submitProposal({
      proposalId: "proposal:legacy-import",
      submittedAt: "2026-05-22T09:00:00.000Z",
      submittedBy: "openclaw-managed",
      status: "approved",
      manifest: skill("legacy-import", "无企业导入", "openclaw-managed"),
      findings: [],
    });

    const performance = await invoke("enterprise-capability.contribution-performance", {
      filters: {},
    });
    expect(performance.ok).toBe(true);
    const perfItems = (
      performance.payload as {
        items: Array<{ employeeId: string; employeeName: string; department: string }>;
      }
    ).items;
    expect(perfItems).toEqual([]);

    const records = await invoke("enterprise-capability.contribution-records", {
      filters: {
        employeeId: null,
        departmentId: null,
        submittedAfter: null,
        submittedBefore: null,
        reviewStatus: null,
      },
      pagination: { page: 1, pageSize: 50 },
    });
    expect(records.ok).toBe(true);
    expect((records.payload as { items: unknown[] }).items).toEqual([]);

    const reviewQueue = await invoke("enterprise-capability.review-queue", {
      filters: { status: null, searchQuery: "" },
      pagination: { page: 1, pageSize: 20 },
    });
    expect(reviewQueue.ok).toBe(true);
    expect((reviewQueue.payload as { items: unknown[] }).items).toEqual([]);

    const reviewed = await invoke("enterprise-capability.review", {
      reviewTaskId: "proposal:host-managed",
      result: "拒绝",
      opinion: "不得审核其他企业提案",
    });
    expect(reviewed.ok).toBe(false);
    expect(getProposal("proposal:host-managed")?.status).toBe("approved");
  });

  it("labels this tenant's employee by seat team, not the tenant display name", async () => {
    const seatStore = await loadEnterpriseSeatAssetsStore(undefined);
    const seat = ensureSeatForProvision({
      store: seatStore,
      tenantId: "tenant-a",
      seatTitle: "销售顾问",
      teamLabel: "销售中心",
      nowIso: "2026-05-22T00:00:00.000Z",
    });
    seat.currentEmployeeId = "user-a";
    await saveEnterpriseSeatAssetsStore(undefined, seatStore);
    submitProposal({
      proposalId: "proposal:alice-report",
      submittedAt: "2026-05-22T08:00:00.000Z",
      submittedBy: "alice@example.com",
      enterpriseId: "tenant-a",
      status: "approved",
      manifest: {
        id: "alice-report",
        kind: "skill",
        version: "1.0.0",
        skillKey: "alice-report",
        name: "周报助手",
        description: "自动生成周报",
        source: { kind: "personal", origin: "employee-capability:alice-report", trustTier: "user" },
        risk: {
          level: "low",
          network: false,
          filesystem: false,
          subprocess: false,
          secrets: false,
        },
      },
      findings: [],
    });
    submitProposal({
      proposalId: "proposal:preset-ppt",
      submittedAt: "2026-05-22T09:00:00.000Z",
      submittedBy: "preset-catalog",
      status: "proposed",
      manifest: {
        id: "preset-ppt",
        kind: "skill",
        version: "1.0.0",
        skillKey: "preset-ppt",
        name: "PPT 生成",
        description: "从大纲生成演示文稿",
        source: { kind: "managed", origin: "preset-catalog", trustTier: "first-party" },
        risk: {
          level: "low",
          network: false,
          filesystem: false,
          subprocess: false,
          secrets: false,
        },
      },
      findings: [],
    });

    const performance = await invoke("enterprise-capability.contribution-performance", {
      filters: {},
    });
    expect(performance.ok).toBe(true);
    const perfItems = (
      performance.payload as {
        items: Array<{ employeeId: string; employeeName: string; department: string }>;
      }
    ).items;
    expect(perfItems.map((item) => item.employeeId)).toEqual(["alice@example.com"]);
    expect(perfItems[0]?.employeeName).toBe("Alice");
    expect(perfItems[0]?.department).toBe("销售中心");
    expect(perfItems.some((item) => item.department === "Tenant A")).toBe(false);
    expect(perfItems.some((item) => item.employeeId === "preset-catalog")).toBe(false);
  });
});
