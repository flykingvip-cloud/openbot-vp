/**
 * Runtime Projection Layer — 「能力使用管理」（enterprise-capability-usage-management）模块的
 * 投影层桶式索引（barrel index）。
 *
 * 模块定位：
 * 本文件是 `Runtime_Projection_Layer` 的**唯一**对外入口。所有上游消费者
 * （4 个子页 controller / view、Gateway 客户端、属性测试 fixture）都应从本索引
 * 导入投影层公开 API；**不应**直接 import 兄弟文件（`./types.ts` /
 * `./projection.ts` / `./format.ts` / `./governance-detector.ts` /
 * `./term-blacklist.ts`）。
 *
 * 显式重导出（不使用 `export *`）：
 * 兄弟文件可能持有内部辅助常量 / 测试钩子（例如 `term-blacklist.ts` 中的
 * `__INTERNAL_PATTERN_SOURCE_FOR_TESTS`），这些不属于稳定公开 API。本索引以
 * 显式名称重导出，确保未来在兄弟文件中新增的内部符号不会无意经由 barrel
 * 渗漏到消费方。
 *
 * 关联文档：
 * - `.kiro/specs/enterprise-capability-usage-management/design.md` §「Runtime_Projection_Layer」
 * - `.kiro/specs/enterprise-capability-usage-management/requirements.md`（Requirement 8.2）
 */

// ─────────────────────────────────────────────────────────────────────────
// ./types — 业务语言类型与运行时常量
// ─────────────────────────────────────────────────────────────────────────

export type {
  HealthStatus,
  HealthStatusNoData,
  Robot,
  InstallRelationBusinessSource,
  InstallRelationStatus,
  InstallRelationUsageStats,
  InstallRelationEnhanced,
  RobotCapabilityUsageView,
  RobotDetailCapability,
  RobotDetailTrend30d,
  RobotDetail,
  GovernanceIssueType,
  GovernanceSuggestion,
  GovernanceIssueEvidence,
  GovernanceIssue,
  GovernanceConfig,
} from "./types.ts";

export {
  HEALTH_STATUSES,
  HEALTH_STATUS_NO_DATA,
  INSTALL_RELATION_BUSINESS_SOURCES,
  INSTALL_RELATION_STATUSES,
  GOVERNANCE_ISSUE_TYPES,
  GOVERNANCE_SUGGESTIONS,
  DEFAULT_GOVERNANCE_CONFIG,
} from "./types.ts";

// ─────────────────────────────────────────────────────────────────────────
// ./term-blacklist — 术语黑名单守卫
// ─────────────────────────────────────────────────────────────────────────

export type { BlacklistedTerm } from "./term-blacklist.ts";

export {
  TERM_BLACKLIST,
  BLACKLIST_DOWNGRADE_PLACEHOLDER,
  scanText,
  scanNode,
  assertNoBlacklistedTerm,
} from "./term-blacklist.ts";

// ─────────────────────────────────────────────────────────────────────────
// ./projection — Runtime → Enterprise 投影函数
// ─────────────────────────────────────────────────────────────────────────

export type {
  ProjectBindingToInstallRelationContext,
  BuildRobotCapabilityUsageViewInput,
} from "./projection.ts";

export {
  projectRuntimeHealthToEnterprise,
  projectRuntimeAgentToRobot,
  projectBindingToInstallRelation,
  projectTelemetryToBusinessMetrics,
  buildRobotCapabilityUsageView,
  assertViewIsBusinessClean,
} from "./projection.ts";

// ─────────────────────────────────────────────────────────────────────────
// ./format — 业务降级展示格式器
// ─────────────────────────────────────────────────────────────────────────

export {
  FORMAT_NO_DATA_PLACEHOLDER,
  formatSuccessRate,
  formatExecutions,
  formatHealthStatus,
  formatLastActiveAt,
} from "./format.ts";

// ─────────────────────────────────────────────────────────────────────────
// ./governance-detector — 业务语言治理问题检测器
// ─────────────────────────────────────────────────────────────────────────

export type { CapabilityMetadataForGovernance } from "./governance-detector.ts";

export { detectGovernanceIssues } from "./governance-detector.ts";
