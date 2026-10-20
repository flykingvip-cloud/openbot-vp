import { resolveDefaultAgentId } from "../../agents/agent-scope.js";
import { loadConfig } from "../../config/config.js";
import type {
  DaibaiAskResult,
  DaibaiEscalationDraft,
  DaibaiExecuteResult,
  DaibaiLatestProposal,
  DaibaiSuggestedAction,
  DaibaiWorkspaceOverview,
  SupportCase,
  SupportCaseSummary,
} from "../../shared/daibai-types.js";
import {
  appendStewardInteraction,
  loadStewardMemory,
  type StewardMemory,
} from "../../support-cases/steward-memory-store.js";
import { listSupportCaseRecords } from "../../support-cases/store.js";
import {
  ErrorCodes,
  errorShape,
  validateDaibaiAskParams,
  validateDaibaiExecuteParams,
} from "../protocol/index.js";
import { isSupervisorEnabled } from "../supervisor/feature.js";
import { assertActionAllowedForScopes, resolveStewardAction } from "./daibai-action-catalog.js";
import { invokeStewardDelegate, StewardAuthorizationError } from "./daibai-dispatch.js";
import { buildEscalationDraft } from "./daibai-escalation.js";
import { buildStewardGuideSnapshot, isDaibaiOnboardingGuideMessage } from "./daibai-guide.js";
import { assertAgentManageable, StewardOwnershipError } from "./daibai-ownership.js";
import {
  buildSupervisorTaskDraft,
  resolveSupervisorDefaultRepoRoot,
} from "./daibai-supervisor-draft.js";
import {
  buildDaibaiWorkspaceOverviewSummary,
  resolveDaibaiWorkspaceOverview,
} from "./daibai-workspace-overview.js";
import { buildEmployeeCapabilityRecommendations } from "./employee-capability.js";
import { createConfirmation, consumeConfirmation } from "./steward-confirmation-store.js";
// Side-effect import: registers the steward E1 service functions into the dispatch registry.
import "./daibai-services.js";
import type { GatewayRequestHandlers } from "./types.js";
import { assertValidParams } from "./validation.js";

function looksLikeSupportEscalation(message: string) {
  const normalized = message.trim().toLowerCase();
  return [
    "skill",
    "需求",
    "建议",
    "bug",
    "报错",
    "问题",
    "can't",
    "cannot",
    "error",
    "support",
  ].some((token) => normalized.includes(token));
}

function summarizeSupportCase(input: SupportCase): SupportCaseSummary {
  return {
    caseId: input.caseId,
    category: input.category,
    status: input.status,
    userProblem: input.userProblem,
    userId: input.userId,
    tenantId: input.tenantId,
    updatedAtMs: input.updatedAtMs,
    currentProposalVersion: input.currentProposalVersion,
    proposalSeenByUserVersion: input.proposalSeenByUserVersion,
  };
}

function isActiveSupportCase(input: SupportCase | SupportCaseSummary) {
  return input.status !== "closed";
}

function buildSupportContext(cases: SupportCaseSummary[]) {
  const activeCases = cases.filter(isActiveSupportCase);
  const waitingOnUserCount = activeCases.filter((entry) => entry.status === "waiting_user").length;
  return {
    openCaseCount: activeCases.length,
    waitingOnUserCount,
    latestCase: activeCases[0] ?? null,
    cases: activeCases,
  };
}

function buildSuggestedActions(params: {
  message: string;
  supportCases: SupportCase[];
  escalationDraft?: DaibaiEscalationDraft;
  tenantId?: string;
  userId?: string;
}): DaibaiSuggestedAction[] {
  const actions: DaibaiSuggestedAction[] = [];
  if (isSupervisorEnabled()) {
    const draft = buildSupervisorTaskDraft({
      message: params.message,
      defaultRepoRoot: resolveSupervisorDefaultRepoRoot(),
    });
    if (draft) {
      actions.push({
        actionId: "supervisor.task.create",
        label: "创建开发监督任务",
        description: `由 ${draft.workerBackendId} 在监督流程中执行你的开发目标。`,
        payload: {
          goal: draft.goal,
          repoRoot: draft.repoRoot,
          workerBackendId: draft.workerBackendId,
          templateId: draft.templateId,
          tenantId: params.tenantId,
          userId: params.userId,
        },
      });
    }
  }
  const activeSupportCases = params.supportCases.filter(isActiveSupportCase);
  const latestUnseenProposal = activeSupportCases.find(
    (entry) =>
      !!entry.resolutionProposal &&
      entry.currentProposalVersion &&
      entry.currentProposalVersion !== entry.proposalSeenByUserVersion,
  );
  if (latestUnseenProposal?.currentProposalVersion) {
    actions.push({
      actionId: "support.case.reply_user",
      label: "查看平台回复",
      description: "标记为我已查看平台专家给出的最新回复。",
      payload: {
        caseId: latestUnseenProposal.caseId,
        proposalVersion: latestUnseenProposal.currentProposalVersion,
      },
    });
  }
  const latestRunnableResolution = activeSupportCases.find((entry) => {
    const proposal = entry.resolutionProposal;
    if (!proposal) {
      return false;
    }
    const recommendedActionId =
      proposal.recommendedActionId?.trim() || "support.case.apply_resolution";
    if (recommendedActionId !== "support.case.apply_resolution") {
      return false;
    }
    if (proposal.requiresUserConfirmation) {
      return entry.currentProposalVersion === entry.proposalSeenByUserVersion;
    }
    return true;
  });
  if (latestRunnableResolution) {
    actions.push({
      actionId: "support.case.apply_resolution",
      label: "执行解决方案",
      description: "按平台专家给出的当前方案继续处理并完成收口。",
      payload: {
        caseId: latestRunnableResolution.caseId,
      },
    });
  }
  if (looksLikeSupportEscalation(params.message)) {
    actions.push({
      actionId: "support.case.create",
      label: "升级给平台技术支持",
      description: "把当前问题整理成支持单并转给平台技术人员。",
      payload: params.escalationDraft
        ? {
            userProblem: params.escalationDraft.contextBundle.userMessage,
            category: params.escalationDraft.category,
            contextBundle: params.escalationDraft.contextBundle,
          }
        : undefined,
    });
  }
  return actions;
}

function buildLatestProposal(supportCases: SupportCase[]): DaibaiLatestProposal | undefined {
  const latestCaseWithProposal = supportCases
    .filter(isActiveSupportCase)
    .find((entry) => entry.resolutionProposal);
  if (
    !latestCaseWithProposal?.resolutionProposal ||
    !latestCaseWithProposal.currentProposalVersion
  ) {
    return undefined;
  }
  return {
    caseId: latestCaseWithProposal.caseId,
    proposalVersion: latestCaseWithProposal.currentProposalVersion,
    userFacingReply: latestCaseWithProposal.resolutionProposal.userFacingReply,
    recommendedActionId: latestCaseWithProposal.resolutionProposal.recommendedActionId,
    requiresUserConfirmation: latestCaseWithProposal.resolutionProposal.requiresUserConfirmation,
    seenByUser:
      latestCaseWithProposal.currentProposalVersion ===
      latestCaseWithProposal.proposalSeenByUserVersion,
  };
}

/**
 * Heuristic: is the user asking about visible robots / collaboration groups / scope?
 * Only then should the steward surface workspace-overview counts. Greetings and general
 * chit-chat must NOT recite "当前可见 N 个机器人、N 个协作群".
 */
function looksLikeWorkspaceScopeQuestion(message: string): boolean {
  const m = message.trim();
  if (!m) {
    return false;
  }
  return /(有哪些|哪些|多少|几个|列表|清单|都有(什么|哪些|谁)|谁在|成员|团队|阵容|可用|能用|可见|范围|机器人|协作群|协作小组|概览)/.test(
    m,
  );
}

/** Greetings / light chit-chat that should get a warm reply, never a capability recital. */
function looksLikeGreeting(message: string): boolean {
  const m = message.trim().toLowerCase();
  if (!m) {
    return false;
  }
  if (/^(hi|hello|hey|yo|哈喽|哈啰)\b/.test(m)) {
    return true;
  }
  return /(你好|您好|大白你好|在吗|在么|在不在|嗨|早上好|中午好|下午好|晚上好|早安|晚安|good\s?(morning|afternoon|evening|night))/.test(
    m,
  );
}

export function buildAskResult(params: {
  message: string;
  sessionKey?: string;
  sourceSessionKey?: string;
  tenantId?: string;
  userId?: string;
  supportCases: SupportCase[];
  memory?: StewardMemory | null;
  guideRecommendations?: Array<{ capabilityId: string; name: string; reason: string }>;
  workspaceOverview?: DaibaiWorkspaceOverview;
}): DaibaiAskResult {
  const onboarding = isDaibaiOnboardingGuideMessage(params.message);
  const supportContext = onboarding
    ? undefined
    : buildSupportContext(params.supportCases.map(summarizeSupportCase));
  const latestProposal = onboarding ? undefined : buildLatestProposal(params.supportCases);
  const suggestedActions = onboarding
    ? []
    : buildSuggestedActions({
        message: params.message,
        supportCases: params.supportCases,
        escalationDraft: looksLikeSupportEscalation(params.message)
          ? buildEscalationDraft({
              message: params.message,
              sessionKey: params.sessionKey,
              memory: params.memory,
            })
          : undefined,
        tenantId: params.tenantId,
        userId: params.userId,
      });
  const guide = buildStewardGuideSnapshot({
    memory: params.memory,
    recommendations: params.guideRecommendations,
    onboarding,
  });
  if (onboarding) {
    return {
      summary: guide.headline,
      suggestedActions,
      guide,
      presentation: "onboarding",
    };
  }
  // Only recite workspace-overview counts when the user asks about scope. For greetings,
  // reply warmly; for other general chat leave summary empty (chips only) so 大白 never
  // answers "早上好" with "当前可见 N 个机器人、N 个协作群".
  const isScopeQuestion = looksLikeWorkspaceScopeQuestion(params.message);
  let summary = "";
  if (isScopeQuestion) {
    summary = buildDaibaiWorkspaceOverviewSummary(params.workspaceOverview);
  } else if (looksLikeGreeting(params.message)) {
    summary =
      "你好，我是大白。有什么可以帮你的？整理/发布文档、查看支持进度、代办操作都可以，直接说就行。";
  }
  return {
    summary,
    supportContext: supportContext && supportContext.openCaseCount > 0 ? supportContext : undefined,
    latestProposal,
    workspaceOverview: isScopeQuestion ? params.workspaceOverview : undefined,
    suggestedActions,
    presentation: "default",
  };
}

export const daibaiHandlers: GatewayRequestHandlers = {
  "user.daibai.ask": async ({ params, respond, client }) => {
    if (!assertValidParams(params, validateDaibaiAskParams, "user.daibai.ask", respond)) {
      return;
    }
    // Load steward memory for personalization (failure-isolated: never blocks response).
    let memory: StewardMemory | null = null;
    try {
      memory = await loadStewardMemory({ userId: params.userId, tenantId: params.tenantId });
    } catch {
      // Degrade gracefully: return non-personalized result.
    }
    // Capability discovery: full recommendations (personal+position+platform) need client + async.
    // Failure-isolated: fall back to the sync personal-only guide when unavailable.
    let guideRecommendations:
      | Array<{ capabilityId: string; name: string; reason: string }>
      | undefined;
    try {
      const full = await buildEmployeeCapabilityRecommendations(
        resolveDefaultAgentId(loadConfig()),
        client,
      );
      if (full.length > 0) {
        guideRecommendations = full.map((entry) => ({
          capabilityId: entry.capability.id,
          name: entry.capability.name,
          reason: entry.reason,
        }));
      }
    } catch {
      // Degrade to sync personal-only recommendations inside buildStewardGuideSnapshot.
    }
    const supportCases = await listSupportCaseRecords({
      userId: params.userId,
      tenantId: params.tenantId,
    });
    let workspaceOverview: DaibaiWorkspaceOverview | undefined;
    try {
      workspaceOverview = await resolveDaibaiWorkspaceOverview({
        client,
        sessionKey: params.sessionKey,
        sourceSessionKey:
          typeof params.sourceSessionKey === "string" ? params.sourceSessionKey : undefined,
      });
    } catch {
      // Additive snapshot only; do not block Daibai responses when it fails.
    }
    respond(
      true,
      buildAskResult({
        message: params.message,
        sessionKey: params.sessionKey,
        sourceSessionKey:
          typeof params.sourceSessionKey === "string" ? params.sourceSessionKey : undefined,
        tenantId: params.tenantId,
        userId: params.userId,
        supportCases,
        memory,
        guideRecommendations,
        workspaceOverview,
      }),
      undefined,
    );
    // Async write-back: record this interaction for future personalization.
    // Fire-and-forget; failure does not affect the response already sent.
    // Skip internal/system-injected prompts (e.g. the onboarding guide话术): they are
    // instructions to the LLM, not user intents. Recording them pollutes lastIntents and
    // would later leak verbatim into the escalation context card ("近期问题").
    if (!isDaibaiOnboardingGuideMessage(params.message)) {
      appendStewardInteraction({
        userId: params.userId,
        tenantId: params.tenantId,
        intent: {
          summary: params.message.slice(0, 200),
          atMs: Date.now(),
        },
      }).catch(() => {});
    }
  },
  "user.daibai.execute": async ({ params, respond, client }) => {
    if (!assertValidParams(params, validateDaibaiExecuteParams, "user.daibai.execute", respond)) {
      return;
    }
    const payload = params.payload ?? {};
    const action = resolveStewardAction(params.actionId);
    if (!action) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, `unsupported daibai action: ${params.actionId}`),
      );
      return;
    }

    // Operator-scope gate (connect-aware). Unauthorized → translate to escalation guidance
    // rather than a hard error, so the UI can offer "升级给平台" (Phase 7).
    try {
      assertActionAllowedForScopes(action, client);
    } catch (err) {
      if (err instanceof StewardAuthorizationError) {
        const escalationDraft = buildEscalationDraft({
          message:
            typeof payload.userProblem === "string" && payload.userProblem.trim()
              ? payload.userProblem.trim()
              : `代办动作 ${params.actionId} 因权限不足被拦截`,
          sessionKey: params.sessionKey,
          failureReason: "operator scope 不足",
        });
        respond(
          true,
          {
            actionId: params.actionId,
            status: "blocked",
            message: "这个操作超出你当前的权限，我可以帮你把它整理成支持单升级给平台处理。",
            escalationDraft,
          } satisfies DaibaiExecuteResult,
          undefined,
        );
        return;
      }
      throw err;
    }

    // Ownership preflight (decision H): for actions targeting a robot, the target agentId
    // must belong to the current user's manageable set. Reject arbitrary agentId injection.
    let resolvedAgentId: string | undefined;
    if (action.requiresOwnershipCheck) {
      try {
        resolvedAgentId = assertAgentManageable(payload.agentId);
      } catch (err) {
        if (err instanceof StewardOwnershipError) {
          const escalationDraft = buildEscalationDraft({
            message:
              typeof payload.userProblem === "string" && payload.userProblem.trim()
                ? payload.userProblem.trim()
                : `代办动作 ${params.actionId} 因机器人归属校验失败`,
            sessionKey: params.sessionKey,
            failureReason: `目标 agent 不可管: ${err.agentId}`,
          });
          respond(
            true,
            {
              actionId: params.actionId,
              status: "blocked",
              message: "这个机器人不在你可管理的范围内，我无法代你操作它的技能。",
              escalationDraft,
            } satisfies DaibaiExecuteResult,
            undefined,
          );
          return;
        }
        throw err;
      }
    }

    // Per-action payload validation (preserve precise error messages).
    if (params.actionId === "support.case.reply_user") {
      const caseId = typeof payload.caseId === "string" ? payload.caseId : "";
      const proposalVersion =
        typeof payload.proposalVersion === "number" ? payload.proposalVersion : 0;
      if (!caseId || proposalVersion <= 0) {
        respond(
          false,
          undefined,
          errorShape(
            ErrorCodes.INVALID_REQUEST,
            "support.case.reply_user requires payload.caseId and payload.proposalVersion",
          ),
        );
        return;
      }
    } else if (params.actionId === "support.case.apply_resolution") {
      const caseId = typeof payload.caseId === "string" ? payload.caseId : "";
      if (!caseId) {
        respond(
          false,
          undefined,
          errorShape(
            ErrorCodes.INVALID_REQUEST,
            "support.case.apply_resolution requires payload.caseId",
          ),
        );
        return;
      }
    } else if (params.actionId === "support.case.close") {
      const caseId = typeof payload.caseId === "string" ? payload.caseId : "";
      if (!caseId) {
        respond(
          false,
          undefined,
          errorShape(ErrorCodes.INVALID_REQUEST, "support.case.close requires payload.caseId"),
        );
        return;
      }
    } else if (params.actionId === "supervisor.task.abort") {
      const taskId = typeof payload.taskId === "string" ? payload.taskId : "";
      if (!taskId) {
        respond(
          false,
          undefined,
          errorShape(ErrorCodes.INVALID_REQUEST, "supervisor.task.abort requires payload.taskId"),
        );
        return;
      }
    }

    // Build the effective delegation context (with ownership-resolved agentId).
    const ctx = {
      userId: params.userId,
      tenantId: params.tenantId,
      sessionKey: params.sessionKey,
      payload,
      resolvedAgentId,
    };

    // Confirmation flow (decision G): irreversible/sensitive writes require a server-issued ticket.
    if (action.requiresUserConfirmation) {
      const effectiveParams = action.buildParams(ctx);
      const proposalId = typeof params.proposalId === "string" ? params.proposalId : "";
      const confirmationToken =
        typeof params.confirmationToken === "string" ? params.confirmationToken : "";
      if (!proposalId || !confirmationToken) {
        // First call: issue a confirmation ticket bound to the effective params.
        const confirmation = createConfirmation({
          actionId: params.actionId,
          payload: effectiveParams,
        });
        respond(
          true,
          {
            actionId: params.actionId,
            status: "pending_confirmation",
            message: `请确认是否执行：${action.title}。确认后我才会代你操作。`,
            confirmation,
            confirmationDetail: {
              title: action.title,
              impact: action.impact,
              secondaryPermission: action.secondaryPermission,
              irreversible: action.irreversible === true,
              expiresAtMs: confirmation.expiresAtMs,
            },
          } satisfies DaibaiExecuteResult,
          undefined,
        );
        return;
      }
      // Second call: validate + single-consume the ticket (replay/idempotency/tamper protection).
      const consume = consumeConfirmation({
        proposalId,
        confirmationToken,
        actionId: params.actionId,
        payload: effectiveParams,
      });
      if (!consume.ok) {
        const reasonMessage: Record<string, string> = {
          not_found: "确认已失效或已被使用，请重新发起这个操作。",
          expired: "确认已过期，请重新发起这个操作。",
          token_mismatch: "确认凭据不匹配，请重新发起这个操作。",
          action_mismatch: "确认凭据与操作不匹配，请重新发起这个操作。",
          payload_mismatch: "操作内容已变化，请重新确认后再执行。",
        };
        respond(
          true,
          {
            actionId: params.actionId,
            status: "blocked",
            message: reasonMessage[consume.reason] ?? "确认校验未通过，请重新发起这个操作。",
          } satisfies DaibaiExecuteResult,
          undefined,
        );
        return;
      }
    }

    // Delegate via the steward dispatch substrate (catalog → scope gate → service).
    let raw: unknown;
    try {
      raw = await invokeStewardDelegate({ action, ctx, client });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, message));
      return;
    }

    const result = mapDelegateResultToExecuteResult(params.actionId, raw);
    if (!result) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, `unsupported daibai action: ${params.actionId}`),
      );
      return;
    }
    respond(true, result, undefined);
  },
};

/** 把 service 原始返回映射为统一的 DaibaiExecuteResult（保留各动作原文案）。 */
function mapDelegateResultToExecuteResult(
  actionId: string,
  raw: unknown,
): DaibaiExecuteResult | null {
  if (actionId === "support.case.create") {
    const created = raw as SupportCase;
    return {
      actionId,
      status: "executed",
      message: "我已经帮你创建了支持单，并会继续跟进平台技术团队的处理结果。",
      caseId: created.caseId,
      supportCase: created,
    };
  }
  if (actionId === "support.case.reply_user") {
    const updated = raw as SupportCase;
    return {
      actionId,
      status: "executed",
      message: "我已经记录你看过平台回复了，接下来可以继续让我代你执行建议动作。",
      caseId: updated.caseId,
      supportCase: updated,
    };
  }
  if (actionId === "support.case.apply_resolution") {
    const outcome = raw as { blocked: boolean; message?: string; supportCase: SupportCase };
    if (outcome.blocked) {
      return {
        actionId,
        status: "blocked",
        message: outcome.message ?? "这个支持单还没有平台给出的可执行方案。",
        caseId: outcome.supportCase.caseId,
        supportCase: outcome.supportCase,
      };
    }
    return {
      actionId,
      status: "executed",
      message: "我已经按照当前支持单的解决方案完成收口。",
      caseId: outcome.supportCase.caseId,
      supportCase: outcome.supportCase,
    };
  }
  if (actionId === "support.case.close") {
    const updated = raw as SupportCase;
    return {
      actionId,
      status: "executed",
      message: "我已经帮你关闭了这条支持单，后续若还有问题可以随时再发起。",
      caseId: updated.caseId,
      supportCase: updated,
    };
  }
  if (actionId === "robot-skills.toggle") {
    return {
      actionId,
      status: "executed",
      message: "我已经按你的要求调整了该机器人的技能开关。",
    };
  }
  if (actionId === "robot-skills.upgrade") {
    return {
      actionId,
      status: "executed",
      message: "我已经帮你把该机器人的技能升级到最新版本。",
    };
  }
  if (actionId === "robot-skills.remove") {
    return {
      actionId,
      status: "executed",
      message: "我已经帮你卸载了该机器人的这个技能。",
    };
  }
  if (actionId === "budget.set") {
    return {
      actionId,
      status: "executed",
      message: "我已经按你的要求更新了企业月度预算。",
    };
  }
  if (actionId === "supervisor.task.create") {
    const task = raw as { taskId: string; goal: string; state: string; repoRoot: string };
    return {
      actionId,
      status: "executed",
      message: `已创建开发监督任务 ${task.taskId}。你可以在「我的任务 → 开发监督」看板查看进度。`,
      supervisorTaskId: task.taskId,
      supervisorTask: {
        taskId: task.taskId,
        goal: task.goal,
        state: task.state,
        repoRoot: task.repoRoot,
      },
    };
  }
  if (actionId === "supervisor.task.abort") {
    const task = raw as { taskId: string; goal: string; state: string; repoRoot: string };
    return {
      actionId,
      status: "executed",
      message: `已中止开发监督任务 ${task.taskId}。`,
      supervisorTaskId: task.taskId,
      supervisorTask: {
        taskId: task.taskId,
        goal: task.goal,
        state: task.state,
        repoRoot: task.repoRoot,
      },
    };
  }
  if (actionId === "schedule.entry.add") {
    const outcome = raw as { entry?: { id?: string; title?: string } };
    const title = outcome.entry?.title?.trim();
    return {
      actionId,
      status: "executed",
      message: title ? `已把「${title}」写入你的日程管理。` : "已把这条日程写入你的日程管理。",
    };
  }
  return null;
}
