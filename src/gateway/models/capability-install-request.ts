/**
 * Capability Install Request Model — 能力安装请求领域模型。
 *
 * 模块定位：
 * 本文件承载 gateway 层对能力安装请求的统一建模，覆盖：
 * 1. 员工直接安装请求（employee-install）
 * 2. Da Bai 代理安装请求（agent-install-request）
 * 3. 机器人自装请求（robot-self-install）
 *
 * 设计准则：
 * - 请求状态、配置状态、治理状态严格分离（不混成一个字段）
 * - 目标机器人始终是安装决策主语
 * - Da Bai 只传递"安装请求"，不执行"直接安装动作"
 */

// ─────────────────────────────────────────────────────────────────────────
// Install Request Actor — 请求发起方
// ─────────────────────────────────────────────────────────────────────────

export type InstallRequestActorType = "employee" | "dabai-proxy" | "robot-self";

// ─────────────────────────────────────────────────────────────────────────
// Install Request Source — 能力来源
// ─────────────────────────────────────────────────────────────────────────

export type InstallRequestCapabilitySource =
  | "platform-marketplace"
  | "enterprise-distributed"
  | "external-local";

// ─────────────────────────────────────────────────────────────────────────
// Install Request Status — 请求生命周期状态
// ─────────────────────────────────────────────────────────────────────────

export type InstallRequestStatus =
  | "draft"
  | "scanning"
  | "risk-preview"
  | "pending-confirmation"
  | "pending-target-review"
  | "installing"
  | "pending-configuration"
  | "installed"
  | "restricted"
  | "rejected"
  | "failed";

// ─────────────────────────────────────────────────────────────────────────
// Risk Level — 风险分级
// ─────────────────────────────────────────────────────────────────────────

export type InstallRequestRiskLevel = "low" | "medium" | "high" | "critical";

// ─────────────────────────────────────────────────────────────────────────
// Configuration State — 配置状态（与请求状态严格分离）
// ─────────────────────────────────────────────────────────────────────────

export type InstallRequestConfigurationState = "not-required" | "pending" | "complete";

// ─────────────────────────────────────────────────────────────────────────
// Governance State — 治理状态（与请求状态严格分离）
// ─────────────────────────────────────────────────────────────────────────

export type InstallRequestGovernanceState = "none" | "restricted" | "review-required" | "disabled";

// ─────────────────────────────────────────────────────────────────────────
// Risk Finding — 风险发现项
// ─────────────────────────────────────────────────────────────────────────

export type InstallRequestRiskFinding = {
  category:
    | "network"
    | "filesystem"
    | "credential"
    | "data-exposure"
    | "unverified-source"
    | "policy";
  title: string;
  description: string;
  mitigation: string;
};

// ─────────────────────────────────────────────────────────────────────────
// Configuration Field — 配置字段定义
// ─────────────────────────────────────────────────────────────────────────

export type InstallRequestConfigurationField = {
  key: string;
  label: string;
  type: "string" | "number" | "boolean" | "select" | "secret";
  required: boolean;
  value?: string | number | boolean;
  options?: Array<{ label: string; value: string }>;
  helpText?: string;
};

// ─────────────────────────────────────────────────────────────────────────
// Capability Install Request — 核心请求实体
// ─────────────────────────────────────────────────────────────────────────

export type CapabilityInstallRequest = {
  /** 请求唯一标识 */
  requestId: string;
  /** 请求发起方类型 */
  actorType: InstallRequestActorType;
  /** 发起方标识（employeeId / robotId / dabai-session-id） */
  actorId: string;
  /** 目标机器人 ID（安装最终落点） */
  targetRobotId: string;
  /** 目标机器人名称 */
  targetRobotName: string;
  /** 能力 ID */
  capabilityId: string;
  /** 能力名称 */
  capabilityName: string;
  /** 能力版本 */
  capabilityVersion: string;
  /** 能力来源 */
  capabilitySource: InstallRequestCapabilitySource;
  /** 请求当前状态 */
  status: InstallRequestStatus;
  /** 配置状态（严格独立于 status） */
  configurationState: InstallRequestConfigurationState;
  /** 治理状态（严格独立于 status） */
  governanceState: InstallRequestGovernanceState;
  /** 风险等级 */
  riskLevel: InstallRequestRiskLevel;
  /** 风险发现项 */
  riskFindings: InstallRequestRiskFinding[];
  /** 所需权限 */
  requiredPermissions: string[];
  /** 所需配置项 */
  requiredConfiguration: InstallRequestConfigurationField[];
  /** 已应用配置值 */
  appliedConfiguration?: Record<string, string | number | boolean>;
  /** 创建时间 */
  createdAt: number;
  /** 最近更新时间 */
  updatedAt: number;
  /** 完成/拒绝时间 */
  completedAt: number | null;
  /** 请求拒绝原因（如被拒绝） */
  rejectionReason?: string;
  /** 替代建议（如目标机器人建议替代能力） */
  alternativeSuggestion?: {
    capabilityId: string;
    capabilityName: string;
    reason: string;
  };
};

// ─────────────────────────────────────────────────────────────────────────
// Agent Proxy Request — Da Bai 代理请求（结构化请求子类型）
// ─────────────────────────────────────────────────────────────────────────

export type AgentProxyInstallRequest = CapabilityInstallRequest & {
  actorType: "dabai-proxy";
  /** 发起请求的会话/消息 ID */
  originatingSessionId: string;
  /** 目标机器人接受前的审核状态 */
  targetReviewStatus: "sent" | "reviewing" | "accepted" | "rejected" | "alternative-suggested";
  /** 目标机器人审核备注 */
  targetReviewNote?: string;
};

// ─────────────────────────────────────────────────────────────────────────
// Robot Self-Install Request — 机器人自装请求
// ─────────────────────────────────────────────────────────────────────────

export type RobotSelfInstallRequest = CapabilityInstallRequest & {
  actorType: "robot-self";
  /** 机器人自装建议理由 */
  selfInstallReason: string;
  /** 员工确认状态 */
  employeeConfirmationStatus: "pending" | "confirmed" | "declined";
  /** 员工确认时间 */
  employeeConfirmedAt?: number;
};
