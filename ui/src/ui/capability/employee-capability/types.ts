export const CAPABILITY_SHARE_VISIBILITIES = [
  "私有",
  "已共享到协作小组",
  "审核中",
  "需要修改后再次提交",
  "已进入企业资产库",
  "即将下线",
  "已下线",
] as const;

export type CapabilityShareVisibility = (typeof CAPABILITY_SHARE_VISIBILITIES)[number];

export const CAPABILITY_HEALTH_LABELS = ["运行稳定", "偶尔异常", "需要重新整理"] as const;

export type CapabilityHealthLabel = (typeof CAPABILITY_HEALTH_LABELS)[number];

export const CAPABILITY_MATURITY_LABELS = [
  "初步形成",
  "稳定使用",
  "多人复用",
  "企业认证",
  "企业标准",
  "核心资产",
] as const;

export type CapabilityMaturityLabel = (typeof CAPABILITY_MATURITY_LABELS)[number];

export type CapabilityAttribution = {
  sourceRobot: { id: string; name: string };
  sourceTaskSummary: string;
  firstFormedScenario: string;
  highFrequencyScenarios: string[];
};

export type CapabilityUsageBrief = {
  robots: Array<{ id: string; name: string }>;
  totalUsageCount: number;
  lastUsedAt: number | null;
};

export type CapabilityUpdateRecap = {
  id: string;
  at: number;
  headline: string;
};

export type CapabilityVersionInfo = {
  currentVersion: string;
  versionCount: number;
  submittedVersion: string | null;
};

export type CapabilityUsageMetrics = {
  robotCount: number;
  groupCount: number;
  totalUsageCount: number;
  lastUsedAt: number | null;
};

export type CapabilityEnterpriseLifecycleStage =
  | "draft"
  | "shared"
  | "under_review"
  | "needs_revision"
  | "registered"
  | "sunsetting"
  | "offline";

export type CapabilityEnterpriseLifecycle = {
  stage: CapabilityEnterpriseLifecycleStage;
  stageLabel: string;
  nextStep: string | null;
  proposalId?: string;
  registryManifestId?: string;
  submittedAt?: number | null;
  reviewedAt?: number | null;
  reviewerId?: string | null;
  reviewerNote?: string | null;
};

export type CapabilityEnterpriseReview = {
  proposalId?: string;
  registryManifestId?: string;
  statusLabel: string;
  nextStep: string;
  submittedAt?: number | null;
  reviewedAt?: number | null;
  reviewerId?: string | null;
  reviewerNote?: string | null;
};

export type EmployeeCapabilityInstallSource =
  | "platform-marketplace"
  | "enterprise-distributed"
  | "external-local"
  | "dabai-proxy"
  | "robot-self";

export const EMPLOYEE_CAPABILITY_INSTALL_SOURCES: readonly EmployeeCapabilityInstallSource[] = [
  "platform-marketplace",
  "enterprise-distributed",
  "external-local",
  "dabai-proxy",
  "robot-self",
] as const;

export type EmployeeCapabilityConfigurationState = "not-required" | "pending" | "complete";

export const EMPLOYEE_CAPABILITY_CONFIGURATION_STATES: readonly EmployeeCapabilityConfigurationState[] =
  ["not-required", "pending", "complete"] as const;

export type EmployeeCapabilityGovernanceState =
  | "none"
  | "restricted"
  | "review-required"
  | "disabled";

export const EMPLOYEE_CAPABILITY_GOVERNANCE_STATES: readonly EmployeeCapabilityGovernanceState[] = [
  "none",
  "restricted",
  "review-required",
  "disabled",
] as const;

export type CapabilityInstallRecord = {
  /** 安装请求 ID */
  requestId: string;
  /** 目标机器人 ID */
  robotId: string;
  /** 目标机器人名称 */
  robotName: string;
  /** 安装来源 */
  installSource: EmployeeCapabilityInstallSource;
  /** 安装时间 */
  installedAt: number;
  /** 当前配置状态 */
  configurationState: EmployeeCapabilityConfigurationState;
  /** 当前治理状态 */
  governanceState: EmployeeCapabilityGovernanceState;
};

export type CapabilityShareHistoryEntry = {
  /** 唯一分享记录 ID */
  shareId: string;
  /** 目标协作小组 ID */
  groupId: string;
  /** 目标协作小组名称（无法解析时回退为 groupId） */
  groupName: string;
  /** 分享者显示名称 */
  sharedByDisplayName: string;
  /** 分享时间戳（毫秒） */
  sharedAt: number;
};

export type CapabilitySummary = {
  id: string;
  name: string;
  summary: string;
  assetType?:
    | "prompt"
    | "template"
    | "workflow"
    | "knowledge"
    | "agent"
    | "capability"
    | "tool"
    | "mcp";
  usageExamples: string[];
  inputDescription: string;
  outputDescription: string;
  tags: string[];
  category: string;
  avatar: string | null;
  health: CapabilityHealthLabel;
  shareVisibility: CapabilityShareVisibility;
  maturity: CapabilityMaturityLabel | null;
  attribution: CapabilityAttribution;
  usage: CapabilityUsageBrief;
  usageMetrics: CapabilityUsageMetrics;
  recentUpdate: CapabilityUpdateRecap | null;
  versionInfo: CapabilityVersionInfo;
  isDraft: boolean;
  createdAt: number;
  updatedAt: number;
  applicationSummary?: string;
  feedbackSummary?: string;
  enterpriseReview?: CapabilityEnterpriseReview | null;
  enterpriseLifecycle?: CapabilityEnterpriseLifecycle | null;
  sourceContextLabel?: string;
  optimizationTargets?: Array<{
    kind: "robot" | "group";
    id: string;
    name: string;
  }>;
  /** 安装来源（能力安装治理新增） */
  installSource?: EmployeeCapabilityInstallSource;
  /** 配置状态（能力安装治理新增） */
  configurationState?: EmployeeCapabilityConfigurationState;
  /** 治理状态（能力安装治理新增） */
  governanceState?: EmployeeCapabilityGovernanceState;
  /** 已绑定的机器人 ID 列表（能力安装治理新增） */
  boundRobotIds?: string[];
  /** 安装请求历史（能力安装治理新增） */
  installRequestHistory?: CapabilityInstallRecord[];
  /** 脱敏状态（能力安装治理新增） */
  sanitizationState?: "not-started" | "in-progress" | "complete" | "failed";
  /** 规范内容填充 / 资产准入状态（资产孵化通道新增） */
  incubationReadiness?: {
    /** 是否已按类型规范完成全部内容填充 */
    ready: boolean;
    /** 是否通过硬门槛（价值身份内容不缺失/不占位），可被纳入孵化通道 */
    admissible: boolean;
    gaps: Array<{ field: string; label: string; severity: "block" | "recommend" }>;
    reasons: string[];
  };
  /** 分享归因历史（能力生命周期闭环：让分享可感知、可追溯 —— 谁/何时/分享到哪个组） */
  shareHistory?: CapabilityShareHistoryEntry[];
};

export type RobotCapabilityProfile = {
  robotId: string;
  whatItCanDo: CapabilitySummary[];
  goodAt: string[];
  recentlyLearned: Array<{
    capabilityId: string;
    name: string;
    at: number;
  }>;
  sourcesOfAccumulation: Array<{ label: string; count: number }>;
};

export type QuickCapabilitySaveFormData = {
  name: string;
  summary: string;
};

export const ENTERPRISE_ASSET_PACKAGE_TYPES = [
  "single_capability",
  "template_pack",
  "workflow_pack",
  "knowledge_pack",
  "automation_pack",
  "composite_pack",
] as const;

export type EnterpriseAssetPackageType = (typeof ENTERPRISE_ASSET_PACKAGE_TYPES)[number];

export const ENTERPRISE_ASSET_EXECUTION_MODES = [
  "assistive",
  "semi_automatic",
  "automatic",
] as const;

export type EnterpriseAssetExecutionMode = (typeof ENTERPRISE_ASSET_EXECUTION_MODES)[number];

export const ENTERPRISE_ASSET_RISK_TAGS = [
  "external_publish",
  "credential_required",
  "brand_risk",
  "customer_data",
  "manual_review_required",
] as const;

export type EnterpriseAssetRiskTag = (typeof ENTERPRISE_ASSET_RISK_TAGS)[number];

export type EnterpriseAssetPackageDraft = {
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
