import {
  buildCliBackendCredentialGuidance,
  isLikelyCredentialError,
} from "../../../agents/cli-backend-credential-guidance.js";
import { retryAllowedForMessage } from "../../../agents/execution-preflight/index.js";
import {
  buildModelEntitlementEmptyUserMessage,
  isModelEntitlementEmptyError,
} from "../../../agents/model-fallback.js";
import { isCliProvider } from "../../../agents/model-selection.js";
import {
  isCompactionFailureError,
  isLikelyContextOverflowError,
  isTransientHttpError,
  sanitizeUserFacingText,
} from "../../../agents/pi-embedded-helpers.js";
import { isSandboxAccountIdentityError } from "../../../agents/sandbox/account-scope.js";
import { userFacingPreReplyFailure } from "../../../agents/sandbox/docker-engine-client.js";
import { isSoftRecoverableEntitlementFailure } from "../../../agents/sandbox/user-facing-entitlement-failure.js";
import { buildUserFacingModelCallFailure } from "../../../auto-reply/reply/model-call-failure-copy.js";
import {
  formatPlatformAdmissionEmptyMessage,
  isPlatformAdmissionEmptyError,
} from "../../../gateway/models/capability-admission/apply-runtime-admission.js";
import { defaultRuntime } from "../../../runtime.js";
import { TaskBudgetExceededError } from "../../../task-outcome/runtime-from-runner.js";
import { createTurnOutcomeRecorder } from "../outcomes/index.js";
import type { AdmittedTurnHost } from "./admitted-turn-host.js";
import type { AdmittedTurnLoopState } from "./admitted-turn-state.js";
import type { AgentRunLoopResult, AgentTurnExecutionParams } from "./turn-contract.js";

export type AdmittedTurnRecoveryOutcome =
  | { action: "continue" }
  | { action: "return"; result: AgentRunLoopResult };

export async function runAdmittedTurnRecovery(args: {
  err: unknown;
  params: AgentTurnExecutionParams;
  host: AdmittedTurnHost;
  runId: string;
  state: AdmittedTurnLoopState;
  recordGrowthTaskOutcome: ReturnType<typeof createTurnOutcomeRecorder>["commit"];
  assertTipBudgetAllowsModelCall: () => void;
  transientHttpRetryDelayMs: number;
  softEntitlementRetryDelayMs: number;
}): Promise<AdmittedTurnRecoveryOutcome> {
  const {
    err,
    params,
    host,
    runId,
    state,
    recordGrowthTaskOutcome,
    assertTipBudgetAllowsModelCall,
    transientHttpRetryDelayMs: TRANSIENT_HTTP_RETRY_DELAY_MS,
    softEntitlementRetryDelayMs: SOFT_ENTITLEMENT_RETRY_DELAY_MS,
  } = args;

  if (isSandboxAccountIdentityError(err)) {
    void recordGrowthTaskOutcome(false, {
      prepareFailed: true,
      failureReason: "authz_denied",
      errorMessage: "sandbox_account_identity_unavailable",
      failureDetail: "sandbox_account_identity_unavailable",
      skipBudgetCharge: state.tipBudgetChargedThisTurn,
    });
    return {
      action: "return",
      result: {
        kind: "final",
        payload: {
          text: "本次执行未启动：缺少可信的租户或用户身份，或身份与执行环境不一致。请重新登录或联系管理员核对账号绑定后重试。",
        },
      },
    };
  }

  if (err instanceof TaskBudgetExceededError) {
    void recordGrowthTaskOutcome(false, {
      failureReason: "other",
      failureDetail: err.message.slice(0, 200),
      skipBudgetCharge: state.tipBudgetChargedThisTurn,
    });
    return {
      action: "return",
      result: {
        kind: "final",
        payload: {
          text: "⚠️ 任务预算已耗尽，已停止继续调用模型。请缩小范围或开新任务后再试。",
        },
      },
    };
  }
  if (isModelEntitlementEmptyError(err)) {
    return {
      action: "return",
      result: {
        kind: "final",
        payload: {
          text: `⚠️ ${buildModelEntitlementEmptyUserMessage(state.modelGate?.entitlementHint)}`,
        },
      },
    };
  }
  if (isPlatformAdmissionEmptyError(err)) {
    return {
      action: "return",
      result: {
        kind: "final",
        payload: {
          text: `⚠️ ${formatPlatformAdmissionEmptyMessage(err.decision)}`,
        },
      },
    };
  }
  const message = err instanceof Error ? err.message : String(err);
  const isContextOverflow = isLikelyContextOverflowError(message);
  const isCompactionFailure = isCompactionFailureError(message);
  const isSessionCorruption = /function call turn comes immediately after/i.test(message);
  const isRoleOrderingError = /incorrect role information|roles must alternate/i.test(message);
  const isTransientHttp = isTransientHttpError(message);

  // CLI 后端凭证引导（Task 10/R3.4）：失败来自 CLI 后端且像"缺失/无效 API Key"时，
  // 在对话内给出"去平台/企业控制台配置凭证"的一次性引导，绝不要求用户本机命令行登录。
  if (
    isCliProvider(state.fallbackProvider, params.followupRun.run.config) &&
    isLikelyCredentialError(message)
  ) {
    return {
      action: "return",
      result: {
        kind: "final",
        payload: { text: buildCliBackendCredentialGuidance(state.fallbackProvider) },
      },
    };
  }

  if (
    isCompactionFailure &&
    !state.didResetAfterCompactionFailure &&
    (await params.resetSessionAfterCompactionFailure(message))
  ) {
    state.didResetAfterCompactionFailure = true;
    return {
      action: "return",
      result: {
        kind: "final",
        payload: {
          text: "⚠️ Context limit exceeded during compaction. I've reset our conversation to start fresh - please try again.\n\nTo prevent this, increase your compaction buffer by setting `agents.defaults.compaction.reserveTokensFloor` to 20000 or higher in your config.",
        },
      },
    };
  }
  if (isRoleOrderingError) {
    const didReset = await params.resetSessionAfterRoleOrderingConflict(message);
    if (didReset) {
      return {
        action: "return",
        result: {
          kind: "final",
          payload: {
            text: "⚠️ Message ordering conflict. I've reset the conversation - please try again.",
          },
        },
      };
    }
  }

  // Auto-recover from Gemini session corruption by resetting the session
  if (isSessionCorruption && params.sessionKey && params.activeSessionStore && params.storePath) {
    await host.sessions.resetCorruptedSession({
      sessionKey: params.sessionKey,
      activeSessionStore: params.activeSessionStore,
      storePath: params.storePath,
      getActiveSessionEntry: params.getActiveSessionEntry,
    });

    return {
      action: "return",
      result: {
        kind: "final",
        payload: {
          text: "⚠️ Session history was corrupted. I've reset the conversation - please try again!",
        },
      },
    };
  }

  if (isSoftRecoverableEntitlementFailure(message) && !state.didRetrySoftEntitlement) {
    state.didRetrySoftEntitlement = true;
    // lease-mismatch / stale-snapshot: refresh and self-advance once.
    // Never ask the user to 「重新发送」as fuel for a soft runtime stop.
    defaultRuntime.error(
      `Soft entitlement stop before reply (${message}). Self-advancing once in ${SOFT_ENTITLEMENT_RETRY_DELAY_MS}ms.`,
    );
    await new Promise<void>((resolve) => {
      setTimeout(resolve, SOFT_ENTITLEMENT_RETRY_DELAY_MS);
    });
    return { action: "continue" };
  }

  if (isTransientHttp && !state.didRetryTransientHttpError && retryAllowedForMessage(message)) {
    // Pre-retry budget gate: do not spend another model call when already exhausted.
    try {
      assertTipBudgetAllowsModelCall();
    } catch (gateErr) {
      if (gateErr instanceof TaskBudgetExceededError) {
        void recordGrowthTaskOutcome(false, {
          failureReason: "other",
          failureDetail: gateErr.message.slice(0, 200),
          skipBudgetCharge: state.tipBudgetChargedThisTurn,
        });
        return {
          action: "return",
          result: {
            kind: "final",
            payload: {
              text: "⚠️ 任务预算已耗尽，已停止继续调用模型。请缩小范围或开新任务后再试。",
            },
          },
        };
      }
      throw gateErr;
    }
    state.didRetryTransientHttpError = true;
    // Retry the full controlledExecution prepare→infer cycle — transient errors
    // (502/521/etc.) typically affect the whole provider, so falling
    // back to an alternate model first would not help. Instead we wait
    // and retry the complete primary→fallback chain through the same
    // controlled use-case (no parallel host.model.runWithModelFallback).
    defaultRuntime.error(
      `Transient HTTP provider error before reply (${message}). Retrying once in ${TRANSIENT_HTTP_RETRY_DELAY_MS}ms.`,
    );
    await new Promise<void>((resolve) => {
      setTimeout(resolve, TRANSIENT_HTTP_RETRY_DELAY_MS);
    });
    return { action: "continue" };
  }

  defaultRuntime.error(`Embedded agent failed before reply: ${message}`);
  const dockerFailure = userFacingPreReplyFailure(message);
  const isInfraStartupFailure =
    dockerFailure != null ||
    /EEXIST|Requested model .+ not supported|workspace_authorization_failed/i.test(message);
  const safeMessage = isTransientHttp
    ? sanitizeUserFacingText(message, { errorContext: true })
    : message;
  const trimmedMessage = safeMessage.replace(/\.\s*$/, "");
  const modelCallFailure = buildUserFacingModelCallFailure(
    message,
    params.opts?.expectedReplyLanguage,
  );
  const fallbackText = modelCallFailure
    ? `⚠️ ${modelCallFailure}`
    : dockerFailure
      ? dockerFailure
      : isContextOverflow
        ? "⚠️ Context overflow — prompt too large for this model. Try a shorter message or a larger-context model."
        : isRoleOrderingError
          ? "⚠️ Message ordering conflict - please try again. If this persists, use /new to start a fresh session."
          : isInfraStartupFailure
            ? "这一轮没能完成回复。请再试一次，或 @ 对应助手。"
            : `⚠️ Agent failed before reply: ${trimmedMessage}.\nLogs: openbot logs --follow`;

  void recordGrowthTaskOutcome(false, {
    aborted: Boolean(params.opts?.abortSignal?.aborted),
    providerFault: isTransientHttp || isInfraStartupFailure,
    prepareFailed: isInfraStartupFailure,
    errorMessage: message,
    failureDetail: trimmedMessage.slice(0, 200),
  });
  if (!params.opts?.abortSignal?.aborted && !isInfraStartupFailure && !isTransientHttp) {
    try {
      host.observability.recordHonestCapabilityGap({
        runId,
        agentId: params.followupRun.run.agentId ?? null,
        tenantId: state.modelGate?.tenantId?.trim() || null,
        sessionKey: params.followupRun.run.sessionKey ?? null,
        chatType: params.sessionCtx.ChatType ?? null,
        reason: isContextOverflow ? "context_overflow" : "unresolved_run_error",
        category: isContextOverflow ? "perception" : "tool",
        detail: trimmedMessage.slice(0, 160),
        userLanguageSummary: fallbackText.slice(0, 160),
        sourceKind: "run_error",
      });
    } catch {
      // evolution store must never fail the reply
    }
  }
  return {
    action: "return",
    result: {
      kind: "final",
      payload: {
        text: fallbackText,
      },
    },
  };
}
