/**
 * Mesh Governance Types — 机巢治理重构
 *
 * 核心变更：
 * 1. 归属模型由岗位驱动（MeshOwnership），创建时自动绑定，人员变动时自动继承
 * 2. 治理队列聚焦运营健康度（状态/成本/质量/安全），移除"待补创建人"/"待补归因"
 */

// ─── Ownership Model ───────────────────────────────────────────────────────────

/**
 * 岗位归属信息。
 * 创建机器人/协作小组时自动写入，岗位人员变动时 currentManagerUserId 自动更新。
 */
export type MeshOwnership = {
  /** 归属岗位 ID（必填，创建时写入，不变） */
  positionId: string;
  /** 岗位名称（展示用） */
  positionLabel: string;
  /** 原始创建人 ID（历史记录，不变） */
  createdByUserId: string;
  /** 原始创建人名称 */
  createdByUserLabel: string;
  /** 当前管理人 ID（随岗位人员变动更新） */
  currentManagerUserId: string;
  /** 当前管理人名称 */
  currentManagerLabel: string;
  /** 创建时间 ISO */
  createdAt: string;
};

/** 岗位人员变动日志 */
export type OwnershipTransferLog = {
  positionId: string;
  previousUserId: string;
  newUserId: string;
  newUserLabel: string;
  transferredAt: string;
  affectedAgentCount: number;
  affectedGroupCount: number;
};

// ─── Governance Queue Model ────────────────────────────────────────────────────

/** 治理项级别 */
export type GovernanceLevel = "critical" | "warning" | "info";

/** 治理项分类 — 仅运营相关，不含 missing_owner / missing_attribution */
export type GovernanceCategory =
  // 状态异常
  | "consecutive_errors"
  | "offline_with_active_sessions"
  | "zombie_agent"
  | "high_error_rate"
  // 成本异常
  | "cost_spike"
  | "budget_exceeded"
  | "inefficient_cost"
  | "group_budget_exceeded"
  // 质量异常
  | "quality_degradation"
  | "quality_drop"
  // 安全合规
  | "sensitive_content"
  | "permission_violation"
  // 协作小组
  | "zombie_group"
  | "redundant_members"
  | "group_quality_issue";

/** 治理项 */
export type GovernanceItem = {
  /** 确定性 ID: `${category}:${targetKind}:${targetId}` */
  id: string;
  level: GovernanceLevel;
  category: GovernanceCategory;
  target: {
    kind: "agent" | "group";
    id: string;
    name: string;
    ownership: MeshOwnership;
  };
  /** 人类可读标题 */
  title: string;
  /** 具体证据数据 */
  evidence: Record<string, unknown>;
  /** 建议动作描述 */
  suggestedAction: string;
  /** 检测时间 ISO */
  detectedAt: string;
};

/** 治理动作类型 */
export type GovernanceActionType =
  // Critical 动作
  | "pause"
  | "throttle"
  | "offline"
  // Warning 动作
  | "downgrade_model"
  | "set_budget_cap"
  | "mark_known"
  // Info 动作
  | "archive"
  | "merge"
  | "ignore";

/** 治理动作执行参数 */
export type GovernanceActionParams = {
  issueId: string;
  actionType: GovernanceActionType;
  targetId: string;
  targetKind: "agent" | "group";
  operatorUserId: string;
  operatorPositionId: string;
  reason?: string;
};

/** 治理动作执行结果 */
export type GovernanceActionResult =
  | { ok: true; removedIssueId: string }
  | { ok: false; error: string };

/** 治理审计日志条目 */
export type GovernanceAuditEntry = {
  issueId: string;
  actionType: GovernanceActionType;
  targetId: string;
  targetKind: "agent" | "group";
  operatorUserId: string;
  operatorPositionId: string;
  executedAt: string;
  reason?: string;
};

// ─── Governance Config ─────────────────────────────────────────────────────────

/** 治理阈值配置 */
export type GovernanceConfig = {
  /** 连续错误次数阈值（默认 5） */
  consecutiveErrorThreshold: number;
  /** 离线告警时间阈值，小时（默认 24） */
  offlineAlertHours: number;
  /** 僵尸判定天数（默认 30） */
  zombieDays: number;
  /** 错误率告警阈值（默认 0.30） */
  errorRateThreshold: number;
  /** 成本突增倍数（默认 3） */
  costSpikeMultiplier: number;
  /** 质量下降百分点（默认 20） */
  qualityDropPoints: number;
  /** 协作小组僵尸判定天数（默认 30） */
  groupZombieDays: number;
};

export const DEFAULT_GOVERNANCE_CONFIG: GovernanceConfig = {
  consecutiveErrorThreshold: 5,
  offlineAlertHours: 24,
  zombieDays: 30,
  errorRateThreshold: 0.3,
  costSpikeMultiplier: 3,
  qualityDropPoints: 20,
  groupZombieDays: 30,
};

// ─── Governance Summary (replaces unownedAssetCount etc.) ──────────────────────

/** 治理摘要（替代旧的 unownedAssetCount / unattributedCostCount） */
export type GovernanceQueueSummary = {
  criticalIssueCount: number;
  warningIssueCount: number;
  infoIssueCount: number;
  totalGovernanceIssueCount: number;
};
