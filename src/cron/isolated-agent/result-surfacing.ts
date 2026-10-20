import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { buildEmployeeBuiltinStewardSessionKey } from "../../agents/builtin-steward/employee-isolation.js";
import { isBuiltinStewardAgent } from "../../agents/builtin-steward/identity.js";
import {
  finalizeDeliveryContext,
  judgeSessionOutbound,
} from "../../agents/execution-preflight/completion-hold.js";
import { DELIVERY_HOLD_NOTICE } from "../../agents/execution-preflight/delivery.js";
import type { HookDeliveryResult } from "../../agents/execution-preflight/hook-delivery.js";
import {
  readExecutionTraces,
  recordExecutionTrace,
} from "../../agents/execution-preflight/trace.js";
import type { ExecutionTraceRecord } from "../../agents/execution-preflight/types.js";
import { readLatestValidationReceipt } from "../../agents/execution-preflight/validation.js";
import {
  loadSessionStore,
  resolveAgentMainSessionKey,
  resolveStorePath,
} from "../../config/sessions.js";
import type { OpenBotConfig } from "../../config/types.js";
import {
  commitAutomaticPark,
  enrichFocusSnapshotWithBoard,
} from "../../conversation-task/session-task-board.js";
import { callGateway } from "../../gateway/call.js";
import { ensureHookSurfaceTranscript } from "../../gateway/hook-surface-session.js";
import { emitAgentEvent } from "../../infra/agent-events.js";
import { logWarn } from "../../logger.js";
import { normalizeAgentId } from "../../routing/session-key.js";
import {
  formatCronParkedNoticeMessage,
  formatCronResultSurfaceMessage as formatCronResultSurfaceMessageTemplate,
  type CronSkillDeliveryState,
} from "../cron-result-template.js";
import { resolveCronDeliverySurfaces } from "../delivery-surfaces.js";
import type { CronDeliverySurface, CronJob, CronRunStatus } from "../types.js";
import {
  decideCronMainSessionSurface,
  readLastUserMessageAtMsFromTranscript,
  focusSnapshotFromLastUserActivity,
  shouldInjectCronResultIntoMainSession,
  shouldNotifyCronWakeOnMainSession,
} from "./main-session-focus.js";

export function formatCronResultSurfaceMessage(params: {
  job: CronJob;
  status: CronRunStatus;
  summary?: string;
  error?: string;
  durationMs?: number;
}): string {
  return formatCronResultSurfaceMessageTemplate({
    jobName: params.job.name,
    jobId: params.job.id,
    status: params.status,
    summary: params.summary,
    error: params.error,
    durationMs: params.durationMs,
    skillDelivery: skillDeliveryFromSummary(params.summary),
  });
}

function skillDeliveryFromSummary(summary: string | undefined): CronSkillDeliveryState | undefined {
  if (!summary?.includes(DELIVERY_HOLD_NOTICE)) {
    return undefined;
  }
  return "delivery_blocked";
}

function isResolvableSessionKey(value: string | undefined): value is string {
  return Boolean(value?.trim() && value.includes(":"));
}

export function resolveCronSurfaceSessionKey(params: {
  cfg: OpenBotConfig;
  job: CronJob;
  agentId: string;
  surface: CronDeliverySurface;
}): string | undefined {
  if (params.surface === "workbench-agent-main") {
    const agentId = normalizeAgentId(params.agentId);
    if (!agentId) {
      return undefined;
    }
    const ownerId = params.job.ownership?.ownerId?.trim();
    if (ownerId && isBuiltinStewardAgent(agentId)) {
      return buildEmployeeBuiltinStewardSessionKey(ownerId);
    }
    return resolveAgentMainSessionKey({ cfg: params.cfg, agentId });
  }

  const sessionKey = params.job.sessionKey?.trim();
  if (isResolvableSessionKey(sessionKey)) {
    return sessionKey;
  }
  return undefined;
}

function readCronSessionFile(params: {
  cfg: OpenBotConfig;
  agentId: string;
  sessionKey: string;
}): string | undefined {
  try {
    const storePath = resolveStorePath(params.cfg.session?.store, { agentId: params.agentId });
    const sessionFile = loadSessionStore(storePath)[params.sessionKey]?.sessionFile?.trim();
    return sessionFile && fs.existsSync(sessionFile) ? sessionFile : undefined;
  } catch {
    return undefined;
  }
}

function readLastUserAtMsForSession(params: {
  cfg: OpenBotConfig;
  agentId: string;
  sessionKey: string;
}): number | undefined {
  try {
    const sessionFile = readCronSessionFile(params);
    if (!sessionFile) {
      return undefined;
    }
    const stat = fs.statSync(sessionFile);
    const maxBytes = 256_000;
    const start = Math.max(0, stat.size - maxBytes);
    const buf = Buffer.alloc(stat.size - start);
    const fd = fs.openSync(sessionFile, "r");
    try {
      fs.readSync(fd, buf, 0, buf.length, start);
    } finally {
      fs.closeSync(fd);
    }
    return readLastUserMessageAtMsFromTranscript(buf.toString("utf8"));
  } catch {
    return undefined;
  }
}

export async function surfaceCronJobResult(params: {
  cfg: OpenBotConfig;
  job: CronJob;
  agentId: string;
  runId?: string;
  /** Cron run correlation for the inject payload. Not a delivery task id. */
  cronRunId?: string;
  result: {
    status: CronRunStatus;
    summary?: string;
    error?: string;
  };
  durationMs?: number;
  nowMs?: number;
  lastUserAtMs?: number;
  /** Set only for gateway hook dispatches. Ordinary cron leaves this unset. */
  ingress?: "hook";
  isolatedSessionId?: string;
  workspaceDir?: string;
  tenantId?: string;
  /** Same-attempt delivery evidence. Absent means the run did not carry a structured result. */
  hookDelivery?: HookDeliveryResult;
  /** Set when the skill contract requires a validator and the structured result is missing. */
  validatorsRequired?: boolean;
  /** Preflight task id frozen from the embedded attempt. Not the hook job id. */
  attemptTaskId?: string;
}): Promise<string[]> {
  const surfaces = resolveCronDeliverySurfaces(params.job);
  if (surfaces.length === 0) {
    return [];
  }

  const fullMessage = formatCronResultSurfaceMessage({
    job: params.job,
    status: params.result.status,
    summary: params.result.summary,
    error: params.result.error,
    durationMs: params.durationMs,
  });
  const label = `定时任务 · ${params.job.name.trim() || params.job.id}`;
  // Stamped server-side at job creation from the authenticated session, so it is a
  // platform user id that membership lookup can turn back into a tenant.
  const surfaceOwnerPlatformUserId = params.job.ownership?.ownerId?.trim();
  const surfaced: string[] = [];

  for (const surface of surfaces) {
    const sessionKey = resolveCronSurfaceSessionKey({
      cfg: params.cfg,
      job: params.job,
      agentId: params.agentId,
      surface,
    });
    if (!sessionKey) {
      logWarn(
        `cron: skipped workbench result surface (jobId=${params.job.id}, surface=${surface}, reason=session key unresolved)`,
      );
      continue;
    }
    let message = fullMessage;
    let cronResultKind: "result" | "parked_notice" | undefined;
    if (surface === "workbench-agent-main") {
      const lastUserAtMs =
        params.lastUserAtMs ??
        readLastUserAtMsForSession({
          cfg: params.cfg,
          agentId: params.agentId,
          sessionKey,
        });
      const sessionFile = readCronSessionFile({
        cfg: params.cfg,
        agentId: params.agentId,
        sessionKey,
      });
      const snapshot = enrichFocusSnapshotWithBoard(
        focusSnapshotFromLastUserActivity({
          lastUserAtMs,
          nowMs: params.nowMs ?? Date.now(),
        }),
        sessionFile,
      );
      const decision = decideCronMainSessionSurface({
        jobId: params.job.id,
        conversationTaskId: params.job.conversationTaskId,
        snapshot,
      });
      if (shouldInjectCronResultIntoMainSession(decision)) {
        cronResultKind = "result";
      } else if (shouldNotifyCronWakeOnMainSession(decision)) {
        if (decision.action === "park") {
          commitAutomaticPark({
            sessionFile,
            incomingTaskId: decision.taskId,
            nowMs: params.nowMs ?? Date.now(),
          });
        }
        message = formatCronParkedNoticeMessage({
          jobName: params.job.name,
          jobId: params.job.id,
          reason: "park",
          ...(decision.action === "park"
            ? {
                droppedTaskId: decision.droppedTaskId,
                droppedTitle: decision.droppedTitle,
                droppedPaths: decision.droppedPaths,
              }
            : {}),
        });
        cronResultKind = "parked_notice";
      } else {
        logWarn(
          `cron: skipped workbench-agent-main inject (jobId=${params.job.id}, sessionKey=${sessionKey}, action=${decision.action})`,
        );
        continue;
      }
    }
    const taskId = resolveSurfaceExecutionTaskId(params);
    const hookSurface = params.ingress === "hook" && surface === "workbench-agent-main";
    let hookTranscript: string | undefined;
    if (hookSurface) {
      const ensured = await ensureHookSurfaceTranscript({
        cfg: params.cfg,
        agentId: params.agentId,
        sessionKey,
        workspaceDir: params.workspaceDir ?? "",
        ...(params.tenantId ? { tenantId: params.tenantId } : {}),
      });
      if (!ensured.ok) {
        recordHookSurfaceObservation({
          taskId,
          sessionKey,
          isolatedSessionId: params.isolatedSessionId,
          hookJobId: params.job.id,
          decisionCode: ensured.reason,
          deliveryOutcome: "blocked",
          transportOutcome: "not_called",
          cleanupReason: "retained",
        });
        continue;
      }
      hookTranscript = ensured.sessionFile;
    }
    const delivery = params.hookDelivery;
    const validatorsRequired =
      hookSurface && (delivery?.validatorsRequired === true || params.validatorsRequired === true);
    const attemptTaskId = params.attemptTaskId?.trim() || "";
    const deliveryTaskId = delivery?.taskId?.trim() || "";
    const taskMismatch = Boolean(
      validatorsRequired &&
      delivery &&
      attemptTaskId &&
      deliveryTaskId &&
      deliveryTaskId !== attemptTaskId,
    );
    const trustedTaskId = validatorsRequired ? deliveryTaskId : deliveryTaskId || taskId;
    if (validatorsRequired && (!delivery || !deliveryTaskId || taskMismatch)) {
      recordHookSurfaceObservation({
        taskId: deliveryTaskId || attemptTaskId || undefined,
        sessionKey,
        isolatedSessionId: params.isolatedSessionId,
        hookJobId: params.job.id,
        cronRunId: params.cronRunId,
        attemptTaskId,
        decisionCode: taskMismatch ? "hook_delivery_task_mismatch" : "hook_delivery_result_missing",
        deliveryOutcome: "blocked",
        transportOutcome: "blocked",
        cleanupReason: "retained",
        hookDeliveryPresent: Boolean(delivery),
        validatorsRequired: true,
        hookDeliveryDecisionCode: delivery?.decisionCode,
        hookDeliveryTaskMatch: taskMismatch ? false : undefined,
      });
      continue;
    }
    if (hookSurface && delivery?.validatorsRequired) {
      const admitted =
        delivery.allowedToDeliver && delivery.decisionCode === "delivery_receipt_verified";
      if (!admitted) {
        recordHookSurfaceObservation({
          taskId: trustedTaskId,
          sessionKey,
          isolatedSessionId: params.isolatedSessionId,
          hookJobId: params.job.id,
          cronRunId: params.cronRunId,
          attemptTaskId,
          decisionCode: delivery.decisionCode,
          deliveryOutcome: "blocked",
          transportOutcome: "blocked",
          cleanupReason: "retained",
          hookDeliveryPresent: true,
          validatorsRequired: true,
          hookDeliveryDecisionCode: delivery.decisionCode,
          hookDeliveryTaskMatch: true,
        });
        continue;
      }
    }
    const hookTrace = {
      cronRunId: params.cronRunId,
      attemptTaskId,
      hookDeliveryPresent: Boolean(delivery),
      validatorsRequired,
      ...(delivery?.decisionCode ? { hookDeliveryDecisionCode: delivery.decisionCode } : {}),
      hookDeliveryTaskMatch: validatorsRequired ? deliveryTaskId === attemptTaskId : undefined,
    };
    const receiptVerified =
      hookSurface &&
      delivery?.validatorsRequired === true &&
      delivery.allowedToDeliver &&
      delivery.decisionCode === "delivery_receipt_verified";
    const deliveryDecision = judgeSessionOutbound(
      sessionKey,
      message,
      "cron_result",
      trustedTaskId,
    );
    if (deliveryDecision?.outcome === "completion_blocked" && !receiptVerified) {
      if (hookSurface) {
        recordHookSurfaceObservation({
          taskId,
          sessionKey,
          isolatedSessionId: params.isolatedSessionId,
          hookJobId: params.job.id,
          decisionCode: deliveryDecision.decisionCode,
          deliveryOutcome: "blocked",
          transportOutcome: "not_called",
          cleanupReason: "retained",
        });
      }
      continue;
    }
    const cronRunId = params.cronRunId?.trim() || params.runId?.trim() || undefined;
    if (hookTranscript && transcriptHasCronResult(hookTranscript, params.job.id, cronRunId)) {
      recordHookSurfaceObservation({
        taskId: trustedTaskId,
        sessionKey,
        isolatedSessionId: params.isolatedSessionId,
        hookJobId: params.job.id,
        ...hookTrace,
        decisionCode: receiptVerified
          ? "delivery_receipt_verified"
          : (deliveryDecision?.decisionCode ?? "delivery_allowed"),
        deliveryOutcome: "allowed",
        transportOutcome: "already_delivered",
        cleanupReason: "none",
      });
      surfaced.push(sessionKey);
      continue;
    }
    const outboundMessage = deliveryDecision?.visibleText ?? message;
    if (receiptVerified) {
      recordHookSurfaceObservation({
        taskId: trustedTaskId,
        sessionKey,
        isolatedSessionId: params.isolatedSessionId,
        hookJobId: params.job.id,
        ...hookTrace,
        decisionCode: "delivery_receipt_verified",
        deliveryOutcome: "allowed",
        transportOutcome: "not_called",
        cleanupReason: "retained",
      });
    }
    try {
      await callGateway({
        method: "chat.inject",
        params: {
          sessionKey,
          message: outboundMessage,
          label,
          cronJobId: params.job.id,
          ...(cronRunId ? { cronRunId } : {}),
          ...(params.job.name?.trim() ? { cronJobName: params.job.name.trim() } : {}),
          ...(cronResultKind ? { cronResultKind } : {}),
          // `callGateway` reaches the gateway over a loopback CLI/operator socket, which
          // carries no user. Under shared tenant addressing the inject handler then has
          // no identity to resolve a tenant from and fails closed with
          // `unresolved_tenant`, so the result never reaches the owner's workbench.
          // The job already names its owner (the same id used to build the session key
          // above), so hand it over explicitly; `gatewayClientForSessionOwner` binds it
          // only when the socket itself is identity-less, so an authenticated caller is
          // never overridden.
          ...(surfaceOwnerPlatformUserId
            ? { sessionOwnerPlatformUserId: surfaceOwnerPlatformUserId }
            : {}),
        },
        timeoutMs: 20_000,
      });
      surfaced.push(sessionKey);
      const cleaned = Boolean(
        trustedTaskId &&
        (receiptVerified || deliveryDecision?.outcome === "completion_allowed") &&
        finalizeDeliveryContext({ taskId: trustedTaskId, outcome: "delivered" }),
      );
      if (hookSurface) {
        recordHookSurfaceObservation({
          taskId: trustedTaskId,
          sessionKey,
          isolatedSessionId: params.isolatedSessionId,
          hookJobId: params.job.id,
          ...hookTrace,
          decisionCode: receiptVerified
            ? "delivery_receipt_verified"
            : (deliveryDecision?.decisionCode ?? "delivery_allowed"),
          deliveryOutcome: "allowed",
          transportOutcome: "ok",
          cleanupReason: cleaned ? "delivered" : "none",
        });
      }
    } catch (err) {
      if (hookSurface) {
        recordHookSurfaceObservation({
          taskId: trustedTaskId,
          sessionKey,
          isolatedSessionId: params.isolatedSessionId,
          hookJobId: params.job.id,
          ...hookTrace,
          decisionCode: receiptVerified
            ? "delivery_receipt_verified"
            : (deliveryDecision?.decisionCode ?? "delivery_allowed"),
          deliveryOutcome: "allowed",
          transportOutcome: "failed",
          cleanupReason: "retained",
        });
      }
      logWarn(
        `cron: workbench result surface inject failed (jobId=${params.job.id}, surface=${surface}, sessionKey=${sessionKey}, err=${String(err)})`,
      );
    }
  }

  return surfaced;
}

function transcriptHasCronResult(file: string, jobId: string, runId: string | undefined): boolean {
  let text: string;
  try {
    text = fs.readFileSync(file, "utf8");
  } catch {
    return false;
  }
  for (const line of text.split("\n")) {
    if (!line.includes("openclawCronResult")) {
      continue;
    }
    try {
      const parsed = JSON.parse(line) as {
        message?: { openclawCronResult?: { jobId?: string; runId?: string } };
        openclawCronResult?: { jobId?: string; runId?: string };
      };
      const cron = parsed.message?.openclawCronResult ?? parsed.openclawCronResult;
      if (cron?.jobId !== jobId) {
        continue;
      }
      if (runId && cron.runId && cron.runId !== runId) {
        continue;
      }
      return true;
    } catch {
      // A malformed transcript line is not an idempotency hit.
    }
  }
  return false;
}

function idHash(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  if (!trimmed) {
    return undefined;
  }
  return createHash("sha256").update(trimmed).digest("hex").slice(0, 16);
}

function recordHookSurfaceObservation(params: {
  taskId?: string;
  sessionKey: string;
  isolatedSessionId?: string;
  hookJobId: string;
  cronRunId?: string;
  attemptTaskId?: string;
  decisionCode: string;
  deliveryOutcome: "allowed" | "blocked";
  transportOutcome: NonNullable<ExecutionTraceRecord["transportOutcome"]>;
  cleanupReason: NonNullable<ExecutionTraceRecord["cleanupReason"]>;
  hookDeliveryPresent?: boolean;
  validatorsRequired?: boolean;
  hookDeliveryDecisionCode?: string;
  hookDeliveryTaskMatch?: boolean;
}): void {
  const taskId = params.taskId?.trim() || (params.validatorsRequired ? "" : params.hookJobId);
  const prior = params.taskId ? readExecutionTraces(params.taskId).at(-1) : undefined;
  const receipt = params.taskId ? readLatestValidationReceipt(params.taskId) : undefined;
  const artifactPath = receipt?.artifactPath?.trim() ?? "";
  const safeRelative =
    artifactPath.length > 0 &&
    !path.isAbsolute(artifactPath) &&
    !artifactPath.includes("..") &&
    !artifactPath.includes("\0");
  const record: ExecutionTraceRecord = {
    taskId,
    sessionId: params.isolatedSessionId?.trim() || prior?.sessionId || params.sessionKey,
    attemptNumber: prior?.attemptNumber ?? 1,
    intentClass: prior?.intentClass ?? "hook",
    decisionStage: "hook_surface",
    decisionCode: params.decisionCode,
    toolName: "chat.inject",
    deliveryOutcome: params.deliveryOutcome,
    transportOutcome: params.transportOutcome,
    cleanupReason: params.cleanupReason,
    ...(idHash(params.hookJobId) ? { hookJobIdHash: idHash(params.hookJobId) } : {}),
    ...(idHash(params.cronRunId) ? { cronRunIdHash: idHash(params.cronRunId) } : {}),
    ...(idHash(params.attemptTaskId) ? { attemptTaskIdHash: idHash(params.attemptTaskId) } : {}),
    ...(params.hookDeliveryPresent !== undefined
      ? { hookDeliveryPresent: params.hookDeliveryPresent }
      : {}),
    ...(params.validatorsRequired !== undefined
      ? { validatorsRequired: params.validatorsRequired }
      : {}),
    ...(params.hookDeliveryDecisionCode
      ? { hookDeliveryDecisionCode: params.hookDeliveryDecisionCode }
      : {}),
    ...(params.hookDeliveryTaskMatch !== undefined
      ? { hookDeliveryTaskMatch: params.hookDeliveryTaskMatch }
      : {}),
    ...(receipt?.validatorId ? { validatorId: receipt.validatorId } : {}),
    ...(receipt?.validatorVersion ? { validatorVersion: receipt.validatorVersion } : {}),
    ...(safeRelative
      ? { artifactPathHash: createHash("sha256").update(artifactPath).digest("hex") }
      : {}),
    ...(receipt?.artifactHash ? { artifactSha256: receipt.artifactHash } : {}),
  };
  recordExecutionTrace(record);
  emitAgentEvent({
    runId: params.hookJobId,
    stream: "lifecycle",
    sessionKey: params.sessionKey,
    data: {
      phase: "hook_surface_delivery",
      taskId: record.taskId,
      attemptNumber: record.attemptNumber,
      isolatedSessionId: params.isolatedSessionId ?? "",
      hookJobId: params.hookJobId,
      validatorId: record.validatorId ?? "",
      validatorVersion: record.validatorVersion ?? "",
      artifactPathHash: record.artifactPathHash ?? "",
      artifactSha256: record.artifactSha256 ?? "",
      decisionCode: record.decisionCode,
      deliveryOutcome: record.deliveryOutcome,
      transportOutcome: record.transportOutcome,
      cleanupReason: record.cleanupReason,
      hookJobIdHash: record.hookJobIdHash ?? "",
      cronRunIdHash: record.cronRunIdHash ?? "",
      attemptTaskIdHash: record.attemptTaskIdHash ?? "",
      hookDeliveryPresent: record.hookDeliveryPresent === true,
      validatorsRequired: record.validatorsRequired === true,
      hookDeliveryDecisionCode: record.hookDeliveryDecisionCode ?? "",
      hookDeliveryTaskMatch: record.hookDeliveryTaskMatch === true,
    },
  });
}

/**
 * Bound conversationTaskId is the execution task. runId remains a fallback for
 * callers that already pass the execution task id. A missing id stays missing
 * so the delivery judge can fail closed instead of guessing the latest task.
 */
function resolveSurfaceExecutionTaskId(params: {
  runId?: string;
  job: { conversationTaskId?: string };
}): string | undefined {
  const bound = params.job.conversationTaskId?.trim();
  if (bound) {
    return bound;
  }
  const runId = params.runId?.trim();
  return runId || undefined;
}
