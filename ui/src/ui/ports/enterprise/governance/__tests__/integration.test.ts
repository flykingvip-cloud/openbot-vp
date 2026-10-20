import { describe, expect, it } from "vitest";
import type { GovernanceAgentInput } from "../governance-engine.ts";
import {
  resolveOwnershipOnCreate,
  transferOwnershipOnPositionChange,
  detectGovernanceIssues,
  createGovernanceActionExecutor,
  removeFromQueue,
  buildCriticalNotification,
  shouldEscalate,
} from "../index.ts";
import type { OwnedAsset } from "../ownership-service.ts";
import { DEFAULT_GOVERNANCE_CONFIG } from "../types.ts";

const NOW = new Date("2026-05-17T12:00:00.000Z").getTime();

describe("Mesh Governance End-to-End Integration", () => {
  it("Test 1: 创建机器人 → ownership 自动填充 → 不出现待补创建人治理项", () => {
    // Step 1: 岗位人员创建机器人
    const ownership = resolveOwnershipOnCreate({
      operatorUserId: "alice@example.com",
      operatorUserLabel: "Alice",
      operatorPositionId: "pos-eng-lead",
      operatorPositionLabel: "Engineering Lead",
    });

    expect(ownership.positionId).toBe("pos-eng-lead");
    expect(ownership.createdByUserId).toBe("alice@example.com");
    expect(ownership.currentManagerUserId).toBe("alice@example.com");

    // Step 2: 治理引擎检测 — 不应出现 missing_owner 问题
    const agent: GovernanceAgentInput = {
      agentId: "new-bot",
      name: "New Bot",
      ownership,
      status: "online",
      consecutiveErrors: 0,
      offlineHours: 0,
      hasActiveSessions: false,
      errorRate7d: 0,
      successRate7d: 1,
      previousSuccessRate7d: 1,
      dailyCost: 0,
      avgDailyCost7d: 0,
      monthlyCost: 0,
      budgetLimit: null,
      costPerSession: 0,
      peerAvgCostPerSession: 0,
      lastSessionAt: NOW - 1000 * 60 * 60,
      deployedAt: NOW - 1000 * 60 * 60 * 24,
      sessionCount7d: 5,
      hasSensitiveContentViolation: false,
      hasPermissionViolation: false,
    };

    const issues = detectGovernanceIssues([agent], [], DEFAULT_GOVERNANCE_CONFIG, NOW);

    // 关键断言：新创建的机器人不会出现治理问题
    expect(issues).toHaveLength(0);
    for (const issue of issues) {
      expect(issue.category).not.toBe("missing_owner");
      expect(issue.category).not.toBe("missing_attribution");
    }
  });

  it("Test 2: 岗位人员变动 → 所有对象 currentManagerUserId 自动更新", () => {
    // Step 1: 初始状态 — Alice 在 Engineering 岗位创建多个对象
    const aliceOwnership = resolveOwnershipOnCreate({
      operatorUserId: "alice@example.com",
      operatorUserLabel: "Alice",
      operatorPositionId: "pos-eng",
      operatorPositionLabel: "Engineering",
    });

    const assets: OwnedAsset[] = [
      { id: "agent-1", kind: "agent", ownership: { ...aliceOwnership } },
      { id: "agent-2", kind: "agent", ownership: { ...aliceOwnership } },
      { id: "group-1", kind: "group", ownership: { ...aliceOwnership } },
    ];

    // Step 2: 岗位人员变动 — Alice 离职，Bob 接任
    const result = transferOwnershipOnPositionChange(
      {
        positionId: "pos-eng",
        previousUserId: "alice@example.com",
        newUserId: "bob@example.com",
        newUserLabel: "Bob",
      },
      assets,
    );

    // Step 3: 验证管理权已转移
    expect(result.updatedAssets).toHaveLength(3);
    for (const asset of result.updatedAssets) {
      expect(asset.ownership.currentManagerUserId).toBe("bob@example.com");
      expect(asset.ownership.currentManagerLabel).toBe("Bob");
      // 历史记录保留
      expect(asset.ownership.createdByUserId).toBe("alice@example.com");
      expect(asset.ownership.createdByUserLabel).toBe("Alice");
    }

    // Step 4: 验证变动日志
    expect(result.transferLog.affectedAgentCount).toBe(2);
    expect(result.transferLog.affectedGroupCount).toBe(1);
  });

  it("Test 3: 触发成本突增 → 生成 Critical 治理项 → 执行暂停 → 队列移除 + 审计日志", async () => {
    // Step 1: 机器人成本突增（单日 100，7 日均值 20，超出 5x）
    const ownership = resolveOwnershipOnCreate({
      operatorUserId: "alice@example.com",
      operatorUserLabel: "Alice",
      operatorPositionId: "pos-eng",
      operatorPositionLabel: "Engineering",
    });

    const agent: GovernanceAgentInput = {
      agentId: "spike-bot",
      name: "Spike Bot",
      ownership,
      status: "online",
      consecutiveErrors: 0,
      offlineHours: 0,
      hasActiveSessions: true,
      errorRate7d: 0.05,
      successRate7d: 0.95,
      previousSuccessRate7d: 0.95,
      dailyCost: 100,
      avgDailyCost7d: 20,
      monthlyCost: 500,
      budgetLimit: null,
      costPerSession: 1,
      peerAvgCostPerSession: 0.5,
      lastSessionAt: NOW - 1000 * 60,
      deployedAt: NOW - 1000 * 60 * 60 * 24 * 60,
      sessionCount7d: 100,
      hasSensitiveContentViolation: false,
      hasPermissionViolation: false,
    };

    // Step 2: 治理引擎检测出 cost_spike
    const issues = detectGovernanceIssues([agent], [], DEFAULT_GOVERNANCE_CONFIG, NOW);
    const spikeIssue = issues.find((i) => i.category === "cost_spike");
    expect(spikeIssue).toBeDefined();
    expect(spikeIssue!.level).toBe("critical");
    expect(spikeIssue!.id).toBe("cost_spike:agent:spike-bot");

    // Step 3: 管理员执行暂停动作
    let targetPaused = false;
    const executor = createGovernanceActionExecutor(async (params) => {
      if (params.actionType === "pause") {
        targetPaused = true;
        return { ok: true };
      }
      return { ok: false, error: "未支持的动作" };
    });

    const result = await executor.execute({
      issueId: spikeIssue!.id,
      actionType: "pause",
      targetId: spikeIssue!.target.id,
      targetKind: spikeIssue!.target.kind,
      operatorUserId: "admin@example.com",
      operatorPositionId: "pos-admin",
      reason: "成本突增 5 倍",
    });

    // Step 4: 验证执行成功
    expect(result.ok).toBe(true);
    expect(targetPaused).toBe(true);

    // Step 5: 验证队列移除
    const newQueue = removeFromQueue(issues, spikeIssue!.id);
    expect(newQueue.find((i) => i.id === spikeIssue!.id)).toBeUndefined();

    // Step 6: 验证审计日志
    const auditLog = executor.getAuditLog();
    expect(auditLog).toHaveLength(1);
    expect(auditLog[0].actionType).toBe("pause");
    expect(auditLog[0].targetId).toBe("spike-bot");
    expect(auditLog[0].operatorUserId).toBe("admin@example.com");
    expect(auditLog[0].reason).toBe("成本突增 5 倍");
  });

  it("Test 4: 修改阈值 → 队列立即重新计算", () => {
    const ownership = resolveOwnershipOnCreate({
      operatorUserId: "alice@example.com",
      operatorUserLabel: "Alice",
      operatorPositionId: "pos-eng",
      operatorPositionLabel: "Engineering",
    });

    // 错误率 25%，默认阈值 30% → 不触发
    const agent: GovernanceAgentInput = {
      agentId: "borderline-bot",
      name: "Borderline Bot",
      ownership,
      status: "online",
      consecutiveErrors: 0,
      offlineHours: 0,
      hasActiveSessions: false,
      errorRate7d: 0.25,
      successRate7d: 0.75,
      previousSuccessRate7d: 0.75,
      dailyCost: 0,
      avgDailyCost7d: 0,
      monthlyCost: 0,
      budgetLimit: null,
      costPerSession: 0,
      peerAvgCostPerSession: 0,
      lastSessionAt: NOW - 1000 * 60,
      deployedAt: NOW - 1000 * 60 * 60 * 24,
      sessionCount7d: 100,
      hasSensitiveContentViolation: false,
      hasPermissionViolation: false,
    };

    // 默认阈值（30%）— 不触发
    const issuesWithDefault = detectGovernanceIssues([agent], [], DEFAULT_GOVERNANCE_CONFIG, NOW);
    expect(issuesWithDefault.some((i) => i.category === "high_error_rate")).toBe(false);

    // 调低阈值到 20% — 立即触发
    const tightConfig = { ...DEFAULT_GOVERNANCE_CONFIG, errorRateThreshold: 0.2 };
    const issuesWithTight = detectGovernanceIssues([agent], [], tightConfig, NOW);
    expect(issuesWithTight.some((i) => i.category === "high_error_rate")).toBe(true);
  });

  it("Test 5: 治理队列纯净性 — 任何场景下都不出现 missing_owner / missing_attribution", () => {
    // 构造各种边界场景
    const scenarios: GovernanceAgentInput[] = [
      // 完全正常的机器人
      makeAgent({ agentId: "healthy" }),
      // 高错误率
      makeAgent({ agentId: "error-prone", errorRate7d: 0.5, successRate7d: 0.5 }),
      // 成本突增
      makeAgent({ agentId: "spiking", dailyCost: 100, avgDailyCost7d: 10 }),
      // 僵尸
      makeAgent({
        agentId: "zombie",
        lastSessionAt: NOW - 1000 * 60 * 60 * 24 * 60,
        deployedAt: NOW - 1000 * 60 * 60 * 24 * 90,
        sessionCount7d: 0,
      }),
      // 安全违规
      makeAgent({ agentId: "violator", hasSensitiveContentViolation: true }),
      // 越权
      makeAgent({ agentId: "overreach", hasPermissionViolation: true }),
    ];

    const issues = detectGovernanceIssues(scenarios, [], DEFAULT_GOVERNANCE_CONFIG, NOW);

    // 关键断言：任何场景下都不会有 missing_owner 或 missing_attribution
    for (const issue of issues) {
      expect(issue.category).not.toBe("missing_owner");
      expect(issue.category).not.toBe("missing_attribution");
    }
  });

  it("Test 6: 通知与升级 — Critical 治理项触发通知，超时升级", () => {
    const ownership = resolveOwnershipOnCreate({
      operatorUserId: "alice@example.com",
      operatorUserLabel: "Alice",
      operatorPositionId: "pos-eng",
      operatorPositionLabel: "Engineering",
    });

    const agent: GovernanceAgentInput = makeAgent({
      agentId: "broken-bot",
      consecutiveErrors: 10,
    });
    agent.ownership = ownership;

    const issues = detectGovernanceIssues([agent], [], DEFAULT_GOVERNANCE_CONFIG, NOW);
    const criticalIssue = issues.find((i) => i.level === "critical");
    expect(criticalIssue).toBeDefined();

    // Step 1: 立即生成通知，发送给当前管理人
    const notification = buildCriticalNotification(
      criticalIssue!,
      "/enterprise/acme/mesh/overview",
    );
    expect(notification.recipientUserId).toBe("alice@example.com");
    expect(notification.isEscalation).toBe(false);

    // Step 2: 4 小时后未处理 → 应该升级
    const fourHoursLater = NOW + 4 * 60 * 60 * 1000;
    expect(shouldEscalate(criticalIssue!, fourHoursLater)).toBe(true);

    // Step 3: 3 小时未处理 → 还不需要升级
    const threeHoursLater = NOW + 3 * 60 * 60 * 1000;
    expect(shouldEscalate(criticalIssue!, threeHoursLater)).toBe(false);
  });
});

// ─── helpers ───────────────────────────────────────────────────────────────────

function makeAgent(overrides: Partial<GovernanceAgentInput> = {}): GovernanceAgentInput {
  return {
    agentId: "agent-default",
    name: "Default Bot",
    ownership: {
      positionId: "pos-default",
      positionLabel: "Default",
      createdByUserId: "user-default",
      createdByUserLabel: "Default User",
      currentManagerUserId: "user-default",
      currentManagerLabel: "Default User",
      createdAt: "2025-01-01T00:00:00.000Z",
    },
    status: "online",
    consecutiveErrors: 0,
    offlineHours: 0,
    hasActiveSessions: false,
    errorRate7d: 0,
    successRate7d: 1,
    previousSuccessRate7d: 1,
    dailyCost: 0,
    avgDailyCost7d: 0,
    monthlyCost: 0,
    budgetLimit: null,
    costPerSession: 0,
    peerAvgCostPerSession: 0,
    lastSessionAt: NOW - 1000 * 60 * 60,
    deployedAt: NOW - 1000 * 60 * 60 * 24 * 60,
    sessionCount7d: 10,
    hasSensitiveContentViolation: false,
    hasPermissionViolation: false,
    ...overrides,
  };
}
