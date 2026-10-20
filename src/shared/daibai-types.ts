export const SUPPORT_CASE_CATEGORY_VALUES = [
  "unknown",
  "skill_authoring",
  "feature_request",
  "bug_report",
  "usage_question",
  "governance",
  "blueprint",
  "integration",
] as const;

export type SupportCaseCategory = (typeof SUPPORT_CASE_CATEGORY_VALUES)[number];

export const SUPPORT_CASE_STATUS_VALUES = [
  "open",
  "triaged",
  "waiting_platform",
  "waiting_user",
  "resolved",
  "closed",
] as const;

export type SupportCaseStatus = (typeof SUPPORT_CASE_STATUS_VALUES)[number];

export type SupportCaseRelatedEntities = {
  agentId?: string;
  blueprintId?: string;
  spaceId?: string;
  onboardingStep?: string;
};

export type SupportCaseContextBundle = {
  userMessage: string;
  sourceSessionKey?: string;
  onboardingSummary?: {
    currentStep?: string;
    nextStep?: string;
    hasExperiencedValue?: boolean;
  };
  recentPlanSummary?: string;
  recentExecutionSummary?: string;
  blueprintSummary?: {
    blueprintId?: string;
    version?: string;
    status?: string;
  };
  errorEvidence?: string[];
};

export type SupportCaseResolutionProposal = {
  proposalVersion: number;
  userFacingReply: string;
  recommendedActionId?: string;
  executePayload?: Record<string, unknown>;
  requiresUserConfirmation: boolean;
  updatedAtMs: number;
};

export type SupportCase = {
  caseId: string;
  userId: string;
  tenantId?: string;
  sourceSessionKey?: string;
  category: SupportCaseCategory;
  status: SupportCaseStatus;
  userProblem: string;
  daibaiSummary: string;
  contextBundle: SupportCaseContextBundle;
  relatedEntities?: SupportCaseRelatedEntities;
  platformAssignee?: string;
  platformNotes?: string;
  resolutionProposal?: SupportCaseResolutionProposal;
  currentProposalVersion?: number;
  proposalSeenByUserVersion?: number;
  createdAtMs: number;
  updatedAtMs: number;
};

export type SupportCaseSummary = Pick<
  SupportCase,
  | "caseId"
  | "category"
  | "status"
  | "userProblem"
  | "userId"
  | "tenantId"
  | "updatedAtMs"
  | "currentProposalVersion"
  | "proposalSeenByUserVersion"
>;

export type DaibaiSuggestedAction = {
  /**
   * 动作标识。由 Action Catalog 在运行期校验（见 src/shared/daibai-action-catalog.ts），
   * 不再用字面量联合，以支持目录扩展。
   */
  actionId: string;
  label: string;
  description: string;
  payload?: Record<string, unknown>;
};

/**
 * 意图分级（决策：解决者/代办者/衔接者三级路由）。
 * - self_serve：可在用户授权内只读自助直接答；
 * - assisted_action：需用户确认的代办写动作；
 * - escalate：超出授权，收敛为支持单升级平台。
 */
export type DaibaiIntentTier = "self_serve" | "assisted_action" | "escalate";

/** 升级草稿：自助/代办失败时收敛升级，自动携带上下文。 */
export type DaibaiEscalationDraft = {
  /** 建议的支持单分类。 */
  category?: SupportCaseCategory;
  /** 自动采集的上下文 bundle（升级时直接喂给 support.case.create）。 */
  contextBundle: SupportCaseContextBundle;
};

/** 意图路由结果（ask 内部产出，附加到 DaibaiAskResult）。 */
export type DaibaiRouteResult = {
  tier: DaibaiIntentTier;
  /** 命中的能力域（如 knowledge / capability / billing / model-access）。 */
  domain?: string;
  /** 只读自助时，委派只读 RPC 的结果载荷。 */
  readPayload?: Record<string, unknown>;
  /** 可执行的建议动作（assisted_action）。 */
  suggestedActions: DaibaiSuggestedAction[];
  /** 升级草稿（escalate）。 */
  escalationDraft?: DaibaiEscalationDraft;
};

export type DaibaiSupportContext = {
  openCaseCount: number;
  waitingOnUserCount: number;
  latestCase?: SupportCaseSummary | null;
  cases: SupportCaseSummary[];
};

export type DaibaiLatestProposal = {
  caseId: string;
  proposalVersion: number;
  userFacingReply: string;
  recommendedActionId?: string;
  requiresUserConfirmation: boolean;
  seenByUser: boolean;
};

export type DaibaiWorkspaceCurrentSpaceSummary = {
  groupId: string;
  title: string;
  memberCount: number;
  humanCount: number;
  botCount: number;
  humans: string[];
  bots: string[];
};

export type DaibaiWorkspaceOverview = {
  visibleRobotCount: number;
  visibleSpaceCount: number;
  currentSpace?: DaibaiWorkspaceCurrentSpaceSummary;
};

export type DaibaiGuideCapabilityItem = {
  id: string;
  name: string;
  summary: string;
};

export type DaibaiGuideRecommendation = {
  capabilityId: string;
  name: string;
  reason: string;
};

/** 能力发现引导快照（Phase 6：基于实际可见能力，非写死清单）。 */
export type DaibaiGuideSnapshot = {
  headline: string;
  availableNow: DaibaiGuideCapabilityItem[];
  recommendations: DaibaiGuideRecommendation[];
  nextSteps: string[];
  stewardActions: Array<{ actionId: string; title: string; kind: "read" | "write" }>;
};

export type DaibaiAskPresentation = "onboarding" | "default";

export type DaibaiAskResult = {
  summary: string;
  rationale?: string;
  supportContext?: DaibaiSupportContext;
  latestProposal?: DaibaiLatestProposal;
  workspaceOverview?: DaibaiWorkspaceOverview;
  suggestedActions: DaibaiSuggestedAction[];
  /** 意图路由结果（解决者/代办者/衔接者分级）。 */
  route?: DaibaiRouteResult;
  /** 能力发现引导（Phase 6）。 */
  guide?: DaibaiGuideSnapshot;
  /** UI 呈现模式：onboarding 时收敛为入门卡片，隐藏支持单/升级等技术块。 */
  presentation?: DaibaiAskPresentation;
};

/**
 * 待确认动作的服务端票据（决策 G：防重放/幂等/防篡改）。
 * 首调（命中 requiresUserConfirmation）随 `pending_confirmation` 返回；
 * 二次 execute 必须回带 proposalId + confirmationToken。
 */
export type DaibaiConfirmationEnvelope = {
  proposalId: string;
  confirmationToken: string;
  /** 绑定将执行参数的哈希，二次执行时比对，防篡改。 */
  payloadHash: string;
  /** 过期时间（epoch ms）。 */
  expiresAtMs: number;
};

export type DaibaiExecuteStatus = "executed" | "blocked" | "pending_confirmation";

/** 确认卡片展示明细（决策 G + 8.4 UX 验收：信息密度）。 */
export type DaibaiConfirmationDetail = {
  /** 动作名称（人类可读标题）。 */
  title: string;
  /** 影响范围简述。 */
  impact?: string;
  /** 二级权限提示（如 usage:budget）；仅作展示提示，不承担鉴权。 */
  secondaryPermission?: string;
  /** 是否不可逆/破坏性动作。 */
  irreversible: boolean;
  /** 票据过期时间（epoch ms），供前端展示过期提示。 */
  expiresAtMs: number;
};

export type DaibaiExecuteResult = {
  actionId: string;
  status: DaibaiExecuteStatus;
  message: string;
  caseId?: string;
  supportCase?: SupportCase;
  /** status === "pending_confirmation" 时返回，前端据此渲染独立确认卡片。 */
  confirmation?: DaibaiConfirmationEnvelope;
  /** status === "pending_confirmation" 时返回，确认卡片展示明细（动作名/影响/权限/不可逆/过期）。 */
  confirmationDetail?: DaibaiConfirmationDetail;
  /** blocked 时可选附带升级草稿，便于一键转支持单（Phase 7）。 */
  escalationDraft?: DaibaiEscalationDraft;
  /** supervisor.task.create 成功后返回，供聊天卡片与看板深链。 */
  supervisorTaskId?: string;
  supervisorTask?: {
    taskId: string;
    goal: string;
    state: string;
    repoRoot: string;
  };
};
