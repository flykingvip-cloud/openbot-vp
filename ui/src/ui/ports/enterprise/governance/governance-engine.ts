/**
 * Governance Engine — 运营治理检测引擎
 *
 * 纯函数，输入当前状态数据 + 配置，输出治理项列表。
 * 不含"待补创建人"或"待补归因"逻辑。
 */

import type {
  GovernanceCategory,
  GovernanceConfig,
  GovernanceItem,
  GovernanceLevel,
  MeshOwnership,
} from "./types.ts";
import { DEFAULT_GOVERNANCE_CONFIG } from "./types.ts";

// ─── Input Types ───────────────────────────────────────────────────────────────

export type GovernanceAgentInput = {
  agentId: string;
  name: string;
  ownership: MeshOwnership;
  status: "online" | "offline" | "unknown";
  /** 连续错误次数 */
  consecutiveErrors: number;
  /** 离线持续时间（小时） */
  offlineHours: number;
  /** 是否有活跃会话 */
  hasActiveSessions: boolean;
  /** 最近 7 天错误率 [0, 1] */
  errorRate7d: number;
  /** 最近 7 天成功率 [0, 1] */
  successRate7d: number;
  /** 上一周期成功率 [0, 1]（用于环比） */
  previousSuccessRate7d: number;
  /** 单日成本 */
  dailyCost: number;
  /** 过去 7 天日均成本 */
  avgDailyCost7d: number;
  /** 月度成本 */
  monthlyCost: number;
  /** 预算上限（null = 未设置） */
  budgetLimit: number | null;
  /** 单次会话平均成本 */
  costPerSession: number;
  /** 同类机器人单次会话平均成本 */
  peerAvgCostPerSession: number;
  /** 最近会话时间戳（ms） */
  lastSessionAt: number | null;
  /** 部署时间戳（ms） */
  deployedAt: number | null;
  /** 最近 7 天会话数 */
  sessionCount7d: number;
  /** 是否触发敏感词 */
  hasSensitiveContentViolation: boolean;
  /** 是否有越权操作 */
  hasPermissionViolation: boolean;
};

export type GovernanceGroupInput = {
  groupId: string;
  name: string;
  ownership: MeshOwnership;
  /** 成员机器人列表（用于冗余检测） */
  members: Array<{
    agentId: string;
    name: string;
    domain: string;
    description: string;
  }>;
  /** 最近 7 天错误率 */
  errorRate7d: number;
  /** 月度成本 */
  monthlyCost: number;
  /** 预算上限 */
  budgetLimit: number | null;
  /** 最近会话时间戳（ms） */
  lastSessionAt: number | null;
  /** 最近 30 天会话数 */
  sessionCount30d: number;
};

// ─── Main Detection Function ───────────────────────────────────────────────────

/**
 * 运营治理检测引擎。
 * 纯函数：相同输入始终产生相同输出。
 */
export function detectGovernanceIssues(
  agents: GovernanceAgentInput[],
  groups: GovernanceGroupInput[],
  config: GovernanceConfig = DEFAULT_GOVERNANCE_CONFIG,
  now: number = Date.now(),
): GovernanceItem[] {
  const issues: GovernanceItem[] = [];

  for (const agent of agents) {
    issues.push(...detectAgentIssues(agent, config, now));
  }

  for (const group of groups) {
    issues.push(...detectGroupIssues(group, config, now));
  }

  // 按 level 排序（Critical > Warning > Info），同级别按 detectedAt 降序
  return issues.toSorted((a, b) => {
    const levelOrder = levelPriority(b.level) - levelPriority(a.level);
    if (levelOrder !== 0) {
      return levelOrder;
    }
    return b.detectedAt.localeCompare(a.detectedAt);
  });
}

// ─── Agent Detection Rules ─────────────────────────────────────────────────────

function detectAgentIssues(
  agent: GovernanceAgentInput,
  config: GovernanceConfig,
  now: number,
): GovernanceItem[] {
  const issues: GovernanceItem[] = [];
  const nowIso = new Date(now).toISOString();
  const target = {
    kind: "agent" as const,
    id: agent.agentId,
    name: agent.name,
    ownership: agent.ownership,
  };

  // Critical: 敏感词违规
  if (agent.hasSensitiveContentViolation) {
    issues.push(
      buildItem({
        category: "sensitive_content",
        level: "critical",
        target,
        title: `${agent.name} 触发敏感词过滤`,
        evidence: { agentId: agent.agentId },
        suggestedAction: "立即暂停机器人并审查会话记录",
        detectedAt: nowIso,
      }),
    );
  }

  // Critical: 越权操作
  if (agent.hasPermissionViolation) {
    issues.push(
      buildItem({
        category: "permission_violation",
        level: "critical",
        target,
        title: `${agent.name} 执行了越权操作`,
        evidence: { agentId: agent.agentId },
        suggestedAction: "立即暂停机器人并审查权限配置",
        detectedAt: nowIso,
      }),
    );
  }

  // Critical: 连续错误超阈值
  if (agent.consecutiveErrors >= config.consecutiveErrorThreshold) {
    issues.push(
      buildItem({
        category: "consecutive_errors",
        level: "critical",
        target,
        title: `${agent.name} 连续错误 ${agent.consecutiveErrors} 次`,
        evidence: {
          consecutiveErrors: agent.consecutiveErrors,
          threshold: config.consecutiveErrorThreshold,
        },
        suggestedAction: "建议暂停机器人并排查错误原因",
        detectedAt: nowIso,
      }),
    );
  }

  // Critical: 离线但有活跃会话
  if (
    agent.status === "offline" &&
    agent.offlineHours >= config.offlineAlertHours &&
    agent.hasActiveSessions
  ) {
    issues.push(
      buildItem({
        category: "offline_with_active_sessions",
        level: "critical",
        target,
        title: `${agent.name} 已离线 ${agent.offlineHours} 小时，仍有活跃会话`,
        evidence: {
          offlineHours: agent.offlineHours,
          threshold: config.offlineAlertHours,
          hasActiveSessions: true,
        },
        suggestedAction: "立即重启机器人或将会话转移到其他机器人",
        detectedAt: nowIso,
      }),
    );
  }

  // Critical: 成本突增
  if (
    agent.avgDailyCost7d > 0 &&
    agent.dailyCost >= agent.avgDailyCost7d * config.costSpikeMultiplier
  ) {
    issues.push(
      buildItem({
        category: "cost_spike",
        level: "critical",
        target,
        title: `${agent.name} 单日成本突增 ${(agent.dailyCost / agent.avgDailyCost7d).toFixed(1)}x`,
        evidence: {
          dailyCost: agent.dailyCost,
          avgDailyCost7d: agent.avgDailyCost7d,
          multiplier: agent.dailyCost / agent.avgDailyCost7d,
          threshold: config.costSpikeMultiplier,
        },
        suggestedAction: "建议限流或降级模型以控制成本",
        detectedAt: nowIso,
      }),
    );
  }

  // Warning: 预算超标
  if (agent.budgetLimit !== null && agent.monthlyCost >= agent.budgetLimit) {
    issues.push(
      buildItem({
        category: "budget_exceeded",
        level: "warning",
        target,
        title: `${agent.name} 月度成本超出预算`,
        evidence: {
          monthlyCost: agent.monthlyCost,
          budgetLimit: agent.budgetLimit,
          overageRatio: agent.monthlyCost / agent.budgetLimit,
        },
        suggestedAction: "建议设置更严格的预算上限或降级模型",
        detectedAt: nowIso,
      }),
    );
  }

  // Warning: 高错误率
  if (agent.errorRate7d > config.errorRateThreshold) {
    issues.push(
      buildItem({
        category: "high_error_rate",
        level: "warning",
        target,
        title: `${agent.name} 错误率 ${(agent.errorRate7d * 100).toFixed(0)}%`,
        evidence: {
          errorRate7d: agent.errorRate7d,
          threshold: config.errorRateThreshold,
        },
        suggestedAction: "建议排查错误原因并优化配置",
        detectedAt: nowIso,
      }),
    );
  }

  // Warning: 质量下降（绝对值）
  if (agent.successRate7d < 1 - config.errorRateThreshold && agent.sessionCount7d > 0) {
    issues.push(
      buildItem({
        category: "quality_degradation",
        level: "warning",
        target,
        title: `${agent.name} 成功率仅 ${(agent.successRate7d * 100).toFixed(0)}%`,
        evidence: {
          successRate7d: agent.successRate7d,
          sessionCount7d: agent.sessionCount7d,
          threshold: 1 - config.errorRateThreshold,
        },
        suggestedAction: "建议调优机器人配置或回退版本",
        detectedAt: nowIso,
      }),
    );
  }

  // Warning: 质量环比下降
  if (
    agent.previousSuccessRate7d > 0 &&
    agent.previousSuccessRate7d - agent.successRate7d >= config.qualityDropPoints / 100
  ) {
    issues.push(
      buildItem({
        category: "quality_drop",
        level: "warning",
        target,
        title: `${agent.name} 成功率环比下降 ${((agent.previousSuccessRate7d - agent.successRate7d) * 100).toFixed(0)} 个百分点`,
        evidence: {
          currentSuccessRate: agent.successRate7d,
          previousSuccessRate: agent.previousSuccessRate7d,
          dropPoints: (agent.previousSuccessRate7d - agent.successRate7d) * 100,
          threshold: config.qualityDropPoints,
        },
        suggestedAction: "建议排查近期变更并考虑回退",
        detectedAt: nowIso,
      }),
    );
  }

  // Warning: 成本效率低
  if (agent.peerAvgCostPerSession > 0 && agent.costPerSession >= agent.peerAvgCostPerSession * 2) {
    issues.push(
      buildItem({
        category: "inefficient_cost",
        level: "warning",
        target,
        title: `${agent.name} 单次会话成本是同类均值的 ${(agent.costPerSession / agent.peerAvgCostPerSession).toFixed(1)} 倍`,
        evidence: {
          costPerSession: agent.costPerSession,
          peerAvgCostPerSession: agent.peerAvgCostPerSession,
          ratio: agent.costPerSession / agent.peerAvgCostPerSession,
        },
        suggestedAction: "建议降级模型或优化 prompt 以降低成本",
        detectedAt: nowIso,
      }),
    );
  }

  // Info: 僵尸机器人
  if (agent.lastSessionAt !== null && agent.deployedAt !== null) {
    const daysSinceLastSession = (now - agent.lastSessionAt) / (1000 * 60 * 60 * 24);
    const daysSinceDeployed = (now - agent.deployedAt) / (1000 * 60 * 60 * 24);
    if (daysSinceLastSession >= config.zombieDays && daysSinceDeployed > 30) {
      issues.push(
        buildItem({
          category: "zombie_agent",
          level: "info",
          target,
          title: `${agent.name} 已 ${Math.floor(daysSinceLastSession)} 天无活跃会话`,
          evidence: {
            daysSinceLastSession: Math.floor(daysSinceLastSession),
            daysSinceDeployed: Math.floor(daysSinceDeployed),
            threshold: config.zombieDays,
          },
          suggestedAction: "建议归档或下线以释放资源",
          detectedAt: nowIso,
        }),
      );
    }
  }

  return issues;
}

// ─── Group Detection Rules ─────────────────────────────────────────────────────

function detectGroupIssues(
  group: GovernanceGroupInput,
  config: GovernanceConfig,
  now: number,
): GovernanceItem[] {
  const issues: GovernanceItem[] = [];
  const nowIso = new Date(now).toISOString();
  const target = {
    kind: "group" as const,
    id: group.groupId,
    name: group.name,
    ownership: group.ownership,
  };

  // Warning: 小组预算超标
  if (group.budgetLimit !== null && group.monthlyCost >= group.budgetLimit) {
    issues.push(
      buildItem({
        category: "group_budget_exceeded",
        level: "warning",
        target,
        title: `${group.name} 月度成本超出预算`,
        evidence: {
          monthlyCost: group.monthlyCost,
          budgetLimit: group.budgetLimit,
          overageRatio: group.monthlyCost / group.budgetLimit,
        },
        suggestedAction: "建议调整小组预算或优化成员配置",
        detectedAt: nowIso,
      }),
    );
  }

  // Warning: 小组错误率高
  if (group.errorRate7d > config.errorRateThreshold) {
    issues.push(
      buildItem({
        category: "group_quality_issue",
        level: "warning",
        target,
        title: `${group.name} 错误率 ${(group.errorRate7d * 100).toFixed(0)}%`,
        evidence: {
          errorRate7d: group.errorRate7d,
          threshold: config.errorRateThreshold,
        },
        suggestedAction: "建议排查小组内错误源并优化协作流程",
        detectedAt: nowIso,
      }),
    );
  }

  // Info: 僵尸小组
  if (group.lastSessionAt !== null) {
    const daysSinceLastSession = (now - group.lastSessionAt) / (1000 * 60 * 60 * 24);
    if (daysSinceLastSession >= config.groupZombieDays && group.sessionCount30d === 0) {
      issues.push(
        buildItem({
          category: "zombie_group",
          level: "info",
          target,
          title: `${group.name} 已 ${Math.floor(daysSinceLastSession)} 天无活跃会话`,
          evidence: {
            daysSinceLastSession: Math.floor(daysSinceLastSession),
            threshold: config.groupZombieDays,
          },
          suggestedAction: "建议归档或解散以简化管理",
          detectedAt: nowIso,
        }),
      );
    }
  }

  // Info: 冗余成员（同组内能力域重叠）
  const redundantPairs = detectRedundantMembers(group.members);
  if (redundantPairs.length > 0) {
    issues.push(
      buildItem({
        category: "redundant_members",
        level: "info",
        target,
        title: `${group.name} 存在 ${redundantPairs.length} 对功能重叠的成员`,
        evidence: {
          redundantPairs: redundantPairs.map(([a, b]) => ({
            agentA: a.name,
            agentB: b.name,
            domain: a.domain,
          })),
        },
        suggestedAction: "建议合并功能重叠的机器人以提升效率",
        detectedAt: nowIso,
      }),
    );
  }

  return issues;
}

// ─── Helpers ───────────────────────────────────────────────────────────────────

function buildItem(params: {
  category: GovernanceCategory;
  level: GovernanceLevel;
  target: GovernanceItem["target"];
  title: string;
  evidence: Record<string, unknown>;
  suggestedAction: string;
  detectedAt: string;
}): GovernanceItem {
  return {
    id: `${params.category}:${params.target.kind}:${params.target.id}`,
    level: params.level,
    category: params.category,
    target: params.target,
    title: params.title,
    evidence: params.evidence,
    suggestedAction: params.suggestedAction,
    detectedAt: params.detectedAt,
  };
}

function levelPriority(level: GovernanceLevel): number {
  switch (level) {
    case "critical":
      return 3;
    case "warning":
      return 2;
    case "info":
      return 1;
  }
}

type MemberInfo = { agentId: string; name: string; domain: string; description: string };

function detectRedundantMembers(members: MemberInfo[]): Array<[MemberInfo, MemberInfo]> {
  const pairs: Array<[MemberInfo, MemberInfo]> = [];
  for (let i = 0; i < members.length; i++) {
    for (let j = i + 1; j < members.length; j++) {
      const a = members[i];
      const b = members[j];
      // 同域 + 描述相似度高（简化：同域即视为潜在冗余）
      if (a.domain && b.domain && a.domain === b.domain) {
        pairs.push([a, b]);
      }
    }
  }
  return pairs;
}
