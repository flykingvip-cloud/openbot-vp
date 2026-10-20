/**
 * Employee Install Types — 员工端能力安装治理 UI 类型定义。
 *
 * 模块定位：
 * 本文件承载员工在「我的机器人」中发起能力安装、风险预览、配置应用等交互所需的
 * 纯类型层。上游对接 gateway `employee-install.*` RPC，下游供 `install-dialog.ts` /
 * `risk-dialog.ts` / `configuration-dialog.ts` / `result-dialog.ts` 渲染消费。
 *
 * 设计准则：
 * - 仅导出 `type` 别名，不使用 `interface`
 * - 状态枚举使用字面量联合 + `as const` 数组双导出
 * - 不从本目录外引入运行时字段，保持纯 UI 类型层可独立编译
 */

// ─────────────────────────────────────────────────────────────────────────
// Install Source — 安装来源（与 CapabilitySummary.installSource 对齐）
// ─────────────────────────────────────────────────────────────────────────

export type EmployeeInstallSource =
  | "platform-marketplace"
  | "enterprise-distributed"
  | "external-local";

export const EMPLOYEE_INSTALL_SOURCES: readonly EmployeeInstallSource[] = [
  "platform-marketplace",
  "enterprise-distributed",
  "external-local",
] as const;

// ─────────────────────────────────────────────────────────────────────────
// Risk Level — 风险分级
// ─────────────────────────────────────────────────────────────────────────

export type EmployeeInstallRiskLevel = "low" | "medium" | "high" | "critical";

export const EMPLOYEE_INSTALL_RISK_LEVELS: readonly EmployeeInstallRiskLevel[] = [
  "low",
  "medium",
  "high",
  "critical",
] as const;

// ─────────────────────────────────────────────────────────────────────────
// Install Request — 员工直接安装请求
// ─────────────────────────────────────────────────────────────────────────

export type EmployeeInstallRequestStatus =
  | "draft"
  | "scanning"
  | "risk-preview"
  | "pending-confirmation"
  | "installing"
  | "pending-configuration"
  | "installed"
  | "restricted"
  | "failed";

export const EMPLOYEE_INSTALL_REQUEST_STATUSES: readonly EmployeeInstallRequestStatus[] = [
  "draft",
  "scanning",
  "risk-preview",
  "pending-confirmation",
  "installing",
  "pending-configuration",
  "installed",
  "restricted",
  "failed",
] as const;

export type EmployeeInstallRequest = {
  /** 请求唯一标识 */
  requestId: string;
  /** 发起员工标识 */
  employeeId: string;
  /** 目标机器人 ID */
  targetRobotId: string;
  /** 目标机器人名称 */
  targetRobotName: string;
  /** 能力 ID */
  capabilityId: string;
  /** 能力名称 */
  capabilityName: string;
  /** 安装来源 */
  source: EmployeeInstallSource;
  /** 当前请求状态 */
  status: EmployeeInstallRequestStatus;
  /** 风险等级 */
  riskLevel: EmployeeInstallRiskLevel;
  /** 风险项列表 */
  riskItems: EmployeeInstallRiskItem[];
  /** 所需权限 */
  requiredPermissions: string[];
  /** 所需配置项 */
  requiredConfiguration: EmployeeInstallConfigurationField[];
  /** 创建时间 */
  createdAt: number;
  /** 最近更新时间 */
  updatedAt: number;
  /** 完成时间（如未完成则为 null） */
  completedAt: number | null;
};

export type EmployeeInstallRiskItem = {
  /** 风险类别 */
  category:
    | "network"
    | "filesystem"
    | "credential"
    | "data-exposure"
    | "unverified-source"
    | "policy";
  /** 风险标题 */
  title: string;
  /** 风险描述 */
  description: string;
  /** 缓解建议 */
  mitigation: string;
};

export type EmployeeInstallConfigurationField = {
  /** 配置项键 */
  key: string;
  /** 配置项标签 */
  label: string;
  /** 配置项类型 */
  type: "string" | "number" | "boolean" | "select" | "secret";
  /** 是否必填 */
  required: boolean;
  /** 当前值（如已配置） */
  value?: string | number | boolean;
  /** 可选值列表（select 类型使用） */
  options?: Array<{ label: string; value: string }>;
  /** 帮助文本 */
  helpText?: string;
};

// ─────────────────────────────────────────────────────────────────────────
// Source Listing — 安装来源列表项
// ─────────────────────────────────────────────────────────────────────────

export type EmployeeInstallSourceItem = {
  /** 能力 ID */
  capabilityId: string;
  /** 能力名称 */
  capabilityName: string;
  /** 能力摘要 */
  capabilitySummary: string;
  /** 来源类型 */
  source: EmployeeInstallSource;
  /** 来源细分标签 */
  sourceLabel: string;
  /** 版本 */
  version: string;
  /** 是否已安装到目标机器人 */
  alreadyInstalled: boolean;
  /** 风险标签 */
  riskTags: string[];
};

// ─────────────────────────────────────────────────────────────────────────
// External Scan Result — 外部/本地来源扫描结果
// ─────────────────────────────────────────────────────────────────────────

export type EmployeeInstallExternalScanResult = {
  /** 扫描是否通过 */
  passed: boolean;
  /** 扫描发现的问题 */
  findings: EmployeeInstallRiskItem[];
  /** 综合风险等级 */
  overallRisk: EmployeeInstallRiskLevel;
  /** 建议操作 */
  recommendation: "proceed" | "proceed-with-warning" | "block";
  /** 原始文件哈希（用于追溯） */
  contentHash?: string;
  /** 扫描时间戳 */
  scannedAt: number;
};

// ─────────────────────────────────────────────────────────────────────────
// Install History — 员工安装历史记录
// ─────────────────────────────────────────────────────────────────────────

export type EmployeeInstallHistoryItem = {
  /** 请求 ID */
  requestId: string;
  /** 目标机器人 ID */
  targetRobotId: string;
  /** 目标机器人名称 */
  targetRobotName: string;
  /** 能力 ID */
  capabilityId: string;
  /** 能力名称 */
  capabilityName: string;
  /** 安装来源 */
  source: EmployeeInstallSource;
  /** 结果状态 */
  resultStatus: "installed" | "pending-configuration" | "restricted" | "failed";
  /** 风险等级 */
  riskLevel: EmployeeInstallRiskLevel;
  /** 安装时间 */
  installedAt: number;
};
