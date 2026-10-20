/**
 * 企业能力中心（Enterprise Capability Center）核心类型定义。
 *
 * 本文件为企业资产层（Enterprise Asset Layer）的纯类型定义，
 * 严格遵循 EnterpriseCapabilityProjection 原则：不包含任何运行时字段
 * （prompt、workflow json、toolchain、model routing、provider、
 * memory strategy、execution policy、routing hints、model preferences），
 * 仅暴露业务语言视图。
 *
 * 设计原则：
 * - 仅导出 `type` 别名，不使用 `interface`
 * - 枚举以字面量联合 + `as const` 数组形式导出
 * - 不从本目录外引入任何依赖，保证纯类型层可独立复用
 */

/** 企业能力资产生命周期 */
export type AssetLifecycle =
  | "submitted" // 已提交（待审核）
  | "reviewing" // 审核中
  | "approved" // 已通过
  | "published" // 已发布
  | "deprecated" // 即将下线
  | "retired"; // 已下线

export const ASSET_LIFECYCLES: readonly AssetLifecycle[] = [
  "submitted",
  "reviewing",
  "approved",
  "published",
  "deprecated",
  "retired",
] as const;

/** 能力领域（业务领域分组，用于构建"企业能力版图"视图） */
export type CapabilityDomain = "销售" | "HR" | "客服" | "财务" | "法务" | "数据分析";

export const CAPABILITY_DOMAINS: readonly CapabilityDomain[] = [
  "销售",
  "HR",
  "客服",
  "财务",
  "法务",
  "数据分析",
] as const;

/**
 * 能力成熟度（6 级）：
 * 初步形成(1) < 稳定使用(2) < 多人复用(3) < 企业认证(4) < 企业标准(5) < 核心资产(6)
 * 其中"企业认证"与"企业标准"需企业管理员主动授予。
 */
export type CapabilityMaturity =
  | "初步形成"
  | "稳定使用"
  | "多人复用"
  | "企业认证"
  | "企业标准"
  | "核心资产";

export const CAPABILITY_MATURITY_LEVELS: readonly CapabilityMaturity[] = [
  "初步形成",
  "稳定使用",
  "多人复用",
  "企业认证",
  "企业标准",
  "核心资产",
] as const;

/**
 * 能力健康状态（业务效果语言，严禁使用工程术语如 healthy/warning/broken）
 */
export type EnterpriseHealthStatus =
  | "效果稳定"
  | "偶尔结果不理想"
  | "建议重新整理"
  | "已不适合继续推广";

export const ENTERPRISE_HEALTH_STATUSES: readonly EnterpriseHealthStatus[] = [
  "效果稳定",
  "偶尔结果不理想",
  "建议重新整理",
  "已不适合继续推广",
] as const;

/**
 * 企业能力价值摘要：展示层必须以业务语言呈现
 * （"本月已被调用 N 次"、"已覆盖 N 个部门"、"近 30 天复用增长 +N%"）。
 */
export type EnterpriseCapabilityValueSummary = {
  /** 本月调用次数 */
  monthlyExecutions: number;
  /** 覆盖机器人数（字段名 departmentCount 为兼容） */
  departmentCoverageCount: number;
  /** 近 30 天复用增长率（百分比，允许负值） */
  reuseGrowthRate30d: number;
};

/** 可信度指标：能力在真实业务场景中的验证证据 */
export type CredibilityIndicators = {
  /** 已验证使用部门列表 */
  verifiedDepartments: string[];
  /** 生产环境使用天数 */
  productionUsageDays: number;
};

/**
 * 适用对象范围（ApplicableScope）：能力发布后的可见与可安装范围。
 * 采用可辨识联合类型（discriminated union），以便穷尽匹配。
 */
export type ApplicableScope =
  | { kind: "enterprise" }
  | { kind: "department"; id: string; name: string }
  | { kind: "group"; id: string; name: string }
  | { kind: "role"; id: string; name: string };

/** 企业复用数据：能力在企业内的复用统计 */
export type EnterpriseReuseData = {
  /** 使用机器人数 */
  robotCount: number;
  /** 使用员工数 */
  employeeCount: number;
  /** 覆盖机器人数（字段名 departmentCount 为兼容） */
  departmentCount: number;
  /** 近 30 天每日使用量 */
  trend30Days: number[];
  /** 环比增长百分比（允许负值） */
  growthPercentage: number;
};

/** 贡献记录：员工向企业提交/修改/补充能力的单次行为记录 */
export type ContributionRecord = {
  id: string;
  employeeId: string;
  employeeName: string;
  timestamp: number;
  /** 贡献类型 */
  type: "初始提交" | "内容修改" | "场景补充";
  /** 贡献摘要（员工语言，≤200 字） */
  summary: string;
};

/** 审核记录：企业管理员对能力提交的单次审核结果 */
export type ReviewRecord = {
  id: string;
  reviewerId: string;
  reviewerName: string;
  timestamp: number;
  /** 审核结果 */
  result: "通过" | "拒绝" | "需修改";
  /** 审核意见（拒绝/需修改时最少 10 字） */
  opinion: string;
};

/** 来源信息：能力最初形成的完整溯源链路 */
export type SourceInfo = {
  employee: { id: string; name: string };
  robot: { id: string; name: string };
  task: { id: string; summary: string };
};

/**
 * 企业能力资产（完整详情）：经投影层处理后的业务能力视图。
 * 不包含任何运行时字段；所有管理员可见界面均应基于此类型渲染。
 */
export type EnterpriseCapabilityAsset = {
  id: string;
  name: string;
  description: string;
  usageScenarios: string[];
  applicableScope: ApplicableScope;
  domain: CapabilityDomain;
  maturity: CapabilityMaturity;
  healthStatus: EnterpriseHealthStatus;
  /** 为 true 时，手动设置的健康状态不被自动遥测映射覆盖 */
  healthManualLock: boolean;
  /** 为 true 时，尚无任何运行时健康遥测数据（新上架或从未被调用） */
  healthNoTelemetry: boolean;
  /** 员工资产类型；缺省视为普通能力。MCP 进入独立模块。 */
  assetType?:
    | "prompt"
    | "template"
    | "workflow"
    | "knowledge"
    | "agent"
    | "capability"
    | "tool"
    | "mcp";
  mcpServerName?: string | null;
  lifecycle: AssetLifecycle;
  valueSummary: EnterpriseCapabilityValueSummary;
  credibilityIndicators: CredibilityIndicators;
  reuseData: EnterpriseReuseData;
  source: SourceInfo;
  /** 贡献历史：按时间正序排列 */
  contributionHistory: ContributionRecord[];
  /** 审核历史：存储按时间正序，展示层按时间倒序渲染 */
  reviewHistory: ReviewRecord[];
  avatar: string | null;
  createdAt: number;
  updatedAt: number;
};

/**
 * 能力资产列表项（列表投影）：仅包含列表表格展示所需字段，
 * 避免详情页字段（如完整的 contributionHistory / reviewHistory）参与列表渲染。
 */
export type EnterpriseAssetListItem = {
  id: string;
  name: string;
  description: string;
  usageScenarios: string[];
  applicableScope: ApplicableScope;
  domain: CapabilityDomain;
  maturity: CapabilityMaturity;
  healthStatus: EnterpriseHealthStatus;
  assetType?:
    | "prompt"
    | "template"
    | "workflow"
    | "knowledge"
    | "agent"
    | "capability"
    | "tool"
    | "mcp";
  mcpServerName?: string | null;
  lifecycle: AssetLifecycle;
  valueSummary: EnterpriseCapabilityValueSummary;
  reuseData: EnterpriseReuseData;
  sourceEmployeeName: string;
  avatar: string | null;
};

/** 统计仪表盘数据：首屏五指标卡片所需数据 */
export type StatisticsDashboardData = {
  totalCapabilities: number;
  publishedCapabilities: number;
  coveredEmployees: number;
  coveredRobots: number;
  monthlyUsageCount: number;
  /** 各指标的环比变化（absolute = 增减绝对数，percentage = 增减百分比） */
  changes: {
    totalCapabilities: { value: number; type: "absolute" };
    publishedCapabilities: { value: number; type: "absolute" };
    coveredEmployees: { value: number; type: "percentage" };
    coveredRobots: { value: number; type: "absolute" };
    monthlyUsageCount: { value: number; type: "percentage" };
  };
  updatedAt: number;
};

/** 安装关系记录：已建立的"能力 ↔ 机器人"关联 */
export type InstallRelation = {
  id: string;
  capabilityId: string;
  capabilityName: string;
  robotId: string;
  robotName: string;
  robotOwnerEmployeeId?: string | null;
  robotOwnerEmployeeName?: string | null;
  robotOwnerEmployeeEmail?: string | null;
  robotPositionId?: string | null;
  robotPositionTitle?: string | null;
  robotTeamLabel?: string | null;
  robotRoleCode?: string | null;
  installedAt: number;
  /** 安装来源：区分管理员推送与员工自主安装 */
  source: "管理员推送" | "员工自主安装";
  /** 安装状态 */
  status: "正常运行" | "已暂停" | "待更新";
};

/** 贡献绩效数据：按员工维度聚合的贡献指标 */
export type ContributionPerformanceItem = {
  employeeId: string;
  employeeName: string;
  department: string;
  totalContributions: number;
  approvedCount: number;
  /** 审核通过率（百分比） */
  approvalRate: number;
  /** 贡献能力的平均成熟度等级（1–6） */
  averageMaturityLevel: number;
  /** 贡献能力被复用的总机器人数 */
  totalReuseRobots: number;
  /** 贡献能力被复用的总员工数 */
  totalReuseEmployees: number;
  /** 贡献能力的平均成功率（百分比） */
  averageSuccessRate: number;
};

/** 分页状态 */
export type PaginationState = {
  currentPage: number;
  pageSize: 10 | 20 | 50;
  totalItems: number;
};

/**
 * 能力资产列表筛选器状态：5 个下拉筛选 + 关键词搜索 + "只看我可安装"开关。
 * 下拉未选择时以 null 表示"全部"。
 */
export type AssetListFilters = {
  searchQuery: string;
  usageScenario: string | null;
  applicableTarget: string | null;
  domain: CapabilityDomain | null;
  maturity: CapabilityMaturity | null;
  healthStatus: EnterpriseHealthStatus | null;
  onlyInstallable: boolean;
};

/** 快捷入口侧边栏：三个入口 */
export type SidebarEntry = "my-installed" | "my-contributed" | "all";

export const SIDEBAR_ENTRIES: readonly SidebarEntry[] = [
  "my-installed",
  "my-contributed",
  "all",
] as const;

/** 列表排序配置 */
export type AssetSortConfig = {
  field: "maturity" | "reuseValue" | "createdAt";
  direction: "asc" | "desc";
};

export type EnterpriseAssetPackageType =
  | "single_capability"
  | "template_pack"
  | "workflow_pack"
  | "knowledge_pack"
  | "automation_pack"
  | "composite_pack";

export type EnterpriseAssetExecutionMode = "assistive" | "semi_automatic" | "automatic";

export type EnterpriseAssetRiskTag =
  | "external_publish"
  | "credential_required"
  | "brand_risk"
  | "customer_data"
  | "manual_review_required";

export type EnterpriseAssetPackage = {
  packageTitle: string;
  packageSummary: string;
  assetPackageType: EnterpriseAssetPackageType;
  businessScenario: string;
  inputArtifacts: string[];
  outputArtifacts: string[];
  dependencies: string[];
  executionMode: EnterpriseAssetExecutionMode;
  riskTags: EnterpriseAssetRiskTag[];
  targetTeams: string[];
  verifiedInProduction: boolean;
  promotionIntent: "internal_reuse" | "pilot" | "enterprise_standard" | "platform_candidate";
  needsEnterpriseSecrets: boolean;
  notes: string;
};

/** 审核队列项：待审核 / 审核中任务的列表投影 */
export type ReviewQueueItem = {
  id: string;
  capabilityId: string;
  capabilityName: string;
  capabilitySummary: string;
  usageScenarios: string[];
  sourceEmployee: { id: string; name: string };
  sourceRobot: { id: string; name: string };
  sourceTaskSummary: string;
  usageCount: number;
  robotCount: number;
  lastUsedAt: number | null;
  submittedAt: number;
  status: "待审核" | "审核中";
  assetType?:
    | "prompt"
    | "template"
    | "workflow"
    | "knowledge"
    | "agent"
    | "capability"
    | "tool"
    | "mcp";
  mcpServerName?: string | null;
  enterpriseAssetPackage?: EnterpriseAssetPackage | null;
};

/** 审核评估维度：供审核人在界面上判断安全性与质量 */
export type ReviewAssessment = {
  security: {
    /** 是否涉及敏感信息 */
    sensitiveInfo: boolean;
    /** 是否包含危险操作 */
    dangerousOps: boolean;
    /** 是否存在外部调用 */
    externalCalls: boolean;
    /** 是否存在权限风险 */
    permissionRisk: boolean;
  };
  quality: {
    /** 近 30 天成功率（百分比） */
    successRate30d: number;
    /** 使用机器人数 */
    robotCount: number;
    /** 复用员工数 */
    employeeCount: number;
    /** 是否符合企业能力命名与描述规范 */
    namingCompliant: boolean;
  };
};

/**
 * 审核通过时必须同时指定的额外信息：
 * ApplicableScope（适用范围）与 CapabilityDomain（能力领域）缺一不可。
 */
export type ReviewApprovalPayload = {
  applicableScope: ApplicableScope;
  domain: CapabilityDomain;
  executionMode?: EnterpriseAssetExecutionMode;
  needsEnterpriseSecrets?: boolean;
  promoteToIncubation?: boolean;
};

/** 能力领域分布聚合：支持"企业能力版图"视图 */
export type DomainDistribution = {
  domain: CapabilityDomain;
  capabilityCount: number;
  /** 代表性能力名称，最多 3 个 */
  representativeCapabilities: string[];
  /** 领域覆盖率（百分比） */
  coverageRate: number;
};
