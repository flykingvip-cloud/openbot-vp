import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RuntimeAgent, RuntimeCapabilityBinding } from "../agent-runtime-store.js";
import type { GatewayRequestHandlerOptions } from "./types.js";

const tmpDir = path.join(os.tmpdir(), `openbot-capability-lifecycle-path-${Date.now()}`);

vi.mock("../../utils.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../utils.js")>();
  return {
    ...actual,
    CONFIG_DIR: tmpDir,
  };
});

const { skillLifecycleHandlers } = await import("./skill-lifecycle.js");
const { employeeCapabilityHandlers } = await import("./employee-capability.js");
const { enterpriseCapabilityHandlers } = await import("./enterprise-capability.js");
const { incubationHandlers } = await import("./incubation.js");
const { platformCapabilityHandlers } = await import("./platform-capability.js");
const { saveSkillAsset } = await import("../skill-lifecycle-store.js");
const { findProposalBySkillKey, findRegistryEntryBySkillKey, getRegistryEntry } =
  await import("../capability-governance-store.js");
const { listEnterpriseSubmissions, __capabilityInstallGovernanceStoreInternals } =
  await import("../capability-install-governance-store.js");
const { __agentRuntimeStoreInternals } = await import("../agent-runtime-store.js");

type HandlerResponse = {
  ok: boolean;
  payload?: unknown;
  error?: unknown;
};

function cleanStore() {
  fs.rmSync(tmpDir, { recursive: true, force: true });
  fs.mkdirSync(tmpDir, { recursive: true });
  __agentRuntimeStoreInternals.reset();
  __capabilityInstallGovernanceStoreInternals.reset();
}

async function invoke(
  handlers: Record<string, (opts: GatewayRequestHandlerOptions) => unknown>,
  method: string,
  params: Record<string, unknown> = {},
  userEmail = "alice@example.com",
): Promise<HandlerResponse> {
  const handler = handlers[method];
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

function seedReuse(capabilityId: string, robots: number, calls7d: number) {
  const agents: Record<string, RuntimeAgent> = {};
  const bindings: Record<string, RuntimeCapabilityBinding> = {};
  for (let index = 0; index < robots; index += 1) {
    const runtimeAgentId = `robot-${index + 1}`;
    agents[runtimeAgentId] = {
      runtimeAgentId,
      name: `Robot ${index + 1}`,
      runtimeVersion: "1.0.0",
      lifecycle: "deployed",
      health: "healthy",
      tenantCoverage: ["tenant-a"],
      boundCapabilityCount: 1,
      activeSessionCount: 1,
      resourceUsage: { cpuPercent: 10, memoryPercent: 10, tokenBudgetUsedPercent: 10 },
      deployedAt: Date.now(),
      lastActiveAt: Date.now(),
    };
    bindings[`binding-${index + 1}`] = {
      bindingId: `binding-${index + 1}`,
      runtimeAgentId,
      capabilityId,
      capabilityVersion: "1.0.0",
      bindingType: "tenant-installed",
      routingPriority: 50,
      loadStrategy: "eager",
      bindingState: "active",
      healthStatus: "healthy",
      invocationMetrics: {
        calls7d,
        successRate7d: 0.95,
        avgLatencyMs: 200,
        p95LatencyMs: 400,
        errorCount7d: 0,
        tokenConsumption7d: 100,
      },
      policy: { sandbox: "strict", resourceQuota: "small", hotReloadable: true },
      fallbackBindingId: null,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
  }
  __agentRuntimeStoreInternals.seed({ agents, bindings });
}

describe("capability lifecycle path convergence", () => {
  beforeEach(cleanStore);
  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("submits, reviews, lists, incubates only with reuse data, then reports to platform", async () => {
    const saved = saveSkillAsset({
      skillId: "sales-retro",
      ownerUserId: "alice@example.com",
      lifecycle: "private",
      profile: {
        name: "销售复盘助手",
        summary: "整理客户进展、风险和下一步动作",
        assetType: "capability",
        visibility: "private",
        usageExamples: ["周会前复盘本周商机"],
        inputDescription: "客户进展与风险笔记",
        outputDescription: "结构化复盘纪要",
      },
    });

    const submitted = await invoke(skillLifecycleHandlers, "personal-skills.submit", {
      skillId: saved.skillId,
    });
    expect(submitted.ok).toBe(true);
    expect(submitted.payload).toMatchObject({
      capabilityId: "sales-retro",
      shareVisibility: "审核中",
    });
    expect(findProposalBySkillKey("sales-retro")?.status).toBe("proposed");

    const proposalId = findProposalBySkillKey("sales-retro")!.proposalId;
    const reviewed = await invoke(enterpriseCapabilityHandlers, "enterprise-capability.review", {
      reviewTaskId: proposalId,
      result: "通过",
      opinion: "可进入销售团队复用",
      approval: {
        domain: "销售",
        applicableScope: { kind: "enterprise" },
      },
    });
    expect(reviewed.ok).toBe(true);

    const justApprovedPool = await invoke(incubationHandlers, "incubation.candidate-pool");
    expect((justApprovedPool.payload as { candidates: unknown[] }).candidates).toEqual([]);

    const listed = await invoke(enterpriseCapabilityHandlers, "enterprise-capability.list", {
      filters: {
        searchQuery: "销售复盘助手",
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
    const listItems = (listed.payload as { items: Array<{ name: string; id: string }> }).items;
    expect(listItems.some((item) => item.name === "销售复盘助手")).toBe(true);
    const capabilityId = listItems.find((item) => item.name === "销售复盘助手")!.id;

    seedReuse(capabilityId, 1, 40);
    const emptyPool = await invoke(incubationHandlers, "incubation.candidate-pool");
    expect((emptyPool.payload as { candidates: unknown[] }).candidates).toEqual([]);

    seedReuse(capabilityId, 2, 40);
    const readyPool = await invoke(incubationHandlers, "incubation.candidate-pool");
    const candidates = (
      readyPool.payload as { candidates: Array<{ capabilityId: string; maturity: string }> }
    ).candidates;
    expect(candidates).toEqual(
      expect.arrayContaining([expect.objectContaining({ capabilityId, maturity: "企业认证" })]),
    );

    const preview = await invoke(
      enterpriseCapabilityHandlers,
      "enterprise-capability.sanitization-preview",
      { capabilityId },
    );
    expect(preview.ok).toBe(true);
    const findings = (preview.payload as { findings: Array<{ id: string }> }).findings;
    const confirm = await invoke(
      enterpriseCapabilityHandlers,
      "enterprise-capability.sanitization-confirm",
      {
        capabilityId,
        replacements: findings.map((finding) => ({
          findingId: finding.id,
          replacement: "[REDACTED]",
          replacementType: "redact",
        })),
      },
    );
    expect(confirm.ok).toBe(true);

    const uploaded = await invoke(
      enterpriseCapabilityHandlers,
      "enterprise-capability.submit-to-platform",
      {
        capabilityId,
        capabilityName: "销售复盘助手",
        enterpriseId: "tenant-a",
        enterpriseName: "Tenant A",
      },
    );
    expect(uploaded.ok).toBe(true);
    const submissionId = (uploaded.payload as { submissionId: string }).submissionId;

    const pending = await invoke(
      platformCapabilityHandlers,
      "platform-capability.enterprise-submissions",
      { status: "pending-review" },
    );
    expect(
      (pending.payload as { submissions: Array<{ submissionId: string }> }).submissions,
    ).toEqual(expect.arrayContaining([expect.objectContaining({ submissionId })]));

    const published = await invoke(
      platformCapabilityHandlers,
      "platform-capability.publish-enterprise-capability",
      { submissionId, reviewerId: "platform-admin" },
    );
    expect(published.ok).toBe(true);
    const publishedScope = getRegistryEntry(capabilityId)?.distribution.scope;
    expect(publishedScope?.tenantIds).toHaveLength(1);
    expect(publishedScope?.tenantIds?.[0]).toBeTruthy();

    const afterPublish = await invoke(incubationHandlers, "incubation.candidate-pool");
    expect(
      (afterPublish.payload as { stats: { platformApprovedCount: number } }).stats
        .platformApprovedCount,
    ).toBeGreaterThan(0);
  });

  it("routes leftover submit RPCs through the same enterprise proposal write", async () => {
    const employeeSaved = saveSkillAsset({
      skillId: "alias-employee",
      ownerUserId: "alice@example.com",
      lifecycle: "private",
      profile: {
        name: "员工提交别名",
        summary: "验证员工入口与生命周期入口写同一提案",
        assetType: "capability",
        visibility: "private",
        usageExamples: ["提交企业审核"],
      },
    });
    const employee = await invoke(
      employeeCapabilityHandlers,
      "employee-capability.submit-to-enterprise",
      { capabilityId: employeeSaved.skillId },
    );
    expect(employee.ok, JSON.stringify(employee.error)).toBe(true);
    expect(findProposalBySkillKey("alias-employee")?.status).toBe("proposed");

    const reviewSaved = saveSkillAsset({
      skillId: "alias-review",
      ownerUserId: "alice@example.com",
      lifecycle: "private",
      profile: {
        name: "审核提交别名",
        summary: "验证 skill-review.submit 写同一提案库",
        assetType: "capability",
        visibility: "private",
        usageExamples: ["提交企业审核"],
      },
    });
    const review = await invoke(skillLifecycleHandlers, "skill-review.submit", {
      skillId: reviewSaved.skillId,
    });
    expect(review.ok, JSON.stringify(review.error)).toBe(true);
    expect(findProposalBySkillKey("alias-review")?.status).toBe("proposed");
  });

  it("does not treat review-time promoteToIncubation as candidate-pool admission", async () => {
    const saved = saveSkillAsset({
      skillId: "flagged-but-unused",
      ownerUserId: "alice@example.com",
      lifecycle: "private",
      profile: {
        name: "仅标记上报意向",
        summary: "审核勾选上报意向不得绕过复用门槛",
        assetType: "capability",
        visibility: "private",
        usageExamples: ["审核标记"],
      },
    });
    const submitted = await invoke(skillLifecycleHandlers, "personal-skills.submit", {
      skillId: saved.skillId,
    });
    expect(submitted.ok).toBe(true);
    const reviewed = await invoke(enterpriseCapabilityHandlers, "enterprise-capability.review", {
      reviewTaskId: findProposalBySkillKey("flagged-but-unused")!.proposalId,
      result: "通过",
      opinion: "可进企业库，但没有复用数据",
      approval: {
        domain: "销售",
        applicableScope: { kind: "enterprise" },
        promoteToIncubation: true,
      },
    });
    expect(reviewed.ok).toBe(true);
    expect(
      findRegistryEntryBySkillKey("flagged-but-unused")?.manifest.enterpriseAssetPackage,
    ).toMatchObject({
      promotionIntent: "platform_candidate",
    });
    const pool = await invoke(incubationHandlers, "incubation.candidate-pool");
    expect((pool.payload as { candidates: unknown[] }).candidates).toEqual([]);
  });

  it("keeps incubation.decide off the platform submission write", async () => {
    const decided = await invoke(incubationHandlers, "incubation.decide", {
      capabilityId: "cap-decision-only",
      result: "recommend_upload",
      reason: "这是孵化决策记录，不能写成平台提交",
    });
    expect(decided.ok, JSON.stringify(decided.error)).toBe(true);
    expect(listEnterpriseSubmissions()).toEqual([]);
  });
});
