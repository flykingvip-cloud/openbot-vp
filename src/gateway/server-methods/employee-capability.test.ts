import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { MyCapabilityListItem } from "../../../ui/src/ui/controllers/my-accumulation.ts";
import type { GatewayRequestHandlerOptions } from "./types.js";

const tmpDir = path.join(os.tmpdir(), `openbot-employee-capability-${Date.now()}`);
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

const { employeeCapabilityHandlers } = await import("./employee-capability.js");
const { listProposals, registerCapability, updateProposalStatus, updateRegistryDistribution } =
  await import("../capability-governance-store.js");
const { savePlatformAuthStore } = await import("../platform-auth.js");
const { listBindings, listAgents, recordTelemetry } = await import("../agent-runtime-store.js");
const { maybeSeedAgentRuntimeFromPlatformState } = await import("../agent-runtime-seed.js");
const { getPersonalSkillAssetDetail, saveSkillAsset } = await import("../skill-lifecycle-store.js");
const {
  assignSeatToEmployee,
  ensureSeatForProvision,
  grantEnterpriseAccessPolicy,
  loadEnterpriseSeatAssetsStore,
  saveEnterpriseSeatAssetsStore,
} = await import("../enterprise-seat-assets-store.js");

type HandlerResponse = {
  ok: boolean;
  payload?: unknown;
  error?: unknown;
};

const hiddenTerms = [
  "runtimeDefinition",
  "dependencyGraph",
  "skillRuntimeDefinition",
  "prompts",
  "workflow",
  "tools",
  "memoryStrategy",
  "routingHints",
  "dependencies",
  "modelPreferences",
  "executionPolicies",
  "capabilities",
  "providers",
  "healthy",
  "warning",
  "broken",
  "published",
  "reviewing",
  "deprecated",
  "retired",
];

async function invoke(method: string, params: Record<string, unknown>): Promise<HandlerResponse> {
  return invokeAsUser(method, params, "alice@example.com");
}

async function invokeUnauthenticated(
  method: string,
  params: Record<string, unknown>,
): Promise<HandlerResponse> {
  const handler = employeeCapabilityHandlers[method];
  if (!handler) {
    throw new Error(`missing handler ${method}`);
  }
  let response: HandlerResponse | null = null;
  await handler({
    req: { type: "req", id: "test", method, params },
    params,
    client: null,
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

async function invokeAsUser(
  method: string,
  params: Record<string, unknown>,
  userEmail: string,
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

function cleanStore() {
  fs.rmSync(path.join(tmpDir, "skill-assets"), { recursive: true, force: true });
  fs.rmSync(path.join(tmpDir, "governance"), { recursive: true, force: true });
  fs.rmSync(path.join(tmpDir, "agent-runtime"), { recursive: true, force: true });
  fs.mkdirSync(tmpDir, { recursive: true });
}

function expectEmployeeOnly(value: unknown) {
  const serialized = JSON.stringify(value);
  for (const term of hiddenTerms) {
    expect(serialized).not.toContain(term);
  }
}

async function quickSaveExample() {
  const response = await invoke("employee-capability.quick-save", {
    sourceAgentId: "robot-alpha",
    sourceContextId: "customer-summary",
    form: {
      name: "客户沟通整理",
      summary: "把客户对话整理为清晰摘要",
    },
  });
  expect(response.ok).toBe(true);
  return response.payload as { capability: { id: string } };
}

async function prepareRuntimeSeedForUser(email: string, capabilityId: string) {
  registerCapability({
    id: `urn:openclaw:skill:${capabilityId}@1.0.0`,
    kind: "skill",
    version: "1.0.0",
    skillKey: capabilityId,
    name: capabilityId,
    description: `${capabilityId} skill`,
    source: { kind: "personal", origin: `employee-capability:${capabilityId}`, trustTier: "user" },
    risk: { level: "low", network: false, filesystem: false, subprocess: false, secrets: false },
  });
  const platformStorePath = path.join(tmpDir, "openbot-platform-auth.json");
  await savePlatformAuthStore(
    {
      enabled: true,
      storePath: platformStorePath,
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
          email,
          normalizedEmail: email,
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
          membershipRole: "member",
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
  await maybeSeedAgentRuntimeFromPlatformState({
    cfg: {
      meta: { lastTouchedVersion: "2026.3.9" },
      gateway: {
        auth: {
          trustedProxy: {
            userHeader: "x-forwarded-user",
            platformAuth: { enabled: true, store: platformStorePath },
          },
        },
      },
    } as never,
    trustedProxy: {
      userHeader: "x-forwarded-user",
      platformAuth: {
        enabled: true,
        store: platformStorePath,
      },
    },
  });
}

describe("employee capability gateway handlers", () => {
  beforeEach(cleanStore);

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("quick-saves an employee-language draft and hides runtime fields", async () => {
    const payload = await quickSaveExample();

    expect(payload.capability.id).toMatch(/^skill_/);
    expect(payload.capability).toMatchObject({
      name: "客户沟通整理",
      summary: "把客户对话整理为清晰摘要",
      health: "运行稳定",
      shareVisibility: "私有",
      isDraft: true,
    });
    expectEmployeeOnly(payload);
  });

  it("scopes 我的资产 to the authenticated owner and hides others", async () => {
    const aliceSaved = await invokeAsUser(
      "employee-capability.quick-save",
      {
        sourceAgentId: "robot-alpha",
        sourceContextId: "alice-note",
        form: { name: "Alice 资产", summary: "仅 Alice 可见" },
      },
      "alice@example.com",
    );
    const bobSaved = await invokeAsUser(
      "employee-capability.quick-save",
      {
        sourceAgentId: "robot-beta",
        sourceContextId: "bob-note",
        form: { name: "Bob 资产", summary: "仅 Bob 可见" },
      },
      "bob@example.com",
    );
    expect(aliceSaved.ok).toBe(true);
    expect(bobSaved.ok).toBe(true);

    const aliceList = await invokeAsUser(
      "employee-capability.my-accumulation",
      {},
      "alice@example.com",
    );
    const bobList = await invokeAsUser(
      "employee-capability.my-accumulation",
      {},
      "bob@example.com",
    );
    const aliceIds = (
      aliceList.payload as { items: Array<{ id: string; name: string }> }
    ).items.map((item) => item.name);
    const bobIds = (bobList.payload as { items: Array<{ id: string; name: string }> }).items.map(
      (item) => item.name,
    );
    expect(aliceIds).toEqual(["Alice 资产"]);
    expect(bobIds).toEqual(["Bob 资产"]);

    const bobCapabilityId = (bobSaved.payload as { capability: { id: string } }).capability.id;
    const alicePeek = await invokeAsUser(
      "employee-capability.detail",
      { capabilityId: bobCapabilityId },
      "alice@example.com",
    );
    expect(alicePeek.ok).toBe(false);

    const unauthenticated = await invokeUnauthenticated("employee-capability.my-accumulation", {});
    expect(unauthenticated.ok).toBe(true);
    expect((unauthenticated.payload as { items: unknown[] }).items).toEqual([]);

    const unauthenticatedSave = await invokeUnauthenticated("employee-capability.quick-save", {
      sourceAgentId: "robot-alpha",
      form: { name: "匿名资产", summary: "不应落库到我的资产" },
    });
    expect(unauthenticatedSave.ok).toBe(false);
  });

  it("does not list deliverables, knowledge documents, or enterprise install copies in 我的资产", async () => {
    await quickSaveExample();
    saveSkillAsset({
      ownerUserId: "alice@example.com",
      sourceAgentId: "sales-bot",
      contextId: "sess-deliverable",
      profile: {
        name: "自动捕获的周报",
        summary: "对话成果不应进入我的资产",
        assetType: "knowledge",
        category: "对话成果",
        visibility: "private",
      },
    });
    saveSkillAsset({
      ownerUserId: "alice@example.com",
      sourceAgentId: "sales-bot",
      contextId: "sess-collect",
      profile: {
        name: "一键收录的制度",
        summary: "知识文档不应进入我的资产",
        assetType: "knowledge",
        category: "知识收录",
        visibility: "private",
      },
    });
    saveSkillAsset({
      ownerUserId: "alice@example.com",
      sourceAgentId: "sales-bot",
      contextId: "sess-upload",
      profile: {
        name: "上传的手册.pdf",
        summary: "上传文档不应进入我的资产",
        assetType: "knowledge",
        category: "上传文档",
        visibility: "private",
      },
    });
    saveSkillAsset({
      ownerUserId: "alice@example.com",
      sourceAgentId: "robot-alpha",
      lifecycle: "private",
      profile: {
        name: "网页检索工具",
        summary: "搜索公开网页",
        assetType: "tool",
        visibility: "private",
      },
      runtimeDefinition: {
        toolBinding: { toolIds: ["web_search"] },
      },
    });
    saveSkillAsset({
      ownerUserId: "alice@example.com",
      sourceAgentId: "robot-alpha",
      lifecycle: "private",
      profile: {
        name: "Linear MCP",
        summary: "查询 Linear 任务",
        assetType: "mcp",
        visibility: "private",
      },
      runtimeDefinition: {
        mcpBinding: {
          serverName: "linear",
          transport: "http",
          url: "https://mcp.linear.app",
        },
      },
    });
    saveSkillAsset({
      ownerUserId: "alice@example.com",
      sourceAgentId: "robot-alpha",
      contextId: "enterprise-capability:manifest-1",
      lifecycle: "published",
      profile: {
        name: "岗位市场能力副本",
        summary: "安装物化副本不应进入我的资产",
        assetType: "capability",
        tags: ["企业能力", "岗位推送"],
        category: "企业能力",
        visibility: "enterprise",
      },
    });

    const accumulation = await invoke("employee-capability.my-accumulation", {});
    const names = (accumulation.payload as { items: Array<{ name: string }> }).items.map(
      (item) => item.name,
    );
    expect(names).toEqual(expect.arrayContaining(["客户沟通整理", "网页检索工具", "Linear MCP"]));
    expect(names).toHaveLength(3);
  });

  it("projects 我的资产 tab discriminators from live lifecycle states", async () => {
    const draft = await invoke("employee-capability.quick-save", {
      sourceAgentId: "robot-alpha",
      sourceContextId: "tab-draft",
      form: { name: "草稿客户沟通", summary: "还在整理的客户沟通摘要" },
    });
    const reviewing = await invoke("employee-capability.quick-save", {
      sourceAgentId: "robot-alpha",
      sourceContextId: "tab-reviewing",
      form: { name: "审核中客户沟通", summary: "已提交企业的客户沟通摘要" },
    });
    const registered = await invoke("employee-capability.quick-save", {
      sourceAgentId: "robot-alpha",
      sourceContextId: "tab-registered",
      form: { name: "已入企业客户沟通", summary: "已进入企业资产库的客户沟通摘要" },
    });
    const optimize = await invoke("employee-capability.quick-save", {
      sourceAgentId: "robot-alpha",
      sourceContextId: "tab-optimize",
      form: { name: "需优化客户沟通", summary: "被退回修改的客户沟通摘要" },
    });
    expect(draft.ok, JSON.stringify(draft.error)).toBe(true);
    expect(reviewing.ok, JSON.stringify(reviewing.error)).toBe(true);
    expect(registered.ok, JSON.stringify(registered.error)).toBe(true);
    expect(optimize.ok, JSON.stringify(optimize.error)).toBe(true);
    const draftId = (draft.payload as { capability: { id: string } }).capability.id;
    const reviewingId = (reviewing.payload as { capability: { id: string } }).capability.id;
    const registeredId = (registered.payload as { capability: { id: string } }).capability.id;
    const optimizeId = (optimize.payload as { capability: { id: string } }).capability.id;

    const reviewingSubmit = await invoke("employee-capability.submit-to-enterprise", {
      capabilityId: reviewingId,
      scope: { kind: "enterprise" },
    });
    expect(reviewingSubmit.ok, JSON.stringify(reviewingSubmit.error)).toBe(true);
    registerCapability({
      id: `urn:openclaw:skill:${registeredId}@1.0.0`,
      kind: "skill",
      version: "1.0.0",
      skillKey: registeredId,
      name: "已入企业客户沟通",
      description: "已进入企业资产库的客户沟通摘要",
      source: {
        kind: "personal",
        origin: `employee-capability:${registeredId}`,
        trustTier: "user",
      },
      risk: { level: "low", network: false, filesystem: false, subprocess: false, secrets: false },
    });
    expect(
      (
        await invoke("employee-capability.submit-to-enterprise", {
          capabilityId: registeredId,
          scope: { kind: "enterprise" },
        })
      ).ok,
    ).toBe(true);
    expect(
      (
        await invoke("employee-capability.submit-to-enterprise", {
          capabilityId: optimizeId,
          scope: { kind: "enterprise" },
        })
      ).ok,
    ).toBe(true);
    const optimizeProposal = listProposals().find(
      (proposal) =>
        proposal.manifest.skillKey === optimizeId || proposal.manifest.name === "需优化客户沟通",
    );
    expect(
      optimizeProposal?.proposalId,
      `missing optimize proposal in ${JSON.stringify(listProposals().map((proposal) => ({ id: proposal.proposalId, skillKey: proposal.manifest.skillKey, name: proposal.manifest.name })))}`,
    ).toBeTruthy();
    updateProposalStatus(optimizeProposal!.proposalId, "rejected", {
      id: "enterprise-reviewer",
      note: "请补充适用范围",
    });

    const accumulation = await invoke("employee-capability.my-accumulation", {});
    const items = (accumulation.payload as { items: MyCapabilityListItem[] }).items;
    const byId = Object.fromEntries(items.map((item) => [item.id, item]));

    expect(byId[draftId]).toMatchObject({ isDraft: true, shareVisibility: "私有" });
    expect(byId[reviewingId]).toMatchObject({ isDraft: false, shareVisibility: "审核中" });
    expect(byId[registeredId]).toMatchObject({
      isDraft: false,
      shareVisibility: "已进入企业资产库",
    });
    expect(byId[optimizeId]).toMatchObject({
      shareVisibility: "需要修改后再次提交",
    });

    const { filterItemsBySegment } =
      await import("../../../ui/src/ui/controllers/my-accumulation.ts");
    expect(
      filterItemsBySegment(items, "all")
        .map((item) => item.id)
        .toSorted(),
    ).toEqual([draftId, reviewingId, registeredId, optimizeId].toSorted());
    expect(filterItemsBySegment(items, "drafts").map((item) => item.id)).toEqual([draftId]);
    expect(filterItemsBySegment(items, "reviewing").map((item) => item.id)).toEqual([reviewingId]);
    expect(filterItemsBySegment(items, "contributed").map((item) => item.id)).toEqual([
      registeredId,
    ]);
    expect(filterItemsBySegment(items, "optimize").map((item) => item.id)).toEqual([optimizeId]);
  });

  it("stamps ownerUserId on quick-save", async () => {
    const saved = await quickSaveExample();
    const detail = getPersonalSkillAssetDetail(saved.capability.id);
    expect(detail.ownerUserId).toBe("alice@example.com");
  });

  it("returns profile, accumulation, detail, and helper panels in employee shapes", async () => {
    const saved = await quickSaveExample();
    const capabilityId = saved.capability.id;

    const profile = await invoke("employee-capability.profile", { agentId: "robot-alpha" });
    expect(profile.ok).toBe(true);
    expectEmployeeOnly(profile.payload);

    const accumulation = await invoke("employee-capability.my-accumulation", {});
    expect(accumulation.ok).toBe(true);
    expect((accumulation.payload as { items: unknown[] }).items).toHaveLength(1);
    expectEmployeeOnly(accumulation.payload);

    const detail = await invoke("employee-capability.detail", { capabilityId });
    expect(detail.ok).toBe(true);
    expectEmployeeOnly(detail.payload);

    const attribution = await invoke("employee-capability.attribution", { capabilityId });
    expect(attribution.ok).toBe(true);
    expectEmployeeOnly(attribution.payload);

    const usage = await invoke("employee-capability.usage-brief", { capabilityId });
    expect(usage.ok).toBe(true);
    expectEmployeeOnly(usage.payload);
  });

  it("supports robot operations without deleting the capability body", async () => {
    const saved = await quickSaveExample();
    const capabilityId = saved.capability.id;
    const userEmail = "alice@example.com";
    await prepareRuntimeSeedForUser(userEmail, capabilityId);
    const seededInstall = await invokeAsUser(
      "employee-capability.install-to-robot",
      { capabilityId, agentId: "robot-alpha" },
      userEmail,
    );
    expect(seededInstall.ok).toBe(true);

    const toggled = await invoke("employee-capability.toggle", {
      capabilityId,
      agentId: "robot-alpha",
      enabled: false,
    });
    expect(toggled).toMatchObject({
      ok: true,
      payload: { capabilityId, agentId: "robot-alpha", enabled: false },
    });

    const removed = await invoke("employee-capability.remove-from-robot", {
      capabilityId,
      agentId: "robot-alpha",
    });
    expect(removed.ok).toBe(true);

    const accumulation = await invoke("employee-capability.my-accumulation", {});
    expect((accumulation.payload as { items: Array<{ id: string }> }).items[0]?.id).toBe(
      capabilityId,
    );

    const installed = await invokeAsUser(
      "employee-capability.install-to-robot",
      {
        capabilityId,
        agentId: "robot-alpha",
      },
      userEmail,
    );
    expect(installed.ok).toBe(true);
    const agents = listAgents({
      lifecycle: null,
      health: null,
      tenantId: "tenant-a",
      searchQuery: "",
    });
    const runtimeAgentId = agents[0]?.runtimeAgentId;
    expect(runtimeAgentId).toBeTruthy();
    const bindings = listBindings({
      runtimeAgentId: runtimeAgentId ?? null,
      capabilityId: `urn:openclaw:skill:${capabilityId}@1.0.0`,
      bindingType: null,
      bindingState: null,
      health: null,
    });
    expect(bindings[0]?.bindingType).toBe("tenant-installed");
  });

  it("prefers tenant runtime usage metrics when employee assets are installed to runtime", async () => {
    const saved = await quickSaveExample();
    const capabilityId = saved.capability.id;
    const userEmail = "alice@example.com";
    await prepareRuntimeSeedForUser(userEmail, capabilityId);

    const installed = await invokeAsUser(
      "employee-capability.install-to-robot",
      {
        capabilityId,
        agentId: "robot-alpha",
      },
      userEmail,
    );
    expect(installed.ok).toBe(true);

    const runtimeAgentId = listAgents({
      lifecycle: null,
      health: null,
      tenantId: "tenant-a",
      searchQuery: "",
    })[0]?.runtimeAgentId;
    expect(runtimeAgentId).toBeTruthy();

    recordTelemetry({
      runtimeAgentId: runtimeAgentId,
      capabilityId: `urn:openclaw:skill:${capabilityId}@1.0.0`,
      calls7d: 25,
      successRate7d: 0.92,
      avgLatencyMs: 320,
      p95LatencyMs: 600,
      tokenConsumption7d: 5000,
      errorCount7d: 2,
      queueDepth: 0,
      memoryPressure: 0.2,
      lastSampleAt: 1_700_123_456_789,
    });

    const detail = await invokeAsUser("employee-capability.detail", { capabilityId }, userEmail);
    expect(detail.ok).toBe(true);
    expect(
      (
        detail.payload as {
          capability: {
            usageMetrics: {
              totalUsageCount: number;
              lastUsedAt: number | null;
              robotCount: number;
            };
            usage: { totalUsageCount: number; lastUsedAt: number | null };
          };
        }
      ).capability.usageMetrics,
    ).toMatchObject({
      totalUsageCount: 100,
      lastUsedAt: 1_700_123_456_789,
      robotCount: 1,
    });
    expect(
      (
        detail.payload as {
          capability: { usage: { totalUsageCount: number; lastUsedAt: number | null } };
        }
      ).capability.usage,
    ).toMatchObject({
      totalUsageCount: 100,
      lastUsedAt: 1_700_123_456_789,
    });
  });

  it("edits, shares, subscribes health labels, lists recaps, and deletes", async () => {
    const saved = await quickSaveExample();
    const capabilityId = saved.capability.id;

    const edited = await invoke("employee-capability.edit", {
      capabilityId,
      changes: {
        summary: "把客户沟通整理为摘要和行动建议",
        tags: ["客户", "摘要"],
      },
      changeHeadline: "最近更新 · 优化了输出说明",
    });
    expect(edited.ok).toBe(true);
    expectEmployeeOnly(edited.payload);

    const shared = await invoke("employee-capability.share-to-group", {
      capabilityId,
      groupId: "sales",
    });
    expect(shared).toMatchObject({
      ok: true,
      payload: {
        capabilityId,
        groupId: "sales",
        shareVisibility: "已共享到协作小组",
      },
    });

    const health = await invoke("employee-capability.health-label.subscribe", {
      capabilityIds: [capabilityId],
    });
    expect(health.ok).toBe(true);
    expect(
      (health.payload as { initialLabels: Array<{ health: string }> }).initialLabels[0]?.health,
    ).toBe("运行稳定");

    const recaps = await invoke("employee-capability.update-recap", { capabilityId });
    expect(recaps.ok).toBe(true);
    expectEmployeeOnly(recaps.payload);

    const deleted = await invoke("employee-capability.delete", { capabilityId });
    expect(deleted).toMatchObject({ ok: true, payload: { capabilityId } });
  });

  it("exposes traceable share attribution history in capability detail after sharing", async () => {
    const saved = await quickSaveExample();
    const capabilityId = saved.capability.id;

    // 分享前：详情不应带任何分享历史
    const before = await invoke("employee-capability.detail", { capabilityId });
    expect(before.ok).toBe(true);
    expect(
      (before.payload as { capability: { shareHistory?: unknown[] } }).capability.shareHistory,
    ).toBeUndefined();

    // 以某员工身份分享到协作小组，记录归因（谁分享的）
    const shared = await invokeAsUser(
      "employee-capability.share-to-group",
      { capabilityId, groupId: "sales" },
      "alice@example.com",
    );
    expect(shared.ok).toBe(true);

    // 分享后：详情暴露可追溯的分享归因（谁 / 何时 / 分享到哪个组）
    const after = await invoke("employee-capability.detail", { capabilityId });
    expect(after.ok).toBe(true);
    const shareHistory = (
      after.payload as {
        capability: {
          shareHistory?: Array<{
            shareId: string;
            groupId: string;
            groupName: string;
            sharedByDisplayName: string;
            sharedAt: number;
          }>;
        };
      }
    ).capability.shareHistory;
    expect(shareHistory).toBeDefined();
    expect(shareHistory).toHaveLength(1);
    expect(shareHistory?.[0]).toMatchObject({ groupId: "sales", groupName: "sales" });
    expect(shareHistory?.[0]?.shareId).toMatch(/^share_/);
    expect(shareHistory?.[0]?.sharedByDisplayName).toBeTruthy();
    expect(shareHistory?.[0]?.sharedAt).toBeGreaterThan(0);
    expectEmployeeOnly(after.payload);
  });

  it("submits to enterprise review while returning only employee-language visibility", async () => {
    const saved = await quickSaveExample();
    const capabilityId = saved.capability.id;

    const submitted = await invoke("employee-capability.submit-to-enterprise", {
      capabilityId,
      scope: { kind: "enterprise" },
      packageDraft: {
        packageTitle: "公众号文章编辑与发布",
        packageSummary: "用于整理、生成并发布公众号文章的复合资产包",
        assetPackageType: "composite_pack",
        businessScenario: "公众号文章编辑与发布",
        inputArtifacts: ["标题", "正文 Markdown"],
        outputArtifacts: ["已发布文章", "发布记录"],
        dependencies: ["publish.js", "wechat-config.md"],
        executionMode: "semi_automatic",
        riskTags: ["external_publish", "credential_required", "brand_risk"],
        targetTeams: ["市场", "新媒体"],
        verifiedInProduction: true,
        promotionIntent: "enterprise_standard",
        needsEnterpriseSecrets: true,
        notes: "需企业统一托管公众号凭证",
      },
    });

    expect(submitted).toMatchObject({
      ok: true,
      payload: {
        capabilityId,
        shareVisibility: "审核中",
      },
    });
    expectEmployeeOnly(submitted.payload);

    const detail = await invoke("employee-capability.detail", { capabilityId });
    expect(detail.ok).toBe(true);
    expect(
      (detail.payload as { capability: { shareVisibility: string } }).capability.shareVisibility,
    ).toBe("审核中");
    expect(
      (
        detail.payload as {
          capability: {
            enterpriseReview?: {
              statusLabel: string;
              nextStep: string;
              submittedAt?: number | null;
            };
          };
        }
      ).capability.enterpriseReview,
    ).toMatchObject({
      statusLabel: "审核中",
      nextStep: "等待企业管理员开始审核。",
    });
    expectEmployeeOnly(detail.payload);
    const proposals = listProposals();
    expect(proposals).toHaveLength(1);
    expect(proposals[0]?.manifest.skillKey).toBe(capabilityId);
    expect(proposals[0]?.status).toBe("proposed");
    expect(proposals[0]?.manifest.enterpriseAssetPackage).toMatchObject({
      packageTitle: "公众号文章编辑与发布",
      assetPackageType: "composite_pack",
      executionMode: "semi_automatic",
      needsEnterpriseSecrets: true,
    });
  });

  it("maps rejected enterprise review back to employee revision-needed visibility", async () => {
    const saved = await quickSaveExample();
    const capabilityId = saved.capability.id;

    await invoke("employee-capability.submit-to-enterprise", {
      capabilityId,
      scope: { kind: "enterprise" },
    });

    const proposals = listProposals();
    expect(proposals[0]?.proposalId).toBeTruthy();
    updateProposalStatus(proposals[0].proposalId, "rejected", {
      id: "enterprise-reviewer",
      note: "请补充适用范围",
    });

    const detail = await invoke("employee-capability.detail", { capabilityId });
    expect(detail.ok).toBe(true);
    expect(
      (detail.payload as { capability: { shareVisibility: string } }).capability.shareVisibility,
    ).toBe("需要修改后再次提交");
    expectEmployeeOnly(detail.payload);
  });

  it("maps enterprise modification requests back to employee revision-needed visibility", async () => {
    const saved = await quickSaveExample();
    const capabilityId = saved.capability.id;

    await invoke("employee-capability.submit-to-enterprise", {
      capabilityId,
      scope: { kind: "enterprise" },
    });

    const proposals = listProposals();
    expect(proposals[0]?.proposalId).toBeTruthy();
    updateProposalStatus(proposals[0].proposalId, "withdrawn", {
      id: "enterprise-reviewer",
      note: "请补充适用范围和输出示例",
    });

    const detail = await invoke("employee-capability.detail", { capabilityId });
    expect(detail.ok).toBe(true);
    expect(
      (detail.payload as { capability: { shareVisibility: string } }).capability.shareVisibility,
    ).toBe("需要修改后再次提交");
    expectEmployeeOnly(detail.payload);
  });

  it("resubmits revision-needed assets as a fresh enterprise review proposal", async () => {
    const saved = await quickSaveExample();
    const capabilityId = saved.capability.id;

    await invoke("employee-capability.submit-to-enterprise", {
      capabilityId,
      scope: { kind: "enterprise" },
    });

    const firstProposal = listProposals()[0];
    expect(firstProposal?.proposalId).toBeTruthy();
    updateProposalStatus(firstProposal.proposalId, "withdrawn", {
      id: "enterprise-reviewer",
      note: "请补充适用范围和输出示例",
    });

    const revisionNeeded = await invoke("employee-capability.detail", { capabilityId });
    expect(
      (revisionNeeded.payload as { capability: { feedbackSummary: string } }).capability
        .feedbackSummary,
    ).toContain("请补充适用范围和输出示例");

    const resubmitted = await invoke("employee-capability.submit-to-enterprise", {
      capabilityId,
      scope: { kind: "enterprise" },
    });

    expect(resubmitted).toMatchObject({
      ok: true,
      payload: {
        capabilityId,
        shareVisibility: "审核中",
      },
    });
    const proposals = listProposals();
    expect(proposals).toHaveLength(2);
    expect(proposals.at(-1)).toMatchObject({
      status: "proposed",
      manifest: { skillKey: capabilityId },
    });

    const detail = await invoke("employee-capability.detail", { capabilityId });
    expect(
      (detail.payload as { capability: { shareVisibility: string } }).capability.shareVisibility,
    ).toBe("审核中");
  });

  it("returns enterprise-library visibility when submitted asset is already registered", async () => {
    const saved = await quickSaveExample();
    const capabilityId = saved.capability.id;
    registerCapability({
      id: `urn:openclaw:skill:${capabilityId}@1.0.0`,
      kind: "skill",
      version: "1.0.0",
      skillKey: capabilityId,
      name: "客户沟通整理",
      description: "把客户对话整理为清晰摘要",
      source: {
        kind: "personal",
        origin: `employee-capability:${capabilityId}`,
        trustTier: "user",
      },
      risk: { level: "low", network: false, filesystem: false, subprocess: false, secrets: false },
    });

    const submitted = await invoke("employee-capability.submit-to-enterprise", {
      capabilityId,
      scope: { kind: "enterprise" },
    });

    expect(submitted).toMatchObject({
      ok: true,
      payload: {
        capabilityId,
        shareVisibility: "已进入企业资产库",
      },
    });
  });

  it("does not put a private draft into the enterprise library just because a registry row exists", async () => {
    const saved = await quickSaveExample();
    const capabilityId = saved.capability.id;
    registerCapability({
      id: `urn:openclaw:skill:${capabilityId}@1.0.0`,
      kind: "skill",
      version: "1.0.0",
      skillKey: capabilityId,
      name: "客户沟通整理",
      description: "把客户对话整理为清晰摘要",
      source: {
        kind: "personal",
        origin: `employee-capability:${capabilityId}`,
        trustTier: "user",
      },
      risk: { level: "low", network: false, filesystem: false, subprocess: false, secrets: false },
    });

    const detail = await invoke("employee-capability.detail", { capabilityId });
    expect(detail.ok).toBe(true);
    expect(
      (detail.payload as { capability: { shareVisibility: string; isDraft: boolean } }).capability,
    ).toMatchObject({ shareVisibility: "私有", isDraft: true });
  });

  it("lists only shareable recommendations and installs one to the robot", async () => {
    const privateSaved = await quickSaveExample();
    const sharedSaved = await quickSaveExample();
    const sharedCapabilityId = sharedSaved.capability.id;

    await invoke("employee-capability.share-to-group", {
      capabilityId: sharedCapabilityId,
      groupId: "sales",
    });

    const recommendations = await invoke("employee-capability.recommendations", {
      agentId: "robot-beta",
    });

    expect(recommendations.ok).toBe(true);
    const items = (
      recommendations.payload as { recommendations: Array<{ capability: { id: string } }> }
    ).recommendations;
    expect(items.map((entry) => entry.capability.id)).toContain(sharedCapabilityId);
    expect(items.map((entry) => entry.capability.id)).not.toContain(privateSaved.capability.id);
    expectEmployeeOnly(recommendations.payload);

    const installed = await invoke("employee-capability.install-to-robot", {
      capabilityId: sharedCapabilityId,
      agentId: "robot-beta",
    });
    expect(installed.ok).toBe(true);

    const afterInstall = await invoke("employee-capability.recommendations", {
      agentId: "robot-beta",
    });
    const nextItems = (
      afterInstall.payload as { recommendations: Array<{ capability: { id: string } }> }
    ).recommendations;
    expect(nextItems.map((entry) => entry.capability.id)).not.toContain(sharedCapabilityId);
  });

  it("shows position-pushed enterprise capabilities and lets employees install them to robots", async () => {
    const userEmail = "alice@example.com";
    await prepareRuntimeSeedForUser(userEmail, "customer-summary");
    const seatStore = await loadEnterpriseSeatAssetsStore();
    const seat = ensureSeatForProvision({
      store: seatStore,
      tenantId: "tenant-a",
      seatTitle: "销售顾问",
      teamLabel: "销售中心/华东大区",
      nowIso: "2026-05-22T00:00:00.000Z",
      agentIds: ["robot-beta"],
    });
    assignSeatToEmployee({
      store: seatStore,
      tenantId: "tenant-a",
      seatId: seat.seatId,
      employeeId: "user-a",
      nowIso: "2026-05-22T00:01:00.000Z",
    });
    grantEnterpriseAccessPolicy({
      store: seatStore,
      tenantId: "tenant-a",
      subjectType: "seat",
      subjectId: seat.seatId,
      resourceType: "capability",
      resourceId: "urn:openclaw:skill:customer-summary@1.0.0",
      action: "execute",
      nowIso: "2026-05-22T00:02:00.000Z",
    });
    await saveEnterpriseSeatAssetsStore(undefined, seatStore);

    const recommendations = await invokeAsUser(
      "employee-capability.recommendations",
      { agentId: "robot-beta" },
      userEmail,
    );

    expect(recommendations.ok).toBe(true);
    const items = (
      recommendations.payload as {
        recommendations: Array<{ capability: { id: string; sourceContextLabel?: string } }>;
      }
    ).recommendations;
    expect(items).toContainEqual(
      expect.objectContaining({
        capability: expect.objectContaining({
          id: "customer-summary",
          sourceContextLabel: "企业推送 · 销售顾问",
        }),
      }),
    );

    const installed = await invokeAsUser(
      "employee-capability.install-to-robot",
      {
        capabilityId: "customer-summary",
        agentId: "robot-beta",
      },
      userEmail,
    );
    expect(installed).toMatchObject({
      ok: true,
      payload: { capabilityId: "customer-summary", agentId: "robot-beta" },
    });

    const afterInstall = await invokeAsUser(
      "employee-capability.recommendations",
      { agentId: "robot-beta" },
      userEmail,
    );
    expect(
      (
        afterInstall.payload as {
          recommendations: Array<{ capability: { id: string } }>;
        }
      ).recommendations.map((entry) => entry.capability.id),
    ).not.toContain("customer-summary");
  });

  it("shows platform-direct capabilities to employees without position push when visibility mode is enabled", async () => {
    const userEmail = "alice@example.com";
    await prepareRuntimeSeedForUser(userEmail, "customer-summary");
    updateRegistryDistribution(
      "urn:openclaw:skill:customer-summary@1.0.0",
      { tenantIds: ["tenant-a"] },
      true,
      "direct_employee_visible",
      "platform-admin",
    );

    const seatStore = await loadEnterpriseSeatAssetsStore();
    const seat = ensureSeatForProvision({
      store: seatStore,
      tenantId: "tenant-a",
      seatTitle: "销售顾问",
      teamLabel: "销售中心/华东大区",
      nowIso: "2026-05-22T00:00:00.000Z",
      agentIds: ["robot-beta"],
    });
    assignSeatToEmployee({
      store: seatStore,
      tenantId: "tenant-a",
      seatId: seat.seatId,
      employeeId: "user-a",
      nowIso: "2026-05-22T00:01:00.000Z",
    });
    await saveEnterpriseSeatAssetsStore(undefined, seatStore);

    const recommendations = await invokeAsUser(
      "employee-capability.recommendations",
      { agentId: "robot-beta" },
      userEmail,
    );

    expect(recommendations.ok).toBe(true);
    const items = (
      recommendations.payload as {
        recommendations: Array<{ capability: { id: string; sourceContextLabel?: string } }>;
      }
    ).recommendations;
    expect(items).toContainEqual(
      expect.objectContaining({
        capability: expect.objectContaining({
          id: "customer-summary",
          sourceContextLabel: "平台直达",
        }),
      }),
    );
  });

  it("deduplicates platform-direct and position-pushed capabilities in favor of position push", async () => {
    const userEmail = "alice@example.com";
    await prepareRuntimeSeedForUser(userEmail, "customer-summary");
    updateRegistryDistribution(
      "urn:openclaw:skill:customer-summary@1.0.0",
      { tenantIds: ["tenant-a"] },
      true,
      "direct_employee_visible",
      "platform-admin",
    );

    const seatStore = await loadEnterpriseSeatAssetsStore();
    const seat = ensureSeatForProvision({
      store: seatStore,
      tenantId: "tenant-a",
      seatTitle: "销售顾问",
      teamLabel: "销售中心/华东大区",
      nowIso: "2026-05-22T00:00:00.000Z",
      agentIds: ["robot-beta"],
    });
    assignSeatToEmployee({
      store: seatStore,
      tenantId: "tenant-a",
      seatId: seat.seatId,
      employeeId: "user-a",
      nowIso: "2026-05-22T00:01:00.000Z",
    });
    grantEnterpriseAccessPolicy({
      store: seatStore,
      tenantId: "tenant-a",
      subjectType: "seat",
      subjectId: seat.seatId,
      resourceType: "capability",
      resourceId: "urn:openclaw:skill:customer-summary@1.0.0",
      action: "execute",
      nowIso: "2026-05-22T00:02:00.000Z",
    });
    await saveEnterpriseSeatAssetsStore(undefined, seatStore);

    const recommendations = await invokeAsUser(
      "employee-capability.recommendations",
      { agentId: "robot-beta" },
      userEmail,
    );

    expect(recommendations.ok).toBe(true);
    const items = (
      recommendations.payload as {
        recommendations: Array<{ capability: { id: string; sourceContextLabel?: string } }>;
      }
    ).recommendations.filter((entry) => entry.capability.id === "customer-summary");
    expect(items).toHaveLength(1);
    expect(items[0]?.capability.sourceContextLabel).toBe("企业推送 · 销售顾问");
  });

  it("finds shareable skills by what the robot should do", async () => {
    const { saveSkillAsset } = await import("../skill-lifecycle-store.js");
    const saved = saveSkillAsset({
      sourceAgentId: "robot-alpha",
      ownerUserId: "alice@example.com",
      lifecycle: "published",
      profile: {
        name: "会议纪要专家",
        summary: "把会议录音和讨论整理成会议纪要",
        visibility: "private",
        outputDescription: "结构化会议纪要正文，含决议、风险与行动项",
      },
    });
    const capabilityId = saved.skillId;
    const shared = await invoke("employee-capability.share-to-group", {
      capabilityId,
      groupId: "sales",
    });
    expect(shared.ok, JSON.stringify(shared.error)).toBe(true);

    const can = await invoke("employee-capability.can", {
      agentId: "robot-beta",
      intent: "做会议纪要",
    });
    expect(can.ok).toBe(true);
    expectEmployeeOnly(can.payload);
    const matches = (
      can.payload as {
        matches: Array<{
          capability: { id: string; name: string };
          task: string;
          status: string;
          nextStep: string;
        }>;
      }
    ).matches;
    expect(matches.some((entry) => entry.capability.id === capabilityId)).toBe(true);
    const hit = matches.find((entry) => entry.capability.id === capabilityId);
    expect(hit?.task).toBe("整理会议纪要");
    expect(hit?.status).toBe("can_use_now");

    const installed = await invoke("employee-capability.install-to-robot", {
      capabilityId,
      agentId: "robot-beta",
    });
    expect(installed.ok).toBe(true);

    const after = await invoke("employee-capability.can", {
      agentId: "robot-beta",
      intent: "会议纪要",
    });
    const afterMatches = (
      after.payload as { matches: Array<{ capability: { id: string }; status: string }> }
    ).matches;
    expect(afterMatches.find((entry) => entry.capability.id === capabilityId)?.status).toBe(
      "already_on_robot",
    );
  });

  it("mounts a reviewing MCP asset onto the chosen robot during install-to-robot", async () => {
    const saved = saveSkillAsset({
      ownerUserId: "alice@example.com",
      lifecycle: "reviewing",
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
    const installed = await invoke("employee-capability.install-to-robot", {
      capabilityId: saved.skillId,
      agentId: "robot-secretary",
    });
    expect(installed).toMatchObject({
      ok: true,
      payload: { capabilityId: saved.skillId, agentId: "robot-secretary", mounted: true },
    });
    const bindRoot = path.join(tmpDir, "skill-execution-bindings", "robot-secretary");
    const dirs = fs.existsSync(bindRoot) ? fs.readdirSync(bindRoot) : [];
    expect(dirs.some((name) => name.startsWith("ob-asset-"))).toBe(true);
    const skillFile = dirs
      .map((name) => path.join(bindRoot, name, "SKILL.md"))
      .find((file) => fs.existsSync(file));
    expect(skillFile).toBeTruthy();
    if (skillFile) {
      expect(fs.readFileSync(skillFile, "utf8")).toContain("Call advisor for 会前推演.");
    }
  });

  it("blocks installing a skill that still needs service setup", async () => {
    const { saveSkillAsset } = await import("../skill-lifecycle-store.js");
    saveSkillAsset({
      skillId: "openai-whisper-api",
      sourceAgentId: "robot-alpha",
      lifecycle: "published",
      profile: {
        name: "语音转写",
        summary: "把语音转成文字",
        visibility: "enterprise",
      },
    });
    const preflight = await invoke("employee-capability.preflight", {
      agentId: "robot-beta",
      capabilityId: "openai-whisper-api",
    });
    expect(preflight.ok).toBe(true);
    expectEmployeeOnly(preflight.payload);
    expect((preflight.payload as { status: string; canInstall: boolean }).status).toBe(
      "needs_setup",
    );
    expect((preflight.payload as { canInstall: boolean }).canInstall).toBe(false);

    const installed = await invoke("employee-capability.install-to-robot", {
      capabilityId: "openai-whisper-api",
      agentId: "robot-beta",
    });
    expect(installed.ok).toBe(false);
  });
});
