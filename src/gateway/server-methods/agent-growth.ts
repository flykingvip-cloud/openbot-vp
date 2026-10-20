/**
 * Agent Growth OS — Gateway RPC（spec: agent-growth-lifecycle, P0A 任务 3.1/3.2）。
 *
 * Methods:
 *  - agents.get-growth-status / agents.recompute-growth / agents.record-growth-milestone
 *  - agents.list-templates
 *  - collaboration.spaces.get-growth-status / recompute-growth / record-growth-milestone
 *
 * Scope（评审决策，见 method-scopes.ts）：get → READ_SCOPE；recompute/record → WRITE_SCOPE。
 * 信号口径（RISK-007）：Skill 真实接入；OAuth `"unknown"` 不计分不阻塞。
 */

import { listAgentIds } from "../../agents/agent-scope.js";
import { loadConfig } from "../../config/config.js";
import { normalizeAgentId } from "../../routing/session-key.js";
import { analyzeAndStoreGrowthTask } from "../agent-growth/analyze-growth-task.js";
import { createInitialGrowthStatus, recomputeGrowthStatus } from "../agent-growth/factory.js";
import { emitGrowthEvents } from "../agent-growth/growth-events.js";
import { collectInstalledSkillKeys } from "../agent-growth/installed-skills.js";
import { applyActivationTransition, deriveLifecycleState } from "../agent-growth/lifecycle.js";
import {
  buildEmptyMeshGroupGrowthAggregate,
  buildMeshGroupGrowthAggregate,
  listTenantMeshGrowthGroups,
} from "../agent-growth/mesh-group-growth-aggregate.js";
import {
  buildMeshGrowthAggregate,
  buildEmptyMeshGrowthAggregate,
} from "../agent-growth/mesh-growth-aggregate.js";
import {
  listTenantMeshGrowthAgents,
  resolveMeshGrowthTenantScope,
} from "../agent-growth/mesh-growth-tenant-scope.js";
import { recordMilestone } from "../agent-growth/milestones.js";
import {
  projectOperationalGrowth,
  syncRobotGrowthFromOperationalMetrics,
} from "../agent-growth/operational-growth.js";
import {
  deriveOperationalSignals,
  readOperationalMetrics,
} from "../agent-growth/operational-metrics-store.js";
import { computeOperationalScore } from "../agent-growth/operational-score.js";
import type { OperationalScoreSignals } from "../agent-growth/operational-score.js";
import { clearRobotPendingTaskContext } from "../agent-growth/pending-task-context.js";
import { syncRobotPendingTaskGapStatuses } from "../agent-growth/pending-task-gap-sync.js";
import {
  computeAlignmentComplete,
  computeAlignmentDimension,
  computeCapabilityDimension,
} from "../agent-growth/readiness.js";
import { buildRobotGrowthStatusPayload } from "../agent-growth/recommendation.js";
import { collectCapabilityReadinessSignals } from "../agent-growth/signals.js";
import { readRobotGrowthStatus, updateRobotGrowthStatus } from "../agent-growth/store.js";
import { listBuiltinTemplates, resolveTemplateOrDefault } from "../agent-growth/templates/index.js";
import type {
  CapabilityReadinessSignals,
  GrowthDimension,
  GrowthMilestones,
  GrowthStatus,
} from "../agent-growth/types.js";
import {
  aggregateWorkingStyleEffectiveness,
  type WorkingStyleEffectivenessInput,
} from "../agent-growth/working-style-effectiveness.js";
import { runWorkingStyleSelfTuning } from "../agent-growth/working-style-self-tuning.js";
import { readWorkingStyleChange } from "../agent-growth/working-style-store.js";
import { listGatewayCollaborationSpaces } from "../collaboration-learning.js";
import {
  applyBehaviorHintsToDimensions,
  deriveBehaviorGrowthHints,
  syncCollaborationBehaviorBuffer,
} from "../collaboration-learning/behavior-buffer.js";
import { syncCollaborationRcisAggregate } from "../collaboration-learning/rcis-aggregate.js";
import {
  readGroupGrowthStatusById,
  updateGroupGrowthStatusById,
  resolveCollaborationGroupTenantId,
} from "../collaboration-learning/shared.js";
import { ErrorCodes, errorShape } from "../protocol/index.js";
import type { GatewayRequestHandlers, RespondFn } from "./types.js";

const MILESTONE_KEYS = new Set<keyof GrowthMilestones>([
  "createdAtMs",
  "sessionOpenedAtMs",
  "birthPreludeShownAtMs",
  "firstCtaClickedAtMs",
  "identityCompletedAtMs",
  "firstSkillInstalledAtMs",
  "firstPermissionGrantedAtMs",
  "firstKnowledgeUploadedAtMs",
  "rolesAssignedAtMs",
  "workflowDefinedAtMs",
  "alignmentCompletedAtMs",
  "missionReadyAtMs",
  "firstMissionSentAtMs",
  "firstMissionSuccessAtMs",
  "activatedAtMs",
]);

function requireString(
  params: Record<string, unknown>,
  key: string,
  respond: RespondFn,
): string | null {
  const value = params[key];
  if (typeof value !== "string" || value.trim().length === 0) {
    respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, `missing ${key}`));
    return null;
  }
  return value.trim();
}

/** 机器人重算：真实 skill → capability 维度，重算 score/readiness/lifecycle（保留其余维度）。 */
function recomputeRobot(
  current: GrowthStatus,
  agentId: string,
  operationalSignals?: OperationalScoreSignals,
  adaptivityAdjustment = 0,
): GrowthStatus {
  const template = resolveTemplateOrDefault(current.templateId);
  const installedSkillKeys = collectInstalledSkillKeys(agentId);
  const skillCapability = computeCapabilityDimension(template, installedSkillKeys);
  // 运营实战与显式 skill 都是能力证据；重算只能合并证据，不能抹掉已获得的成长。
  const capability = Math.max(current.dimensions.capability, skillCapability);
  const dimensions: GrowthDimension = { ...current.dimensions, capability };
  const signals = collectCapabilityReadinessSignals({ template, installedSkillKeys });
  const rawScore = operationalSignals ? computeOperationalScore(operationalSignals) : undefined;
  const operationalScore =
    typeof rawScore === "number"
      ? Math.max(0, Math.min(100, rawScore + adaptivityAdjustment))
      : rawScore;
  return recomputeGrowthStatus(current, { dimensions, signals, operationalScore });
}

function reDeriveLifecycle(status: GrowthStatus): GrowthStatus {
  const template = resolveTemplateOrDefault(status.templateId);
  return {
    ...status,
    lifecycleState: deriveLifecycleState(status, template.missionReadyThreshold),
  };
}

/**
 * 记录里程碑并维持不变量：`firstMissionSuccessAtMs` 触发激活（R6.2：写入即 isActivated=true），
 * 其余里程碑仅记录时间戳后重推生命周期。
 */
function applyMilestone(
  base: GrowthStatus,
  key: keyof GrowthMilestones,
  atMs: number,
): GrowthStatus {
  if (key === "firstMissionSuccessAtMs") {
    return reDeriveLifecycle(
      applyActivationTransition(base, { type: "first_mission_success", atMs }),
    );
  }
  const milestones = recordMilestone(base.milestones, key, atMs);
  return reDeriveLifecycle({ ...base, milestones });
}

/** 从 RPC 参数解析运营信号（P2：来自任务/工具遥测；缺省返回 undefined → 不改 operationalScore）。 */
function parseOperationalSignals(
  params: Record<string, unknown>,
): OperationalScoreSignals | undefined {
  const raw = params.operationalSignals;
  if (!raw || typeof raw !== "object") {
    return undefined;
  }
  const r = raw as Record<string, unknown>;
  const num = (v: unknown): number | undefined =>
    typeof v === "number" && Number.isFinite(v) ? v : undefined;
  return {
    taskSuccessRate: num(r.taskSuccessRate),
    toolSuccessRate: num(r.toolSuccessRate),
    satisfaction: num(r.satisfaction),
    humanTakeoverRate: num(r.humanTakeoverRate),
  };
}

export const agentGrowthHandlers: GatewayRequestHandlers = {
  "agents.list-templates": ({ respond }) => {
    respond(true, { templates: listBuiltinTemplates() }, undefined);
  },

  "agents.get-growth-status": async ({ params, respond }) => {
    const agentId = requireString(params, "agentId", respond);
    if (!agentId) {
      return;
    }
    const cfg = loadConfig();
    const normalized = normalizeAgentId(agentId);
    if (!listAgentIds(cfg).includes(normalized)) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, `unknown agent: ${agentId}`),
      );
      return;
    }
    const status =
      (await syncRobotPendingTaskGapStatuses(
        cfg,
        normalized,
        await syncRobotGrowthFromOperationalMetrics(cfg, normalized),
      )) ?? (await syncRobotGrowthFromOperationalMetrics(cfg, normalized));
    if (!status) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, `unknown agent: ${agentId}`),
      );
      return;
    }
    respond(
      true,
      buildRobotGrowthStatusPayload({
        agentId: normalized,
        growthStatus: status,
        preferCultivate: params.preferCultivate === true,
      }),
      undefined,
    );
  },

  "agents.recompute-growth": async ({ params, respond, context }) => {
    const agentId = requireString(params, "agentId", respond);
    if (!agentId) {
      return;
    }
    const cfg = loadConfig();
    const normalized = normalizeAgentId(agentId);
    if (!listAgentIds(cfg).includes(normalized)) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, `unknown agent: ${agentId}`),
      );
      return;
    }
    const prev = await readRobotGrowthStatus(cfg, normalized);
    const persistedMetrics = await readOperationalMetrics(cfg, normalized);
    // 显式信号仅覆盖本次 operationalScore；成长维度始终回放持久化指标，补齐历史数据。
    const operationalSignals =
      parseOperationalSignals(params) ?? deriveOperationalSignals(persistedMetrics);
    const { adaptivityAdjustment, workingStyleEffect } = await runWorkingStyleSelfTuning(
      cfg,
      normalized,
      operationalSignals,
      { tasksTotal: persistedMetrics.tasksTotal },
    );
    const installedSkillKeys = collectInstalledSkillKeys(normalized);
    const next = await updateRobotGrowthStatus(cfg, normalized, (current) => {
      const base = current ?? createInitialGrowthStatus({ kind: "robot", atMs: Date.now() });
      const projected = projectOperationalGrowth(
        base,
        persistedMetrics,
        Date.now(),
        installedSkillKeys,
        adaptivityAdjustment,
      );
      return recomputeRobot(projected, normalized, operationalSignals, adaptivityAdjustment);
    });
    if (next) {
      emitGrowthEvents(context?.broadcast, { idKey: "agentId", id: normalized }, prev, next);
      if (workingStyleEffect?.newlyAssessed) {
        context?.broadcast?.("agent_growth.working_style_effect", {
          agentId: normalized,
          status: workingStyleEffect.status,
          deltaScore: workingStyleEffect.deltaScore,
          rolledBack: workingStyleEffect.rolledBack,
        });
      }
    }
    if (!next) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, `unknown agent: ${agentId}`),
      );
      return;
    }
    const synced = (await syncRobotPendingTaskGapStatuses(cfg, normalized, next)) ?? next;
    respond(
      true,
      buildRobotGrowthStatusPayload({
        agentId: normalized,
        growthStatus: synced,
        preferCultivate: params.preferCultivate === true,
        installedSkillKeys,
      }),
      undefined,
    );
  },

  "agents.list-working-style-effects": async ({ respond }) => {
    const cfg = loadConfig();
    const effects: Array<Record<string, unknown>> = [];
    for (const agentId of listAgentIds(cfg)) {
      const change = await readWorkingStyleChange(cfg, agentId).catch(() => null);
      if (!change) {
        continue;
      }
      effects.push({
        agentId,
        changedAtMs: change.changedAtMs,
        appliedDelta: change.appliedDelta,
        previousValues: change.previousValues ?? {},
        baselineOperationalScore: change.baselineOperationalScore,
        assessedAtMs: change.assessedAtMs,
        status: change.effectStatus ?? null,
        deltaScore: change.deltaScore ?? null,
        rolledBack: change.rolledBack ?? false,
      });
    }
    respond(true, { effects }, undefined);
  },

  "agents.working-style-effectiveness": async ({ respond }) => {
    const cfg = loadConfig();
    const items: WorkingStyleEffectivenessInput[] = [];
    for (const agentId of listAgentIds(cfg)) {
      const change = await readWorkingStyleChange(cfg, agentId).catch(() => null);
      if (!change) {
        continue;
      }
      items.push({
        agentId,
        appliedDelta: change.appliedDelta,
        status: change.effectStatus ?? null,
        deltaScore: change.deltaScore ?? null,
        rolledBack: change.rolledBack ?? false,
      });
    }
    respond(true, { aggregate: aggregateWorkingStyleEffectiveness(items) }, undefined);
  },

  /** P3：机巢只读 — 跨机器人成长速度与企业统计（tenant-scoped；不含 Identity/Prompt 编辑）。 */
  "growth.aggregate": async ({ client, params, respond }) => {
    const cfg = loadConfig();
    const tenantScope = await resolveMeshGrowthTenantScope(client, cfg);
    if (tenantScope.kind === "deny") {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, `growth aggregate denied: ${tenantScope.reason}`),
      );
      return;
    }
    if (tenantScope.kind === "empty") {
      respond(
        true,
        { ...buildEmptyMeshGrowthAggregate(), filters: { positionId: null } },
        undefined,
      );
      return;
    }
    const positionIdRaw = (params as { positionId?: unknown } | null)?.positionId;
    const positionId =
      typeof positionIdRaw === "string" && positionIdRaw.trim() ? positionIdRaw.trim() : null;
    const agents = await listTenantMeshGrowthAgents({
      tenantId: tenantScope.tenantId,
      cfg,
      positionId,
    });
    const aggregate = await buildMeshGrowthAggregate(cfg, agents, { client });
    respond(true, { ...aggregate, filters: { positionId } }, undefined);
  },

  /** P3.1：机巢只读 — 协作组成长速度与企业统计（tenant-scoped；独立 RPC）。 */
  "growth.groupAggregate": async ({ client, respond }) => {
    const cfg = loadConfig();
    const tenantScope = await resolveMeshGrowthTenantScope(client, cfg);
    if (tenantScope.kind === "deny") {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          `group growth aggregate denied: ${tenantScope.reason}`,
        ),
      );
      return;
    }
    if (tenantScope.kind === "empty") {
      respond(true, buildEmptyMeshGroupGrowthAggregate(), undefined);
      return;
    }
    const groups = await listTenantMeshGrowthGroups({ tenantId: tenantScope.tenantId });
    const aggregate = await buildMeshGroupGrowthAggregate(groups);
    respond(true, aggregate, undefined);
  },

  "agents.record-growth-milestone": async ({ params, respond, context }) => {
    const agentId = requireString(params, "agentId", respond);
    if (!agentId) {
      return;
    }
    const key = requireString(params, "key", respond);
    if (!key) {
      return;
    }
    const isPreludeDismiss = key === "preludeDismissedAtMs";
    if (!isPreludeDismiss && !MILESTONE_KEYS.has(key as keyof GrowthMilestones)) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, `unknown milestone: ${key}`),
      );
      return;
    }
    const atMs = typeof params.atMs === "number" && params.atMs > 0 ? params.atMs : Date.now();
    const cfg = loadConfig();
    const normalized = normalizeAgentId(agentId);
    if (!listAgentIds(cfg).includes(normalized)) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, `unknown agent: ${agentId}`),
      );
      return;
    }
    const prev = await readRobotGrowthStatus(cfg, normalized);
    const next = await updateRobotGrowthStatus(cfg, normalized, (current) => {
      const base = current ?? createInitialGrowthStatus({ kind: "robot", atMs });
      if (isPreludeDismiss) {
        if (
          typeof base.preludeDismissedAtMs === "number" &&
          Number.isFinite(base.preludeDismissedAtMs) &&
          base.preludeDismissedAtMs > 0
        ) {
          return base;
        }
        return reDeriveLifecycle({ ...base, preludeDismissedAtMs: atMs });
      }
      return applyMilestone(base, key as keyof GrowthMilestones, atMs);
    });
    if (next) {
      emitGrowthEvents(context?.broadcast, { idKey: "agentId", id: normalized }, prev, next);
    }
    if (!next) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, `unknown agent: ${agentId}`),
      );
      return;
    }
    respond(
      true,
      buildRobotGrowthStatusPayload({
        agentId: normalized,
        growthStatus: next,
      }),
      undefined,
    );
  },

  "agents.analyze-growth-task": async ({ params, respond }) => {
    const agentId = requireString(params, "agentId", respond);
    if (!agentId) {
      return;
    }
    const draftText = requireString(params, "draftText", respond);
    if (!draftText) {
      return;
    }
    const sourceRaw = typeof params.source === "string" ? params.source.trim() : "composer";
    const source = sourceRaw === "sent_mission" ? "sent_mission" : "composer";
    const cfg = loadConfig();
    const normalized = normalizeAgentId(agentId);
    if (!listAgentIds(cfg).includes(normalized)) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, `unknown agent: ${agentId}`),
      );
      return;
    }
    const payload = await analyzeAndStoreGrowthTask({
      cfg,
      agentId: normalized,
      draftText,
      source,
      preferCultivate: params.preferCultivate === true,
    });
    if (!payload) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, "unable to analyze growth task"),
      );
      return;
    }
    respond(true, payload, undefined);
  },

  "agents.clear-growth-pending-task": async ({ params, respond }) => {
    const agentId = requireString(params, "agentId", respond);
    if (!agentId) {
      return;
    }
    const cfg = loadConfig();
    const normalized = normalizeAgentId(agentId);
    if (!listAgentIds(cfg).includes(normalized)) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, `unknown agent: ${agentId}`),
      );
      return;
    }
    const next = await clearRobotPendingTaskContext(cfg, normalized);
    const status =
      next ??
      (await readRobotGrowthStatus(cfg, normalized)) ??
      createInitialGrowthStatus({ kind: "robot", atMs: Date.now() });
    respond(
      true,
      buildRobotGrowthStatusPayload({
        agentId: normalized,
        growthStatus: status,
      }),
      undefined,
    );
  },

  "collaboration.spaces.get-growth-status": async ({ params, respond }) => {
    const groupId = requireString(params, "groupId", respond);
    if (!groupId) {
      return;
    }
    const status = await readGroupGrowthStatusById(groupId);
    if (!status) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, `unknown space: ${groupId}`),
      );
      return;
    }
    respond(true, { groupId, growthStatus: status }, undefined);
  },

  "collaboration.spaces.recompute-growth": async ({ params, respond, context }) => {
    const groupId = requireString(params, "groupId", respond);
    if (!groupId) {
      return;
    }
    const prev = await readGroupGrowthStatusById(groupId);
    const alignment = await resolveGroupAlignment(groupId);
    const operationalSignals = parseOperationalSignals(params);
    const tenantIdForLedger = resolveCollaborationGroupTenantId(groupId);
    const behaviorSnapshot = await syncCollaborationBehaviorBuffer(groupId, tenantIdForLedger);
    const behaviorHints = deriveBehaviorGrowthHints(behaviorSnapshot);
    // P4c: adjacent async RCIS snapshot only when flag ON. Never mutates GrowthDimension
    // or feeds Admission (C7 / R5). Flag-off → null / no write.
    const rcisAggregate = await syncCollaborationRcisAggregate(groupId, tenantIdForLedger);
    const next = await updateGroupGrowthStatusById(groupId, (current) => {
      const dimensions: GrowthDimension = applyBehaviorHintsToDimensions(
        {
          ...current.dimensions,
          alignment: alignment.dimension,
        },
        behaviorHints,
      );
      // P0A 小组无模板 required skill → skill 信号视为满足；OAuth unknown。
      const signals: CapabilityReadinessSignals = {
        requiredSkillsInstalled: true,
        requiredPermissionsGranted: "unknown",
      };
      const operationalScore = operationalSignals
        ? computeOperationalScore(operationalSignals)
        : undefined;
      return recomputeGrowthStatus(current, {
        dimensions,
        signals,
        alignmentComplete: alignment.complete,
        operationalScore,
      });
    });
    if (!next) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, `unknown space: ${groupId}`),
      );
      return;
    }
    emitGrowthEvents(context?.broadcast, { idKey: "groupId", id: groupId }, prev, next);
    respond(
      true,
      {
        groupId,
        growthStatus: next,
        behaviorBuffer: behaviorSnapshot,
        ...(rcisAggregate ? { rcisAggregate } : {}),
      },
      undefined,
    );
  },

  "collaboration.spaces.record-growth-milestone": async ({ params, respond, context }) => {
    const groupId = requireString(params, "groupId", respond);
    if (!groupId) {
      return;
    }
    const key = requireString(params, "key", respond);
    if (!key) {
      return;
    }
    if (!MILESTONE_KEYS.has(key as keyof GrowthMilestones)) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, `unknown milestone: ${key}`),
      );
      return;
    }
    const atMs = typeof params.atMs === "number" && params.atMs > 0 ? params.atMs : Date.now();
    const prev = await readGroupGrowthStatusById(groupId);
    const next = await updateGroupGrowthStatusById(groupId, (current) =>
      applyMilestone(current, key as keyof GrowthMilestones, atMs),
    );
    if (!next) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, `unknown space: ${groupId}`),
      );
      return;
    }
    emitGrowthEvents(context?.broadcast, { idKey: "groupId", id: groupId }, prev, next);
    respond(true, { groupId, growthStatus: next }, undefined);
  },
};

/** 从协作快照解析小组 alignment（rolesAssigned + workflow heuristic）。 */
async function resolveGroupAlignment(
  groupId: string,
): Promise<{ complete: boolean; dimension: number }> {
  const snapshot = await listGatewayCollaborationSpaces();
  const space = (snapshot.spaces ?? []).find(
    (entry) => (entry as { groupId?: string }).groupId === groupId,
  ) as { operatingState?: unknown } | undefined;
  const operating = space?.operatingState as
    | {
        governance?: { coordinatorBotId?: string | null };
        memberRoleMap?: Array<{
          memberKind?: string;
          status?: string;
          collaborationRole?: string | null;
        }>;
        groupProfile?: { collaborationMode?: string | null };
      }
    | undefined;
  const activeBots = (operating?.memberRoleMap ?? [])
    .filter((member) => member.memberKind === "bot" && member.status === "active")
    .map((member) => ({ collaborationRole: member.collaborationRole ?? null }));
  const input = {
    coordinatorBotId: operating?.governance?.coordinatorBotId ?? null,
    activeBots,
    // P0 workflow heuristic：collaborationMode 非空视为已声明协作流程（兜底）。
    workflowDescribedInInstructions: Boolean(operating?.groupProfile?.collaborationMode),
  };
  return {
    complete: computeAlignmentComplete(input),
    dimension: computeAlignmentDimension(input),
  };
}
