/**
 * Daibai Service Registrations — 注册大白目录委派的 E1 service 函数。
 *
 * 每个 service 是一个纯逻辑函数（已从 handler 抽出或直接复用 store），
 * 不涉及 `respond` / rate-limit / protocol 帧；鉴权在入口层完成。
 */

import {
  buildManualScheduleEntry,
  upsertScheduleEntry,
} from "../../organization/schedule-store.js";
import type { SupportCase } from "../../shared/daibai-types.js";
import {
  applySupportCaseResolution,
  closeSupportCase,
  createSupportCase,
  markSupportCaseReplySeen,
} from "../../support-cases/store.js";
import { setBudget } from "../billing/budgets-store.js";
import {
  resolveBillingScope,
  scopeHasPermission,
  USAGE_BUDGET_PERMISSION,
} from "../billing/scope.js";
import {
  removeRobotSkillAsset,
  toggleRobotSkillAsset,
  upgradeRobotSkillAsset,
} from "../skill-lifecycle-store.js";
import { abortSupervisedTask } from "../supervisor/driver.js";
import { createSupervisedTask } from "../supervisor/task-create-service.js";
import { registerStewardService } from "./daibai-dispatch.js";
import { getSupervisorPorts } from "./supervisor.js";

/** support.case.create → 直接复用 store 函数。 */
registerStewardService("supportCase.create", async (params) => {
  const result = await createSupportCase(params as Parameters<typeof createSupportCase>[0]);
  return result;
});

/** support.case.reply_user → markSupportCaseReplySeen。 */
registerStewardService("supportCase.markReplySeen", async (params) => {
  const caseId = typeof params.caseId === "string" ? params.caseId : "";
  const proposalVersion = typeof params.proposalVersion === "number" ? params.proposalVersion : 0;
  if (!caseId || proposalVersion <= 0) {
    throw new Error("support.case.reply_user requires caseId and proposalVersion");
  }
  const result = await markSupportCaseReplySeen({ caseId, proposalVersion });
  if (!result) {
    throw new Error("support case not found");
  }
  return result;
});

/** support.case.apply_resolution → applySupportCaseResolution。 */
registerStewardService("supportCase.applyResolution", async (params) => {
  const caseId = typeof params.caseId === "string" ? params.caseId : "";
  if (!caseId) {
    throw new Error("support.case.apply_resolution requires caseId");
  }
  const supportCase: SupportCase | null = await (async () => {
    const { getSupportCase } = await import("../../support-cases/store.js");
    return getSupportCase(caseId);
  })();
  if (!supportCase) {
    throw new Error("support case not found");
  }
  if (!supportCase.resolutionProposal) {
    return { blocked: true, message: "这个支持单还没有平台给出的可执行方案。", supportCase };
  }
  const updated = await applySupportCaseResolution({ caseId });
  return { blocked: false, supportCase: updated ?? supportCase };
});

registerStewardService("supportCase.close", async (params) => {
  const caseId = typeof params.caseId === "string" ? params.caseId : "";
  if (!caseId) {
    throw new Error("support.case.close requires caseId");
  }
  const updated = await closeSupportCase({ caseId });
  if (!updated) {
    throw new Error("support case not found");
  }
  return updated;
});

// ─── robot-skills.* （WRITE，需确认 + ownership 预检）────────────────────────
// params.agentId 已由 execute 上层经 ownership 预检收窄为 resolvedAgentId。

registerStewardService("robotSkills.toggle", (params) => {
  const agentId = typeof params.agentId === "string" ? params.agentId : "";
  const skillId = typeof params.skillId === "string" ? params.skillId : "";
  const enabled = params.enabled === true;
  if (!agentId || !skillId) {
    throw new Error("robot-skills.toggle requires agentId and skillId");
  }
  return { skill: toggleRobotSkillAsset({ agentId, skillId, enabled }) };
});

registerStewardService("robotSkills.upgrade", (params) => {
  const agentId = typeof params.agentId === "string" ? params.agentId : "";
  const skillId = typeof params.skillId === "string" ? params.skillId : "";
  if (!agentId || !skillId) {
    throw new Error("robot-skills.upgrade requires agentId and skillId");
  }
  return { skill: upgradeRobotSkillAsset({ agentId, skillId }) };
});

registerStewardService("robotSkills.remove", (params) => {
  const agentId = typeof params.agentId === "string" ? params.agentId : "";
  const skillId = typeof params.skillId === "string" ? params.skillId : "";
  if (!agentId || !skillId) {
    throw new Error("robot-skills.remove requires agentId and skillId");
  }
  return removeRobotSkillAsset({ agentId, skillId });
});

// ─── budget.set （WRITE，需确认 + 二级权限 usage:budget 自校验，决策 F）──────────
// 决策 F：二级权限由目标 service **自校验**，不在 execute 通用闸做。
// service 拿到 client 后现场解析 billing scope + scopeHasPermission(usage:budget)，
// 失败抛错 → execute 转译为「需升级平台 / 权限不足」引导。

registerStewardService("supervisorTask.create", async (params) => {
  const ports = getSupervisorPorts();
  if (!ports) {
    throw new Error("supervisor runtime unavailable");
  }
  const goal = typeof params.goal === "string" ? params.goal.trim() : "";
  const repoRoot = typeof params.repoRoot === "string" ? params.repoRoot.trim() : "";
  const workerBackendId =
    typeof params.workerBackendId === "string" ? params.workerBackendId.trim() : "";
  if (!goal || !repoRoot || !workerBackendId) {
    throw new Error("supervisor.task.create requires goal, repoRoot, and workerBackendId");
  }
  return await createSupervisedTask(
    {
      goal,
      repoRoot,
      workerBackendId,
      workerModel:
        typeof params.workerModel === "string" && params.workerModel.trim()
          ? params.workerModel.trim()
          : undefined,
      templateId:
        typeof params.templateId === "string" && params.templateId.trim()
          ? params.templateId.trim()
          : undefined,
      tenantId:
        typeof params.tenantId === "string" && params.tenantId.trim()
          ? params.tenantId.trim()
          : undefined,
      userId:
        typeof params.userId === "string" && params.userId.trim()
          ? params.userId.trim()
          : undefined,
      agentId:
        typeof params.agentId === "string" && params.agentId.trim()
          ? params.agentId.trim()
          : undefined,
    },
    { ports },
  );
});

registerStewardService("supervisorTask.abort", async (params) => {
  const taskId = typeof params.taskId === "string" ? params.taskId.trim() : "";
  if (!taskId) {
    throw new Error("supervisor.task.abort requires taskId");
  }
  const ports = getSupervisorPorts();
  const task = await abortSupervisedTask(taskId, ports ?? undefined);
  if (!task) {
    throw new Error("supervised task not found");
  }
  return task;
});

registerStewardService("budget.set", async (params, ctx) => {
  const client = ctx?.client ?? null;
  const requestedTenantId =
    typeof params.tenantId === "string" && params.tenantId.trim() ? params.tenantId.trim() : null;
  const scope = await resolveBillingScope(client, { requestedTenantId });
  if (!scope.enterpriseId) {
    throw new Error("无法解析企业作用域，请确认你的企业身份后重试。");
  }
  if (!scopeHasPermission(scope, USAGE_BUDGET_PERMISSION)) {
    throw new Error("你没有预算管理权限（usage:budget），我可以帮你把诉求升级给平台处理。");
  }
  const monthlyLimitCents =
    typeof params.monthlyLimitCents === "number" && Number.isFinite(params.monthlyLimitCents)
      ? params.monthlyLimitCents
      : null;
  if (monthlyLimitCents === null) {
    throw new Error("monthlyLimitCents 是必填项");
  }
  const budget = await setBudget({
    enterpriseId: scope.enterpriseId,
    monthlyLimitCents,
    alertThreshold: typeof params.alertThreshold === "number" ? params.alertThreshold : undefined,
  });
  return { budget };
});

// ─── schedule.entry.add （WRITE，需确认；与 schedule 工具 / schedule.entry.upsert 同 store）──
registerStewardService("scheduleEntry.add", async (params) => {
  const ownerUserId = typeof params.ownerUserId === "string" ? params.ownerUserId.trim() : "";
  if (!ownerUserId) {
    throw new Error("schedule.entry.add requires authenticated userId");
  }
  const title = typeof params.title === "string" ? params.title.trim() : "";
  if (!title) {
    throw new Error("title is required");
  }
  const startAtMs = typeof params.startAtMs === "number" ? params.startAtMs : Number.NaN;
  if (!Number.isFinite(startAtMs) || startAtMs <= 0) {
    throw new Error("startAtMs must be a positive epoch-ms timestamp");
  }
  let endAtMs: number | undefined;
  if (params.endAtMs !== undefined && params.endAtMs !== null) {
    if (
      typeof params.endAtMs !== "number" ||
      !Number.isFinite(params.endAtMs) ||
      params.endAtMs < startAtMs
    ) {
      throw new Error("endAtMs must be a number >= startAtMs");
    }
    endAtMs = params.endAtMs;
  }
  const tenantId =
    typeof params.tenantId === "string" && params.tenantId.trim()
      ? params.tenantId.trim()
      : undefined;
  const timezone = typeof params.timezone === "string" ? params.timezone : undefined;
  const kind = typeof params.kind === "string" ? params.kind : undefined;
  const id = typeof params.id === "string" ? params.id.trim() : "";
  const entry = await upsertScheduleEntry(
    buildManualScheduleEntry({
      id,
      ownerUserId,
      ...(tenantId !== undefined ? { tenantId } : {}),
      title,
      startAtMs,
      ...(endAtMs !== undefined ? { endAtMs } : {}),
      ...(timezone !== undefined ? { timezone } : {}),
      ...(kind !== undefined ? { kind } : {}),
    }),
  );
  return { entry };
});
