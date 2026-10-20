import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const tmpDir = path.join(os.tmpdir(), `openbot-skill-assets-${Date.now()}`);
vi.mock("../utils.js", () => ({ CONFIG_DIR: tmpDir }));

const {
  assessRuntimeDependencyImpact,
  diffSkillVersions,
  editPersonalSkillAsset,
  getRuntimeDependencyGraph,
  getPersonalSkillAssetDetail,
  getSkillRuntimeDefinitionForBinding,
  includeInEnterprisePublicCatalog,
  installSkillToRobotAsset,
  listSkillRecommendations,
  listSkillVersionHistory,
  listPersonalSkillAssets,
  listRobotSkillAssets,
  planSkillMigration,
  queryRuntimeDependencyTopology,
  recordSkillHealthTelemetry,
  registerEnterpriseSkillConsumer,
  removeRobotSkillAsset,
  restoreRobotSkillInstallation,
  restoreSkillLifecycleState,
  rollbackSkillVersion,
  saveSkillAsset,
  suggestSkillHealthRepair,
  sharePersonalSkillToGroup,
  publishSkillReview,
  submitPersonalSkillToEnterprise,
  toggleRobotSkillAsset,
} = await import("./skill-lifecycle-store.js");

const runtimeKeys = new Set([
  "runtimeDefinition",
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
]);

function containsRuntimeField(value: unknown): boolean {
  if (Array.isArray(value)) {
    return value.some(containsRuntimeField);
  }
  if (!value || typeof value !== "object") {
    return false;
  }
  return Object.entries(value).some(
    ([key, nested]) => runtimeKeys.has(key) || containsRuntimeField(nested),
  );
}

function cleanStore() {
  fs.rmSync(path.join(tmpDir, "skill-assets"), { recursive: true, force: true });
  fs.mkdirSync(tmpDir, { recursive: true });
}

function saveExampleSkill() {
  return saveSkillAsset({
    sourceAgentId: "robot-alpha",
    lifecycle: "private",
    contextId: "customer-summary",
    profile: {
      name: "Customer summary",
      summary: "Summarizes customer conversations into a short brief.",
      assetType: "capability",
      tags: ["summary"],
      category: "writing",
      visibility: "private",
    },
    runtimeDefinition: {
      prompts: ["internal prompt"],
      tools: ["notes"],
      modelPreferences: { hidden: true },
    },
  });
}

describe("skill-lifecycle-store", () => {
  beforeEach(cleanStore);

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("keeps a private draft out of enterprise recommendations", () => {
    const draft = saveSkillAsset({
      sourceAgentId: "robot-alpha",
      lifecycle: "draft",
      profile: {
        name: "私人草稿",
        summary: "还没提交",
        assetType: "capability",
        visibility: "private",
      },
    });
    const published = saveSkillAsset({
      sourceAgentId: "robot-beta",
      lifecycle: "published",
      profile: {
        name: "企业技能",
        summary: "已发布",
        assetType: "capability",
        visibility: "enterprise",
      },
    });
    expect(includeInEnterprisePublicCatalog({ lifecycle: "draft", visibility: "private" })).toBe(
      false,
    );
    const recommended = listSkillRecommendations("robot-gamma").map((entry) => entry.skillId);
    expect(recommended).not.toContain(draft.skillId);
    expect(recommended).toContain(published.skillId);
  });

  it("filters personal skill assets by ownerUserId when requested", () => {
    saveSkillAsset({
      ownerUserId: "user-a",
      lifecycle: "private",
      profile: {
        name: "A note",
        summary: "owned by a",
        assetType: "knowledge",
        tags: ["知识"],
        category: "知识收录",
        visibility: "private",
      },
    });
    saveSkillAsset({
      ownerUserId: "user-b",
      lifecycle: "private",
      profile: {
        name: "B note",
        summary: "owned by b",
        assetType: "knowledge",
        tags: ["知识"],
        category: "知识收录",
        visibility: "private",
      },
    });
    saveSkillAsset({
      ownerUserId: null,
      lifecycle: "private",
      profile: {
        name: "Legacy note",
        summary: "unowned legacy",
        assetType: "knowledge",
        tags: ["知识"],
        category: "知识收录",
        visibility: "private",
      },
    });

    expect(listPersonalSkillAssets()).toHaveLength(3);
    expect(
      listPersonalSkillAssets({ ownerUserId: "user-a" }).map((item) => item.profile.name),
    ).toEqual(["A note"]);
    expect(
      listPersonalSkillAssets({ ownerUserId: "user-b" }).map((item) => item.profile.name),
    ).toEqual(["B note"]);
  });

  it("saves a private skill, creates the source robot relation, and hides runtime fields", () => {
    const saved = saveExampleSkill();

    expect(saved.skillId).toMatch(/^skill_/);
    expect(listPersonalSkillAssets()).toHaveLength(1);

    const robotSkills = listRobotSkillAssets("robot-alpha");
    expect(robotSkills).toHaveLength(1);
    expect(robotSkills[0].enabled).toBe(true);
    expect(robotSkills[0].installedVersion).toBe("1.0.0");

    const detail = getPersonalSkillAssetDetail(saved.skillId);
    expect(detail.profile.name).toBe("Customer summary");
    expect(detail.versions).toHaveLength(1);
    expect(containsRuntimeField(detail)).toBe(false);
  });

  it("edits a skill by creating a new visible version while preserving version history", () => {
    const saved = saveExampleSkill();
    const detail = editPersonalSkillAsset({
      skillId: saved.skillId,
      summary: "Tightened summary",
      profile: {
        ...saved.detail.profile,
        summary: "Creates a decision-ready customer brief.",
      },
    });

    expect(detail.profile.summary).toBe("Creates a decision-ready customer brief.");
    expect(detail.versions.map((entry) => entry.version)).toEqual(["1.0.0", "1.0.1"]);
    expect(detail.versions[0].profile.summary).toBe(
      "Summarizes customer conversations into a short brief.",
    );
  });

  it("supports platform version diff, rollback, and migration planning", () => {
    const saved = saveExampleSkill();
    const edited = editPersonalSkillAsset({
      skillId: saved.skillId,
      summary: "最近更新 · 优化了客户摘要说明",
      profile: {
        ...saved.detail.profile,
        summary: "Creates a decision-ready customer brief.",
        tags: ["summary", "customer"],
      },
    });

    const history = listSkillVersionHistory(saved.skillId);
    expect(history.map((entry) => entry.version)).toEqual(["1.0.0", "1.0.1"]);

    const diff = diffSkillVersions({
      skillId: saved.skillId,
      fromVersion: "1.0.0",
      toVersion: edited.versions.at(-1)?.version ?? "",
    });
    expect(diff.changedFields.map((entry) => entry.field).toSorted()).toEqual(["summary", "tags"]);

    installSkillToRobotAsset({ agentId: "robot-beta", skillId: saved.skillId });
    registerEnterpriseSkillConsumer({
      skillId: saved.skillId,
      consumerId: "consumer-csm",
      name: "Customer Success",
      type: "department",
    });
    const migration = planSkillMigration({ skillId: saved.skillId, targetVersion: "1.0.2" });
    expect(migration.planSteps).toContain("确认影响范围");
    expect(migration.impact.requiresMigrationPlan).toBe(true);

    const result = rollbackSkillVersion({
      skillId: saved.skillId,
      targetVersion: "1.0.0",
    });
    expect(result.rollback).toMatchObject({
      rolledBackFrom: "1.0.1",
      rolledBackTo: "1.0.0",
      newVersion: "1.0.2",
    });
    expect(result.detail.profile.summary).toBe(
      "Summarizes customer conversations into a short brief.",
    );
    expect(result.detail.versions.at(-1)?.summary).toBe("最近更新 · 恢复了较早的能力说明");

    const pinned = listRobotSkillAssets("robot-beta").find((entry) => entry.id === saved.skillId);
    expect(pinned?.installedVersion).toBe(result.rollback.newVersion);
  });

  it("supports group sharing and enterprise review submission", () => {
    const saved = saveExampleSkill();

    const shared = sharePersonalSkillToGroup({ skillId: saved.skillId, groupId: "sales" });
    expect(shared.lifecycle).toBe("published");
    expect(shared.profile.visibility).toBe("group");
    expect(shared.dependencyGraph.sharedGroups).toEqual([{ groupId: "sales", name: "sales" }]);

    const submitted = submitPersonalSkillToEnterprise(saved.skillId);
    expect(submitted.lifecycle).toBe("reviewing");
    expect(submitted.profile.visibility).toBe("enterprise");
  });

  it("publishes an approved personal skill as enterprise-visible", () => {
    const saved = saveExampleSkill();
    submitPersonalSkillToEnterprise(saved.skillId);
    installSkillToRobotAsset({ agentId: "robot-beta", skillId: saved.skillId });

    const published = publishSkillReview({
      skillId: saved.skillId,
      scope: { kind: "enterprise" },
    });

    expect(published.lifecycle).toBe("published");
    expect(published.profile.visibility).toBe("enterprise");
    expect(listRobotSkillAssets("robot-beta")).toHaveLength(1);
  });

  it("manages robot skill installation without deleting the skill asset", () => {
    const saved = saveExampleSkill();

    installSkillToRobotAsset({ agentId: "robot-beta", skillId: saved.skillId });
    expect(listRobotSkillAssets("robot-beta")).toHaveLength(1);

    const toggled = toggleRobotSkillAsset({
      agentId: "robot-beta",
      skillId: saved.skillId,
      enabled: false,
    });
    expect(toggled.enabled).toBe(false);

    removeRobotSkillAsset({ agentId: "robot-beta", skillId: saved.skillId });
    expect(listRobotSkillAssets("robot-beta")).toEqual([]);
    expect(getPersonalSkillAssetDetail(saved.skillId).id).toBe(saved.skillId);
  });

  it("restores lifecycle and a single robot installation without rewriting skill body", () => {
    const saved = saveExampleSkill();
    const originalSummary = saved.detail.profile.summary;
    installSkillToRobotAsset({ agentId: "robot-beta", skillId: saved.skillId });
    const published = restoreSkillLifecycleState(saved.skillId, "published");
    expect(published.lifecycle).toBe("published");
    expect(published.profile.summary).toBe(originalSummary);
    restoreRobotSkillInstallation({
      agentId: "robot-beta",
      skillId: saved.skillId,
      installed: false,
    });
    expect(listRobotSkillAssets("robot-beta")).toEqual([]);
    expect(getPersonalSkillAssetDetail(saved.skillId).profile.summary).toBe(originalSummary);
  });

  it("builds complete runtime dependency graph and impact summary", () => {
    const base = saveExampleSkill();
    const dependent = saveSkillAsset({
      sourceAgentId: "robot-beta",
      contextId: "customer-followup",
      profile: {
        name: "Customer followup",
        summary: "Creates followup actions from a customer brief.",
        tags: ["followup"],
        category: "writing",
        visibility: "private",
      },
      runtimeDefinition: {
        dependencies: [base.skillId],
      },
    });

    installSkillToRobotAsset({ agentId: "robot-gamma", skillId: base.skillId });
    sharePersonalSkillToGroup({ skillId: base.skillId, groupId: "sales" });
    registerEnterpriseSkillConsumer({
      skillId: base.skillId,
      consumerId: "consumer-csm",
      name: "Customer Success",
      type: "department",
    });

    const graph = getRuntimeDependencyGraph(base.skillId);
    expect(graph.installedRobots.map((robot) => robot.agentId).toSorted()).toEqual([
      "robot-alpha",
      "robot-gamma",
    ]);
    expect(graph.sharedGroups).toEqual([{ groupId: "sales", name: "sales" }]);
    expect(graph.dependentSkills).toEqual([
      { skillId: dependent.skillId, name: "Customer followup" },
    ]);
    expect(graph.enterpriseConsumers).toEqual([
      { consumerId: "consumer-csm", name: "Customer Success", type: "department" },
    ]);

    const impact = assessRuntimeDependencyImpact(base.skillId);
    expect(impact).toMatchObject({
      skillId: base.skillId,
      installedRobotCount: 2,
      sharedGroupCount: 1,
      dependentSkillCount: 1,
      enterpriseConsumerCount: 1,
      requiresMigrationPlan: true,
    });
    expect(impact.impactSummary).toContain("影响 5 个对象");
  });

  it("queries cross-skill runtime topology for platform governance", () => {
    const base = saveExampleSkill();
    installSkillToRobotAsset({ agentId: "robot-alpha", skillId: base.skillId });
    const dependent = saveSkillAsset({
      sourceAgentId: "robot-beta",
      profile: {
        name: "Customer handoff",
        summary: "Builds handoff notes from a customer brief.",
        tags: ["handoff"],
        category: "writing",
        visibility: "group",
      },
      runtimeDefinition: {
        dependencies: [base.skillId],
      },
      targetGroupId: "success",
      enterpriseConsumers: [{ consumerId: "consumer-ops", name: "Operations", type: "department" }],
    });

    const topology = queryRuntimeDependencyTopology({ skillId: base.skillId });

    expect(topology.nodes.map((node) => node.id)).toEqual(
      expect.arrayContaining([base.skillId, dependent.skillId, "robot-alpha"]),
    );
    expect(topology.edges).toEqual(
      expect.arrayContaining([
        { from: base.skillId, to: "robot-alpha", type: "installed_on" },
        { from: dependent.skillId, to: base.skillId, type: "depends_on" },
      ]),
    );
    expect(topology.impacts[0]?.requiresMigrationPlan).toBe(true);
  });

  it("generates employee-language health repair suggestions and recovers after stable telemetry", () => {
    const saved = saveExampleSkill();

    const warning = recordSkillHealthTelemetry({
      skillId: saved.skillId,
      successRate: 0.72,
      failureReasons: ["input format mismatch", "scenario ambiguous"],
    });
    expect(warning.health.status).toBe("warning");

    const suggestions = suggestSkillHealthRepair(saved.skillId);
    expect(suggestions).toEqual({
      skillId: saved.skillId,
      healthStatus: "warning",
      suggestions: ["建议更换输入方式", "建议调整使用场景"],
    });
    expect(JSON.stringify(suggestions)).not.toContain("input format mismatch");

    const recovered = recordSkillHealthTelemetry({
      skillId: saved.skillId,
      successRate: 0.99,
      failureReasons: [],
    });
    expect(recovered.health.status).toBe("healthy");
    expect(suggestSkillHealthRepair(saved.skillId).suggestions).toEqual([]);
  });
});

describe("skill share attribution", () => {
  it("records share attribution when sharing to group", async () => {
    const saved = saveExampleSkill();
    const sharedBy = {
      userId: "user@example.com",
      agentId: "agent-123",
      displayName: "张三",
    };

    const shared = sharePersonalSkillToGroup({
      skillId: saved.skillId,
      groupId: "sales-team",
      sharedBy,
    });

    expect(shared.lifecycle).toBe("published");
    expect(shared.profile.visibility).toBe("group");

    // 验证归因记录存在
    const { listGroupSharedSkills, getSkillShareAttributions } =
      await import("./skill-lifecycle-store.js");
    const groupSkills = listGroupSharedSkills("sales-team");
    expect(groupSkills).toHaveLength(1);
    expect(groupSkills[0].shareAttribution).toMatchObject({
      skillId: saved.skillId,
      groupId: "sales-team",
      sharedBy: {
        userId: "user@example.com",
        agentId: "agent-123",
        displayName: "张三",
      },
    });
    expect(groupSkills[0].shareAttribution?.sharedAt).toBeGreaterThan(0);

    const attributions = getSkillShareAttributions(saved.skillId);
    expect(attributions).toHaveLength(1);
    expect(attributions[0]).toMatchObject({
      skillId: saved.skillId,
      groupId: "sales-team",
      sharedBy: sharedBy,
    });
  });

  it("records multiple share attributions for the same skill to different groups", async () => {
    const saved = saveExampleSkill();

    sharePersonalSkillToGroup({
      skillId: saved.skillId,
      groupId: "group-a",
      sharedBy: { displayName: "用户A" },
    });

    sharePersonalSkillToGroup({
      skillId: saved.skillId,
      groupId: "group-b",
      sharedBy: { displayName: "用户B" },
    });

    const { getSkillShareAttributions } = await import("./skill-lifecycle-store.js");
    const attributions = getSkillShareAttributions(saved.skillId);
    expect(attributions).toHaveLength(2);
    expect(attributions.map((a) => a.groupId).toSorted()).toEqual(["group-a", "group-b"]);
  });

  it("uses default displayName when sharedBy is not provided", async () => {
    const saved = saveExampleSkill();

    sharePersonalSkillToGroup({
      skillId: saved.skillId,
      groupId: "test-group",
    });

    const { getSkillShareAttributions } = await import("./skill-lifecycle-store.js");
    const attributions = getSkillShareAttributions(saved.skillId);
    expect(attributions).toHaveLength(1);
    expect(attributions[0].sharedBy.displayName).toBe("未知分享者");
  });

  it("listGroupSharedSkills returns empty for non-existent group", async () => {
    const { listGroupSharedSkills } = await import("./skill-lifecycle-store.js");
    const skills = listGroupSharedSkills("non-existent-group");
    expect(skills).toEqual([]);
  });

  it("listGroupSharedSkills only returns skills shared to that specific group", async () => {
    const skill1 = saveExampleSkill();
    const skill2 = saveSkillAsset({
      sourceAgentId: "bot-2",
      profile: { name: "技能2", summary: "第二个技能" },
    });

    sharePersonalSkillToGroup({ skillId: skill1.skillId, groupId: "group-x" });
    sharePersonalSkillToGroup({ skillId: skill2.skillId, groupId: "group-y" });

    const { listGroupSharedSkills } = await import("./skill-lifecycle-store.js");
    const groupXSkills = listGroupSharedSkills("group-x");
    const groupYSkills = listGroupSharedSkills("group-y");

    expect(groupXSkills).toHaveLength(1);
    expect(groupXSkills[0].id).toBe(skill1.skillId);
    expect(groupYSkills).toHaveLength(1);
    expect(groupYSkills[0].id).toBe(skill2.skillId);
  });

  it("infers capability verbs onto runtime without leaking them to employee projections", () => {
    const saved = saveSkillAsset({
      sourceAgentId: "robot-notes",
      lifecycle: "private",
      profile: {
        name: "会议纪要专家",
        summary: "把讨论整理成会议纪要",
        visibility: "private",
      },
    });
    const runtime = getSkillRuntimeDefinitionForBinding(saved.skillId);
    expect(runtime.runtimeDefinition.capabilities).toContain("meeting.notes");
    const listed = listPersonalSkillAssets();
    expect(containsRuntimeField(listed)).toBe(false);
    expect(JSON.stringify(listed)).not.toContain("meeting.notes");
  });

  it("auto-classifies organizable assets from name and summary", () => {
    const tool = saveSkillAsset({
      sourceAgentId: "robot-alpha",
      lifecycle: "private",
      profile: {
        name: "网页检索",
        summary: "搜索公开网页并整理结果",
        visibility: "private",
      },
    });
    const mcp = saveSkillAsset({
      sourceAgentId: "robot-alpha",
      lifecycle: "private",
      profile: {
        name: "Linear",
        summary: "通过 https://mcp.linear.app 查询任务",
        visibility: "private",
      },
    });

    const toolRuntime = getSkillRuntimeDefinitionForBinding(tool.skillId);
    expect(toolRuntime.profile.assetType).toBe("tool");
    expect(toolRuntime.runtimeDefinition.toolBinding).toEqual({ toolIds: ["web_search"] });

    const mcpRuntime = getSkillRuntimeDefinitionForBinding(mcp.skillId);
    expect(mcpRuntime.profile.assetType).toBe("mcp");
    expect(mcpRuntime.runtimeDefinition.mcpBinding).toMatchObject({
      serverName: "linear",
      url: "https://mcp.linear.app",
    });
  });

  it("persists first-class tool and MCP bindings on the runtime contract", () => {
    const tool = saveSkillAsset({
      sourceAgentId: "robot-alpha",
      lifecycle: "private",
      profile: {
        name: "网页检索",
        summary: "搜索公开网页",
        assetType: "tool",
        visibility: "private",
      },
      runtimeDefinition: {
        toolBinding: { toolIds: ["web_search"] },
      },
    });
    const mcp = saveSkillAsset({
      sourceAgentId: "robot-alpha",
      lifecycle: "private",
      profile: {
        name: "Linear",
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

    const toolRuntime = getSkillRuntimeDefinitionForBinding(tool.skillId);
    expect(toolRuntime.profile.assetType).toBe("tool");
    expect(toolRuntime.runtimeDefinition.toolBinding).toEqual({ toolIds: ["web_search"] });
    expect(toolRuntime.runtimeDefinition.tools).toEqual(["web_search"]);

    const mcpRuntime = getSkillRuntimeDefinitionForBinding(mcp.skillId);
    expect(mcpRuntime.profile.assetType).toBe("mcp");
    expect(mcpRuntime.runtimeDefinition.mcpBinding).toMatchObject({
      serverName: "linear",
      url: "https://mcp.linear.app",
    });
    expect(listPersonalSkillAssets().map((entry) => entry.profile.assetType)).toEqual(
      expect.arrayContaining(["tool", "mcp"]),
    );
  });

  it("attaches a source-robot relation for draft quick-saves", () => {
    const saved = saveSkillAsset({
      sourceAgentId: "robot-alpha",
      profile: { name: "客户沟通整理", summary: "把客户对话整理为清晰摘要" },
    });
    expect(getPersonalSkillAssetDetail(saved.skillId).lifecycle).toBe("draft");
    expect(listRobotSkillAssets("robot-alpha").map((entry) => entry.id)).toContain(saved.skillId);
  });
});
