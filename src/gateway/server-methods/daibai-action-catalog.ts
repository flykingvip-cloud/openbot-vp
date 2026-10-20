/**
 * Daibai Action Catalog — 大白可代办动作的运行时注册表。
 *
 * Phase 3：首批仅迁移现有三个 support action（纯重构，行为等价）。
 * 后续 Phase 5 再接入 robot-skills / employee-install / budget 等写动作。
 *
 * 设计要点：
 * - 目录项经 `DaibaiActionDescriptor` 类型约束（编译期禁 ADMIN）。
 * - `resolveStewardAction(actionId)` 查目录；`assertActionAllowedForScopes` 做 operator-scope 闸门。
 * - 二级权限交目标 service 自校验（决策 F），本层不负责。
 */

import type {
  DaibaiActionDescriptor,
  DaibaiActionParamContext,
} from "../../shared/daibai-action-catalog.js";
import { assertStewardActionAuthorized, isStewardActionAuthorized } from "./daibai-dispatch.js";
import type { GatewayClient } from "./types.js";

const actionCatalog = new Map<string, DaibaiActionDescriptor>();

export function registerStewardAction(descriptor: DaibaiActionDescriptor): void {
  actionCatalog.set(descriptor.actionId, descriptor);
}

export function resolveStewardAction(actionId: string): DaibaiActionDescriptor | undefined {
  return actionCatalog.get(actionId);
}

export function listStewardActions(): DaibaiActionDescriptor[] {
  return [...actionCatalog.values()];
}

/**
 * 校验 client 是否被授权执行该目录动作（connect-aware，镜像最外层信任模型）。
 * @throws StewardAuthorizationError 当 client 缺少 requiredScope 时。
 */
export function assertActionAllowedForScopes(
  action: Pick<DaibaiActionDescriptor, "requiredScope">,
  client: GatewayClient | null,
): void {
  assertStewardActionAuthorized(action, client);
}

/** 非抛出版本，便于 UI/预检判断。 */
export function isActionAllowedForClient(
  action: Pick<DaibaiActionDescriptor, "requiredScope">,
  client: GatewayClient | null,
): boolean {
  return isStewardActionAuthorized(client, action.requiredScope);
}

/** 测试辅助：清空目录。 */
export function __clearActionCatalogForTest(): void {
  actionCatalog.clear();
}

// ─── 首批目录项：现有三个 support action（行为等价迁移）──────────────────────

/**
 * support.case.create — 创建支持单（WRITE）。
 * delegateTarget: E1 service 模式，委派到 `support-cases/store.ts::createSupportCase`。
 */
registerStewardAction({
  actionId: "support.case.create",
  title: "升级给平台技术支持",
  kind: "write",
  requiredScope: "operator.write",
  delegateTarget: { mode: "service", ref: "supportCase.create" },
  requiresUserConfirmation: false,
  buildParams: (ctx: DaibaiActionParamContext) => ({
    userId: ctx.userId,
    tenantId: ctx.tenantId,
    sourceSessionKey: ctx.sessionKey,
    userProblem:
      typeof ctx.payload.userProblem === "string" && ctx.payload.userProblem.trim()
        ? ctx.payload.userProblem.trim()
        : "需要平台技术支持协助处理当前问题",
    category: typeof ctx.payload.category === "string" ? ctx.payload.category : undefined,
    daibaiSummary:
      typeof ctx.payload.daibaiSummary === "string" ? ctx.payload.daibaiSummary : undefined,
    relatedEntities:
      ctx.payload.relatedEntities && typeof ctx.payload.relatedEntities === "object"
        ? ctx.payload.relatedEntities
        : undefined,
    contextBundle: {
      userMessage:
        typeof ctx.payload.userProblem === "string" && ctx.payload.userProblem.trim()
          ? ctx.payload.userProblem.trim()
          : "需要平台技术支持协助处理当前问题",
      sourceSessionKey: ctx.sessionKey,
    },
  }),
});

/**
 * support.case.reply_user — 标记已看平台回复（WRITE）。
 */
registerStewardAction({
  actionId: "support.case.reply_user",
  title: "查看平台回复",
  kind: "write",
  requiredScope: "operator.write",
  delegateTarget: { mode: "service", ref: "supportCase.markReplySeen" },
  requiresUserConfirmation: false,
  buildParams: (ctx: DaibaiActionParamContext) => ({
    caseId: typeof ctx.payload.caseId === "string" ? ctx.payload.caseId : "",
    proposalVersion:
      typeof ctx.payload.proposalVersion === "number" ? ctx.payload.proposalVersion : 0,
  }),
});

/**
 * support.case.apply_resolution — 执行解决方案（WRITE）。
 */
registerStewardAction({
  actionId: "support.case.apply_resolution",
  title: "执行解决方案",
  kind: "write",
  requiredScope: "operator.write",
  delegateTarget: { mode: "service", ref: "supportCase.applyResolution" },
  requiresUserConfirmation: false,
  buildParams: (ctx: DaibaiActionParamContext) => ({
    caseId: typeof ctx.payload.caseId === "string" ? ctx.payload.caseId : "",
  }),
});

registerStewardAction({
  actionId: "support.case.close",
  title: "关闭支持单",
  kind: "write",
  requiredScope: "operator.write",
  delegateTarget: { mode: "service", ref: "supportCase.close" },
  requiresUserConfirmation: false,
  buildParams: (ctx: DaibaiActionParamContext) => ({
    caseId: typeof ctx.payload.caseId === "string" ? ctx.payload.caseId : "",
  }),
});

// ─── Phase 5：robot-skills.* （需确认写 + ownership 预检，决策 G/H）────────────
// requiredScope=WRITE（与 method-scopes.ts:390-393 一致）；requiresUserConfirmation=true；
// requiresOwnershipCheck=true（execute 上层用 resolveManageableAgentIds 复核目标 agentId）。
// buildParams 使用 ctx.resolvedAgentId（经 ownership 预检收窄），不直接信任 payload.agentId。

registerStewardAction({
  actionId: "robot-skills.toggle",
  title: "启停机器人技能",
  kind: "write",
  requiredScope: "operator.write",
  delegateTarget: { mode: "service", ref: "robotSkills.toggle" },
  requiresOwnershipCheck: true,
  requiresUserConfirmation: true,
  impact: "改变该机器人某个技能的启用/停用状态",
  irreversible: false,
  buildParams: (ctx) => ({
    agentId: ctx.resolvedAgentId,
    skillId: typeof ctx.payload.skillId === "string" ? ctx.payload.skillId : "",
    enabled: ctx.payload.enabled === true,
  }),
});

registerStewardAction({
  actionId: "robot-skills.upgrade",
  title: "升级机器人技能",
  kind: "write",
  requiredScope: "operator.write",
  delegateTarget: { mode: "service", ref: "robotSkills.upgrade" },
  requiresOwnershipCheck: true,
  requiresUserConfirmation: true,
  impact: "把该机器人某个技能升级到最新版本",
  irreversible: false,
  buildParams: (ctx) => ({
    agentId: ctx.resolvedAgentId,
    skillId: typeof ctx.payload.skillId === "string" ? ctx.payload.skillId : "",
  }),
});

registerStewardAction({
  actionId: "robot-skills.remove",
  title: "卸载机器人技能",
  kind: "write",
  requiredScope: "operator.write",
  delegateTarget: { mode: "service", ref: "robotSkills.remove" },
  requiresOwnershipCheck: true,
  requiresUserConfirmation: true,
  impact: "从该机器人移除某个技能（移除后需重新安装才能恢复）",
  irreversible: true,
  buildParams: (ctx) => ({
    agentId: ctx.resolvedAgentId,
    skillId: typeof ctx.payload.skillId === "string" ? ctx.payload.skillId : "",
  }),
});

// ─── budget.set （需确认写 + 二级权限 usage:budget 自校验，决策 F/G）─────────────
// requiredScope=WRITE（operator 层）；secondaryPermission 仅作 UI 提示，真正鉴权由 service 自校验。
registerStewardAction({
  actionId: "supervisor.task.create",
  title: "创建开发监督任务",
  kind: "write",
  requiredScope: "operator.write",
  delegateTarget: { mode: "service", ref: "supervisorTask.create" },
  requiresUserConfirmation: true,
  impact: "在开发监督流程中创建并启动受监督的代码改动任务（占用 Worker 资源与企业预算）",
  irreversible: false,
  buildParams: (ctx) => ({
    goal: typeof ctx.payload.goal === "string" ? ctx.payload.goal.trim() : "",
    repoRoot: typeof ctx.payload.repoRoot === "string" ? ctx.payload.repoRoot.trim() : "",
    workerBackendId:
      typeof ctx.payload.workerBackendId === "string" && ctx.payload.workerBackendId.trim()
        ? ctx.payload.workerBackendId.trim()
        : "codex-cli",
    workerModel:
      typeof ctx.payload.workerModel === "string" && ctx.payload.workerModel.trim()
        ? ctx.payload.workerModel.trim()
        : undefined,
    templateId:
      typeof ctx.payload.templateId === "string" && ctx.payload.templateId.trim()
        ? ctx.payload.templateId.trim()
        : "repo-auto",
    tenantId: ctx.tenantId,
    userId: ctx.userId,
    agentId: ctx.resolvedAgentId || undefined,
  }),
});

registerStewardAction({
  actionId: "supervisor.task.abort",
  title: "中止开发监督任务",
  kind: "write",
  requiredScope: "operator.write",
  delegateTarget: { mode: "service", ref: "supervisorTask.abort" },
  requiresUserConfirmation: false,
  buildParams: (ctx) => ({
    taskId: typeof ctx.payload.taskId === "string" ? ctx.payload.taskId.trim() : "",
  }),
});

registerStewardAction({
  actionId: "budget.set",
  title: "设置企业预算",
  kind: "write",
  requiredScope: "operator.write",
  delegateTarget: { mode: "service", ref: "budget.set" },
  secondaryPermission: "usage:budget",
  requiresUserConfirmation: true,
  impact: "调整当前企业的月度预算上限（影响所有成员的用量限额）",
  irreversible: false,
  buildParams: (ctx) => ({
    tenantId: ctx.tenantId,
    monthlyLimitCents:
      typeof ctx.payload.monthlyLimitCents === "number" ? ctx.payload.monthlyLimitCents : undefined,
    alertThreshold:
      typeof ctx.payload.alertThreshold === "number" ? ctx.payload.alertThreshold : undefined,
  }),
});

// ─── schedule.entry.add （需确认写；确认后写入与 schedule 工具相同的 per-user store）──
// owner/tenant 一律从 execute 身份上下文盖章，不信任 payload 中的归属字段。
registerStewardAction({
  actionId: "schedule.entry.add",
  title: "添加日程",
  kind: "write",
  requiredScope: "operator.write",
  delegateTarget: { mode: "service", ref: "scheduleEntry.add" },
  requiresUserConfirmation: true,
  impact: "将一条日程写入你的日程管理",
  irreversible: false,
  buildParams: (ctx) => ({
    ownerUserId: ctx.userId,
    tenantId: ctx.tenantId,
    title: typeof ctx.payload.title === "string" ? ctx.payload.title.trim() : "",
    startAtMs: typeof ctx.payload.startAtMs === "number" ? ctx.payload.startAtMs : Number.NaN,
    endAtMs: typeof ctx.payload.endAtMs === "number" ? ctx.payload.endAtMs : undefined,
    timezone: typeof ctx.payload.timezone === "string" ? ctx.payload.timezone : undefined,
    kind: typeof ctx.payload.kind === "string" ? ctx.payload.kind : undefined,
    id: typeof ctx.payload.id === "string" ? ctx.payload.id.trim() : "",
  }),
});
