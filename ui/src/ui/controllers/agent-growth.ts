/**
 * Agent Growth OS — 员工端 growth telemetry controller（spec: agent-growth-lifecycle, P0B 任务 7.1）。
 *
 * 封装 Gateway growth RPC 的客户端调用（机器人 / 协作小组对称）。UI 表现层（badge / Prelude）
 * 只读这里返回的归一化 GrowthStatusView；遵循「UI ← 状态机 ← 数据」铁律，UI 不自行推导生命周期。
 *
 * 边界：仅依赖 ui/ 内类型（GatewayBrowserClient），不跨包导入 src/gateway。
 */

import type { GatewayBrowserClient } from "../gateway.ts";

export type GrowthEntityKind = "robot" | "group";

export type GrowthEntityRef = {
  kind: GrowthEntityKind;
  entityId: string;
};

export type GrowthLifecycleState =
  | "birth"
  | "growing"
  | "mission_ready"
  | "activated"
  | "evolution";

export type GrowthDimensionView = {
  identity: number;
  capability: number;
  knowledge: number;
  habits: number;
  alignment?: number;
};

export type GrowthImpactMetricView = {
  key: string;
  value: number;
  unit?: string;
  description: string;
};

/** UI 归一化的成长报告（来自 growthStatus.growthReport）。 */
export type GrowthReportView = {
  periodDays: number;
  generatedAtMs: number;
  tasksCompleted: number;
  hoursSavedEstimate: number | null;
  learningMaterialsCount: number;
  toolInvocations: number;
  collaborationMemberCount: number | null;
  taskSuccessRate: number | null;
  toolSuccessRate: number | null;
  humanTakeoverRate: number | null;
  businessImpact: GrowthImpactMetricView[];
  topInsights: string[];
  suggestedWorkflows: string[];
};

export type AgentTemplateListItemView = {
  templateId: string;
  displayName: string;
  description: string;
};

/**
 * Flip to `true` once `AgentsCreateParamsSchema` accepts optional `templateId`
 * (agent-growth instruction 4). Until then UI collects selection but omits the param.
 */
export const AGENT_CREATE_SUPPORTS_TEMPLATE_ID = true;

export type GrowthCapabilityGapView = {
  key: string;
  label: string;
  kind: "skill" | "oauth" | "knowledge_binding" | "workflow";
  status: "missing" | "pending_integration" | "satisfied";
};

export type GrowthFunnelFlagsView = {
  hasSessionOpened: boolean;
  hasIdentityCompleted: boolean;
  hasFirstSkillInstalled: boolean;
  hasFirstMissionSent: boolean;
  hasFirstMissionSuccess: boolean;
  preludeDismissed: boolean;
};

export type NextGrowthActionKind =
  | "start_work"
  | "confirm_identity"
  | "install_capabilities"
  | "verify_with_task"
  | "none";

export type NextGrowthActionView = {
  kind: NextGrowthActionKind;
  reason: string;
  priority: number;
  gaps: GrowthCapabilityGapView[];
  canSkip: boolean;
  target: {
    focusComposer?: boolean;
    prefill?: string;
    module?: "assistant" | "knowledge" | "settings";
    tab?: "skills";
    recommendedSkillKeys?: string[];
    resumePendingTask?: boolean;
  };
};

export type GrowthPendingTaskContextView = {
  draftText: string;
  source: "composer" | "sent_mission";
  suggestedSkillKeys: string[];
  taskGaps: GrowthCapabilityGapView[];
  extractedAtMs: number;
  extractStatus: "ready" | "failed_fallback";
};

/** UI 侧归一化的成长状态视图（仅保留表现层所需字段）。 */
export type GrowthStatusView = {
  lifecycleState: GrowthLifecycleState;
  dimensions: GrowthDimensionView;
  activationScore: number;
  operationalScore: number | null;
  capabilityReadiness: boolean;
  isActivated: boolean;
  templateId: string | null;
  preludeDismissedAtMs?: number | null;
  growthReport?: GrowthReportView | null;
  /** 小组 alignment 缺口（来自 milestones.rolesAssignedAtMs）。 */
  rolesAssigned?: boolean;
  /** 小组 workflow 缺口（来自 milestones.workflowDefinedAtMs）。 */
  workflowDefined?: boolean;
  milestones?: {
    sessionOpenedAtMs?: number | null;
    identityCompletedAtMs?: number | null;
    firstSkillInstalledAtMs?: number | null;
    firstMissionSentAtMs?: number | null;
    firstMissionSuccessAtMs?: number | null;
    firstCtaClickedAtMs?: number | null;
  };
  /** P0 onboarding：模板缺口 / 漏斗 / 主建议（旧客户端缺省时由 UI 降级）。 */
  capabilityGaps?: GrowthCapabilityGapView[];
  funnel?: GrowthFunnelFlagsView;
  recommendation?: NextGrowthActionView;
  /** P1：任务驱动缺口 / 续跑草稿。 */
  pendingTaskContext?: GrowthPendingTaskContextView | null;
  taskGaps?: GrowthCapabilityGapView[];
};

export const EMPTY_NEXT_GROWTH_ACTION: NextGrowthActionView = {
  kind: "none",
  reason: "growth.recommend.none",
  priority: 999,
  gaps: [],
  canSkip: true,
  target: {},
};

export function resolveGrowthRecommendation(
  view: GrowthStatusView | null | undefined,
): NextGrowthActionView {
  return view?.recommendation ?? EMPTY_NEXT_GROWTH_ACTION;
}

export type AgentGrowthClientState = {
  client: GatewayBrowserClient | null;
  connected: boolean;
};

const LIFECYCLE_STATES: ReadonlySet<string> = new Set([
  "birth",
  "growing",
  "mission_ready",
  "activated",
  "evolution",
]);

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : null;
}

function num(value: unknown, fallback = 0): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function normalizeLifecycle(value: unknown): GrowthLifecycleState {
  return typeof value === "string" && LIFECYCLE_STATES.has(value)
    ? (value as GrowthLifecycleState)
    : "birth";
}

function normalizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter(
    (entry): entry is string => typeof entry === "string" && entry.trim().length > 0,
  );
}

function normalizeImpactMetric(value: unknown): GrowthImpactMetricView | null {
  const row = asRecord(value);
  if (!row || typeof row.key !== "string") {
    return null;
  }
  const description = typeof row.description === "string" ? row.description.trim() : "";
  if (!description) {
    return null;
  }
  return {
    key: row.key,
    value: num(row.value),
    ...(typeof row.unit === "string" && row.unit.trim() ? { unit: row.unit.trim() } : {}),
    description,
  };
}

function normalizeGrowthReport(value: unknown): GrowthReportView | null {
  const report = asRecord(value);
  if (!report) {
    return null;
  }
  const businessImpact = Array.isArray(report.businessImpact)
    ? report.businessImpact
        .map(normalizeImpactMetric)
        .filter((entry): entry is GrowthImpactMetricView => entry !== null)
    : [];
  return {
    periodDays: num(report.periodDays),
    generatedAtMs: num(report.generatedAtMs),
    tasksCompleted: num(report.tasksCompleted),
    hoursSavedEstimate:
      typeof report.hoursSavedEstimate === "number" ? report.hoursSavedEstimate : null,
    learningMaterialsCount: num(report.learningMaterialsCount),
    toolInvocations: num(report.toolInvocations),
    collaborationMemberCount:
      typeof report.collaborationMemberCount === "number" ? report.collaborationMemberCount : null,
    taskSuccessRate: typeof report.taskSuccessRate === "number" ? report.taskSuccessRate : null,
    toolSuccessRate: typeof report.toolSuccessRate === "number" ? report.toolSuccessRate : null,
    humanTakeoverRate:
      typeof report.humanTakeoverRate === "number" ? report.humanTakeoverRate : null,
    businessImpact,
    topInsights: normalizeStringArray(report.topInsights),
    suggestedWorkflows: normalizeStringArray(report.suggestedWorkflows),
  };
}

function normalizeAgentTemplateListItem(value: unknown): AgentTemplateListItemView | null {
  const row = asRecord(value);
  if (!row || typeof row.templateId !== "string" || !row.templateId.trim()) {
    return null;
  }
  const displayName =
    typeof row.displayName === "string" && row.displayName.trim()
      ? row.displayName.trim()
      : row.templateId.trim();
  const description =
    typeof row.roleBlueprint === "string" && row.roleBlueprint.trim()
      ? row.roleBlueprint.trim()
      : displayName;
  return {
    templateId: row.templateId.trim(),
    displayName,
    description,
  };
}

const NEXT_ACTION_KINDS: ReadonlySet<string> = new Set([
  "start_work",
  "confirm_identity",
  "install_capabilities",
  "verify_with_task",
  "none",
]);

function positiveMs(value: unknown): boolean {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

function normalizeGap(value: unknown): GrowthCapabilityGapView | null {
  const row = asRecord(value);
  if (!row || typeof row.key !== "string" || !row.key.trim()) {
    return null;
  }
  const kind = row.kind;
  if (kind !== "skill" && kind !== "oauth" && kind !== "knowledge_binding" && kind !== "workflow") {
    return null;
  }
  const status = row.status;
  if (status !== "missing" && status !== "pending_integration" && status !== "satisfied") {
    return null;
  }
  const label =
    typeof row.label === "string" && row.label.trim() ? row.label.trim() : row.key.trim();
  return { key: row.key.trim(), label, kind, status };
}

function normalizeRecommendation(value: unknown): NextGrowthActionView {
  const row = asRecord(value);
  const kind =
    row && typeof row.kind === "string" && NEXT_ACTION_KINDS.has(row.kind)
      ? (row.kind as NextGrowthActionKind)
      : "none";
  const gaps = Array.isArray(row?.gaps)
    ? row.gaps.map(normalizeGap).filter((entry): entry is GrowthCapabilityGapView => entry !== null)
    : [];
  const target = asRecord(row?.target) ?? {};
  const recommendedSkillKeys = Array.isArray(target.recommendedSkillKeys)
    ? target.recommendedSkillKeys.filter(
        (entry): entry is string => typeof entry === "string" && entry.trim().length > 0,
      )
    : undefined;
  return {
    kind,
    reason:
      typeof row?.reason === "string" && row.reason.trim()
        ? row.reason.trim()
        : "growth.recommend.none",
    priority: num(row?.priority, 999),
    gaps,
    canSkip: row?.canSkip !== false,
    target: {
      ...(target.focusComposer === true ? { focusComposer: true } : {}),
      ...(typeof target.prefill === "string" && target.prefill.trim()
        ? { prefill: target.prefill.trim() }
        : {}),
      ...(target.module === "assistant" ||
      target.module === "knowledge" ||
      target.module === "settings"
        ? { module: target.module }
        : {}),
      ...(target.tab === "skills" ? { tab: "skills" as const } : {}),
      ...(recommendedSkillKeys?.length ? { recommendedSkillKeys } : {}),
      ...(target.resumePendingTask === true ? { resumePendingTask: true } : {}),
    },
  };
}

function normalizePendingTaskContext(value: unknown): GrowthPendingTaskContextView | null {
  const row = asRecord(value);
  if (!row || typeof row.draftText !== "string" || !row.draftText.trim()) {
    return null;
  }
  const source = row.source === "sent_mission" ? "sent_mission" : "composer";
  const extractStatus = row.extractStatus === "ready" ? "ready" : "failed_fallback";
  const suggestedSkillKeys = normalizeStringArray(row.suggestedSkillKeys);
  const taskGaps = Array.isArray(row.taskGaps)
    ? row.taskGaps
        .map(normalizeGap)
        .filter((entry): entry is GrowthCapabilityGapView => entry !== null)
    : [];
  return {
    draftText: row.draftText.trim(),
    source,
    suggestedSkillKeys,
    taskGaps,
    extractedAtMs: num(row.extractedAtMs, Date.now()),
    extractStatus,
  };
}

function normalizeFunnel(
  value: unknown,
  growth: Record<string, unknown>,
  milestones: Record<string, unknown>,
): GrowthFunnelFlagsView {
  const row = asRecord(value);
  if (row) {
    return {
      hasSessionOpened: row.hasSessionOpened === true,
      hasIdentityCompleted: row.hasIdentityCompleted === true,
      hasFirstSkillInstalled: row.hasFirstSkillInstalled === true,
      hasFirstMissionSent: row.hasFirstMissionSent === true,
      hasFirstMissionSuccess: row.hasFirstMissionSuccess === true,
      preludeDismissed: row.preludeDismissed === true,
    };
  }
  return {
    hasSessionOpened: positiveMs(milestones.sessionOpenedAtMs),
    hasIdentityCompleted: positiveMs(milestones.identityCompletedAtMs),
    hasFirstSkillInstalled: positiveMs(milestones.firstSkillInstalledAtMs),
    hasFirstMissionSent: positiveMs(milestones.firstMissionSentAtMs),
    hasFirstMissionSuccess:
      positiveMs(milestones.firstMissionSuccessAtMs) || growth.isActivated === true,
    preludeDismissed: positiveMs(growth.preludeDismissedAtMs),
  };
}

/** 将 RPC 返回的 growthStatus 归一化为 UI 视图；非法输入返回 null。 */
export function normalizeGrowthStatus(value: unknown): GrowthStatusView | null {
  const root = asRecord(value);
  if (!root) {
    return null;
  }
  const growth = asRecord(root.growthStatus) ?? root;
  const dims = asRecord(growth.dimensions) ?? {};
  const alignment = dims.alignment;
  const milestones = asRecord(growth.milestones) ?? {};
  const preludeDismissedAtMs =
    typeof growth.preludeDismissedAtMs === "number" ? growth.preludeDismissedAtMs : null;
  const rolesAssignedAtMs = milestones.rolesAssignedAtMs;
  const workflowDefinedAtMs = milestones.workflowDefinedAtMs;
  const growthReport = normalizeGrowthReport(growth.growthReport);
  const capabilityGaps = Array.isArray(root.capabilityGaps)
    ? root.capabilityGaps
        .map(normalizeGap)
        .filter((entry): entry is GrowthCapabilityGapView => entry !== null)
    : [];
  return {
    lifecycleState: normalizeLifecycle(growth.lifecycleState),
    dimensions: {
      identity: num(dims.identity),
      capability: num(dims.capability),
      knowledge: num(dims.knowledge),
      habits: num(dims.habits),
      ...(typeof alignment === "number" ? { alignment: num(alignment) } : {}),
    },
    activationScore: num(growth.activationScore),
    operationalScore: typeof growth.operationalScore === "number" ? growth.operationalScore : null,
    capabilityReadiness: growth.capabilityReadiness === true,
    isActivated: growth.isActivated === true,
    templateId: typeof growth.templateId === "string" ? growth.templateId : null,
    preludeDismissedAtMs,
    growthReport,
    rolesAssigned: typeof rolesAssignedAtMs === "number" && rolesAssignedAtMs > 0,
    workflowDefined: typeof workflowDefinedAtMs === "number" && workflowDefinedAtMs > 0,
    milestones: {
      sessionOpenedAtMs:
        typeof milestones.sessionOpenedAtMs === "number" ? milestones.sessionOpenedAtMs : null,
      identityCompletedAtMs:
        typeof milestones.identityCompletedAtMs === "number"
          ? milestones.identityCompletedAtMs
          : null,
      firstSkillInstalledAtMs:
        typeof milestones.firstSkillInstalledAtMs === "number"
          ? milestones.firstSkillInstalledAtMs
          : null,
      firstMissionSentAtMs:
        typeof milestones.firstMissionSentAtMs === "number"
          ? milestones.firstMissionSentAtMs
          : null,
      firstMissionSuccessAtMs:
        typeof milestones.firstMissionSuccessAtMs === "number"
          ? milestones.firstMissionSuccessAtMs
          : null,
      firstCtaClickedAtMs:
        typeof milestones.firstCtaClickedAtMs === "number" ? milestones.firstCtaClickedAtMs : null,
    },
    capabilityGaps,
    funnel: normalizeFunnel(root.funnel, growth, milestones),
    recommendation: normalizeRecommendation(root.recommendation),
    pendingTaskContext: normalizePendingTaskContext(
      growth.pendingTaskContext ?? root.pendingTaskContext,
    ),
    taskGaps: Array.isArray(root.taskGaps)
      ? root.taskGaps
          .map(normalizeGap)
          .filter((entry): entry is GrowthCapabilityGapView => entry !== null)
      : undefined,
  };
}

function methodFor(kind: GrowthEntityKind, suffix: "get" | "recompute" | "record"): string {
  const map = {
    get: { robot: "agents.get-growth-status", group: "collaboration.spaces.get-growth-status" },
    recompute: {
      robot: "agents.recompute-growth",
      group: "collaboration.spaces.recompute-growth",
    },
    record: {
      robot: "agents.record-growth-milestone",
      group: "collaboration.spaces.record-growth-milestone",
    },
  } as const;
  return map[suffix][kind];
}

function paramsFor(ref: GrowthEntityRef, extra?: Record<string, unknown>): Record<string, unknown> {
  const idKey = ref.kind === "robot" ? "agentId" : "groupId";
  return { [idKey]: ref.entityId, ...extra };
}

/** 读取成长状态（机器人 / 小组）。未连接或失败返回 null。 */
export async function loadGrowthStatus(
  state: AgentGrowthClientState,
  ref: GrowthEntityRef,
  options?: { preferCultivate?: boolean },
): Promise<GrowthStatusView | null> {
  if (!state.client || !state.connected) {
    return null;
  }
  try {
    const result = await state.client.request(
      methodFor(ref.kind, "get"),
      paramsFor(ref, options?.preferCultivate === true ? { preferCultivate: true } : undefined),
    );
    return normalizeGrowthStatus(result);
  } catch {
    return null;
  }
}

/** 触发重算（skill / OAuth / identity 变更后）。返回最新视图或 null。 */
export async function recomputeGrowth(
  state: AgentGrowthClientState,
  ref: GrowthEntityRef,
  options?: { preferCultivate?: boolean },
): Promise<GrowthStatusView | null> {
  if (!state.client || !state.connected) {
    return null;
  }
  try {
    const result = await state.client.request(
      methodFor(ref.kind, "recompute"),
      paramsFor(ref, options?.preferCultivate === true ? { preferCultivate: true } : undefined),
    );
    return normalizeGrowthStatus(result);
  } catch {
    return null;
  }
}

/** 幂等记录里程碑时间戳（first-write-wins 由 gateway 保证）。返回最新视图或 null。 */
export async function recordGrowthMilestone(
  state: AgentGrowthClientState,
  ref: GrowthEntityRef,
  key: string,
  atMs?: number,
): Promise<GrowthStatusView | null> {
  if (!state.client || !state.connected) {
    return null;
  }
  try {
    const result = await state.client.request(
      methodFor(ref.kind, "record"),
      paramsFor(ref, { key, ...(typeof atMs === "number" ? { atMs } : {}) }),
    );
    return normalizeGrowthStatus(result);
  } catch {
    return null;
  }
}

/** 读取内置 Agent 模板列表（agents.list-templates）。 */
export async function listAgentTemplates(
  state: AgentGrowthClientState,
): Promise<AgentTemplateListItemView[]> {
  if (!state.client || !state.connected) {
    return [];
  }
  try {
    const result = await state.client.request("agents.list-templates", {});
    const root = asRecord(result);
    const templates = Array.isArray(root?.templates) ? root.templates : [];
    return templates
      .map(normalizeAgentTemplateListItem)
      .filter((entry): entry is AgentTemplateListItemView => entry !== null);
  } catch {
    return [];
  }
}

/** P1：分析任务文本 → pendingTaskContext + recommendation（仅机器人）。 */
export async function analyzeGrowthTask(
  state: AgentGrowthClientState,
  agentId: string,
  draftText: string,
  source: "composer" | "sent_mission" = "composer",
): Promise<GrowthStatusView | null> {
  if (!state.client || !state.connected || !draftText.trim()) {
    return null;
  }
  try {
    const result = await state.client.request("agents.analyze-growth-task", {
      agentId,
      draftText: draftText.trim(),
      source,
    });
    return normalizeGrowthStatus(result);
  } catch {
    return null;
  }
}

/** P1：清除 pendingTaskContext（忽略续跑条）。 */
export async function clearGrowthPendingTask(
  state: AgentGrowthClientState,
  agentId: string,
): Promise<GrowthStatusView | null> {
  if (!state.client || !state.connected) {
    return null;
  }
  try {
    const result = await state.client.request("agents.clear-growth-pending-task", { agentId });
    return normalizeGrowthStatus(result);
  } catch {
    return null;
  }
}
