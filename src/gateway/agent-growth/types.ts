/**
 * Agent Growth OS — 核心类型（spec: agent-growth-lifecycle, P0A 任务 1.1）。
 *
 * 设计铁律（design.md v3）：
 * - Bootstrap ≠ Growth：`BootstrapStatus`（技术初始化）与 `GrowthStatus`（产品成长）分离。
 * - Lifecycle ⊥ Dimension：`lifecycleState`（互斥生命周期）与 `dimensions`（并行 0–100 维度）不合并为单一 `stage`。
 * - 评审决策（RISK-007）：capabilityReadiness 信号三态化，OAuth 在 P0A 恒为 `"unknown"`，不计分不阻塞。
 */

/** 互斥生命周期：时间轴上的阶段。 */
export type LifecycleState = "birth" | "growing" | "mission_ready" | "activated" | "evolution";

/** 并行成长维度：0–100，非互斥。`alignment` 仅协作小组使用。 */
export type GrowthDimension = {
  identity: number;
  capability: number;
  knowledge: number;
  habits: number;
  alignment?: number;
};

/** 技术初始化状态（章程、记忆、workspace 骨架）——与 Growth 无关。 */
export type BootstrapStatus = {
  initialized: boolean;
  bootstrappedAtMs?: number | null;
  bootstrapMemoryId?: string | null;
  charterCapsuleId?: string | null;
  workspaceInitialized?: boolean;
};

/** 成长漏斗时间戳集合（first-write-wins，见 milestones.ts）。 */
export type GrowthMilestones = {
  createdAtMs: number;
  sessionOpenedAtMs?: number | null;
  birthPreludeShownAtMs?: number | null;
  firstCtaClickedAtMs?: number | null;
  identityCompletedAtMs?: number | null;
  firstSkillInstalledAtMs?: number | null;
  firstPermissionGrantedAtMs?: number | null;
  firstKnowledgeUploadedAtMs?: number | null;
  rolesAssignedAtMs?: number | null;
  workflowDefinedAtMs?: number | null;
  alignmentCompletedAtMs?: number | null;
  missionReadyAtMs?: number | null;
  firstMissionSentAtMs?: number | null;
  firstMissionSuccessAtMs?: number | null;
  activatedAtMs?: number | null;
};

/** 漏斗里程碑键（record-growth-milestone 入参）。 */
export type GrowthMilestoneKey = Exclude<keyof GrowthMilestones, "createdAtMs"> | "createdAtMs";

/** 业务影响指标（Growth Report 核心）。 */
export type ImpactMetric = {
  key: string;
  value: number;
  unit?: string;
  description: string;
};

/** 成长报告快照（P0A 预留 schema；P2 填充）。 */
export type GrowthReportSnapshot = {
  periodDays: number;
  generatedAtMs: number;
  tasksCompleted: number;
  hoursSavedEstimate?: number | null;
  learningMaterialsCount: number;
  toolInvocations: number;
  collaborationMemberCount?: number | null;
  taskSuccessRate?: number | null;
  toolSuccessRate?: number | null;
  humanTakeoverRate?: number | null;
  businessImpact: ImpactMetric[];
  topInsights?: string[];
  suggestedWorkflows?: string[];
};

/** 能力需求项（AgentTemplate.requiredCapabilities）。 */
export type CapabilityRequirementKind = "skill" | "oauth" | "knowledge_binding" | "workflow";

export type CapabilityRequirement = {
  key: string;
  kind: CapabilityRequirementKind;
  label: string;
  /** false = 加分项；true = Mission Ready 硬门槛候选。 */
  required: boolean;
};

/** 维度权重（加权得出 activationScore）。 */
export type DimensionWeights = {
  identity: number;
  capability: number;
  knowledge: number;
  habits: number;
  alignment?: number;
};

/** 角色蓝图模板。 */
export type AgentTemplate = {
  templateId: string;
  version: string;
  displayName: string;
  roleBlueprint?: string;
  dimensionWeights: DimensionWeights;
  requiredCapabilities: CapabilityRequirement[];
  knowledgeExpectations?: {
    minBindings: number;
    preferredTags: string[];
  };
  /** Mission Ready activationScore 阈值（默认 78）。 */
  missionReadyThreshold: number;
  /** capabilityReadiness 要求的最低 identity 维度（默认 60）。 */
  minIdentity?: number;
};

/** 协作小组工作流步骤（Alignment.workflowDefined）。 */
export type WorkflowStep = {
  role: string;
  action: string;
  handsOffTo?: string;
};

export type TeamWorkflow = {
  steps: WorkflowStep[];
};

/** 团队模板（继承 AgentTemplate + 协作默认值）。 */
export type TeamTemplate = AgentTemplate & {
  defaultCollaborationRoles: string[];
  defaultWorkflowSteps: WorkflowStep[];
};

/**
 * Capability Readiness 信号（评审决策 / RISK-007）。
 * `requiredPermissionsGranted` 必须三态：
 *  - `true`    已授权
 *  - `false`   已检测未授权
 *  - `"unknown"` Provider 尚未接入（P0A 恒为此值，不计分不阻塞）
 */
export type CapabilityReadinessSignals = {
  requiredSkillsInstalled: boolean;
  requiredPermissionsGranted: true | false | "unknown";
};

/**
 * P1 任务驱动缺口：待续跑的任务上下文（非 FWW，可覆盖更新）。
 * taskGaps 仅 skill；status 随安装进度由 recompute/analyze 刷新。
 */
export type GrowthPendingTaskContext = {
  draftText: string;
  source: "composer" | "sent_mission";
  suggestedSkillKeys: string[];
  taskGaps: Array<{
    key: string;
    label: string;
    kind: "skill";
    status: "missing" | "satisfied";
  }>;
  extractedAtMs: number;
  extractStatus: "ready" | "failed_fallback";
};

/** 核心成长状态（机器人持久化于 growth-status.json；小组存于 operating-state）。 */
export type GrowthStatus = {
  lifecycleState: LifecycleState;
  dimensions: GrowthDimension;
  birthAtMs: number;

  // 双评分
  activationScore: number;
  /** 实战表现（P2 起算，P0 恒为 null；序列化契约：number | null，非 optional-undefined）。 */
  operationalScore: number | null;
  capabilityReadiness: boolean;

  // 激活判定
  isActivated: boolean;
  activatedAtMs?: number | null;

  // 模板绑定
  templateId?: string | null;
  templateVersion?: string | null;

  // UI 控制
  awakeningShownAtMs?: number | null;
  preludeDismissedAtMs?: number | null;

  // 小组 Alignment（仅协作小组）
  alignmentComplete?: boolean;

  /** P1：增强/跳过后待「继续原任务」的上下文。 */
  pendingTaskContext?: GrowthPendingTaskContext | null;

  milestones: GrowthMilestones;
  growthReport?: GrowthReportSnapshot;
};

/** Growth 实体引用（统一 store 读写接口）。 */
export type GrowthEntityKind = "robot" | "group";

export type GrowthEntityRef = {
  kind: GrowthEntityKind;
  entityId: string;
};
