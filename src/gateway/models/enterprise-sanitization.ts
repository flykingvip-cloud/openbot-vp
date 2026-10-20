/**
 * Enterprise Sanitization Model — 企业能力脱敏领域模型。
 *
 * 模块定位：
 * 本文件承载 gateway 层对企业资产提交至平台前的强制脱敏流程建模。
 * 核心约束：企业资产未经脱敏不得直接提交至平台。
 *
 * 设计准则：
 * - 脱敏状态与资产生命周期状态严格分离
 * - 发现项（finding）与替换操作（replacement）可追踪
 * - 输出为通用化后的平台能力包
 */

// ─────────────────────────────────────────────────────────────────────────
// Sanitization State — 脱敏流程状态
// ─────────────────────────────────────────────────────────────────────────

export type EnterpriseSanitizationState =
  | "not-started"
  | "scanning"
  | "findings-available"
  | "remediating"
  | "complete"
  | "failed";

// ─────────────────────────────────────────────────────────────────────────
// Finding Category — 发现项类别（强制脱敏维度）
// ─────────────────────────────────────────────────────────────────────────

export type SanitizationFindingCategory =
  | "company-name"
  | "customer-data"
  | "internal-endpoint"
  | "secret"
  | "internal-kb-reference"
  | "employee-label"
  | "department-label"
  | "proprietary-identifier";

// ─────────────────────────────────────────────────────────────────────────
// Finding Severity — 发现项严重级别
// ─────────────────────────────────────────────────────────────────────────

export type SanitizationFindingSeverity = "critical" | "high" | "medium" | "low";

// ─────────────────────────────────────────────────────────────────────────
// Sanitization Finding — 单个发现项
// ─────────────────────────────────────────────────────────────────────────

export type SanitizationFinding = {
  /** 发现项 ID */
  findingId: string;
  /** 所属资产 ID */
  assetId: string;
  /** 类别 */
  category: SanitizationFindingCategory;
  /** 严重级别 */
  severity: SanitizationFindingSeverity;
  /** 原始值/片段 */
  originalValue: string;
  /** 所在位置（字段路径） */
  fieldPath: string;
  /** 描述 */
  description: string;
  /** 建议替换值 */
  suggestedReplacement?: string;
  /** 是否已处理 */
  resolved: boolean;
  /** 实际替换值（resolved 时填写） */
  replacementValue?: string;
};

// ─────────────────────────────────────────────────────────────────────────
// Sanitization Package — 脱敏后的通用能力包
// ─────────────────────────────────────────────────────────────────────────

export type SanitizedCapabilityPackage = {
  /** 包唯一标识 */
  packageId: string;
  /** 原始企业资产 ID */
  sourceAssetId: string;
  /** 通用化后的名称 */
  generalizedName: string;
  /** 通用化后的描述 */
  generalizedSummary: string;
  /** 能力类型 */
  capabilityType: "prompt" | "template" | "workflow" | "knowledge" | "agent" | "capability";
  /** 通用化后的输入说明 */
  generalizedInputDescription: string;
  /** 通用化后的输出说明 */
  generalizedOutputDescription: string;
  /** 通用化后的使用示例 */
  generalizedUsageExamples: string[];
  /** 通用化后的标签 */
  generalizedTags: string[];
  /** 通用化后的分类 */
  generalizedCategory: string;
  /** 已替换的发现项数量 */
  replacementsCount: number;
  /** 剩余未处理发现项数量 */
  remainingFindingsCount: number;
  /** 是否可以提交平台 */
  eligibleForPlatformSubmission: boolean;
  /** 脱敏完成时间 */
  sanitizedAt?: number;
  /** 脱敏版本 */
  sanitizationVersion: string;
};

// ─────────────────────────────────────────────────────────────────────────
// Enterprise Sanitization Session — 脱敏会话（一次脱敏操作）
// ─────────────────────────────────────────────────────────────────────────

export type EnterpriseSanitizationSession = {
  /** 会话 ID */
  sessionId: string;
  /** 企业 ID */
  enterpriseId: string;
  /** 操作员工 ID */
  operatorEmployeeId: string;
  /** 目标资产 ID */
  assetId: string;
  /** 当前状态 */
  state: EnterpriseSanitizationState;
  /** 发现项列表 */
  findings: SanitizationFinding[];
  /** 脱敏后的通用包（完成后填充） */
  sanitizedPackage?: SanitizedCapabilityPackage;
  /** 创建时间 */
  createdAt: number;
  /** 最近更新时间 */
  updatedAt: number;
  /** 完成时间 */
  completedAt: number | null;
};

// ─────────────────────────────────────────────────────────────────────────
// Platform Submission — 平台提交记录
// ─────────────────────────────────────────────────────────────────────────

export type PlatformCapabilitySubmission = {
  /** 提交 ID */
  submissionId: string;
  /** 来源企业 ID */
  enterpriseId: string;
  /** 提交员工 ID */
  submittedByEmployeeId: string;
  /** 脱敏包 ID */
  sanitizedPackageId: string;
  /** 通用化后的能力包 */
  package: SanitizedCapabilityPackage;
  /** 提交状态 */
  status:
    | "pending-review"
    | "under-review"
    | "approved"
    | "rejected"
    | "returned-for-modification"
    | "enterprise-only";
  /** 平台审核备注 */
  platformReviewNote?: string;
  /** 提交时间 */
  submittedAt: number;
  /** 审核时间 */
  reviewedAt?: number;
};
