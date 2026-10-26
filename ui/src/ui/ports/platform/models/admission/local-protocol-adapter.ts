/**
 * Local protocol verification adapter.
 *
 * Produces formal evidence only from CapabilityCheckRunner outcomes.
 * Does not call paid Midjourney/Suno/etc. APIs — inject a runner for tests
 * or use the default structural runner (connection-backed text_chat only).
 *
 * Batch-2 authenticity:
 * - Unexecuted checks → checker_unavailable / untested (never formal failed).
 * - Sync/async runner errors → terminal task status + UI notify.
 * - Refresh loses timers → interrupt in-flight tasks (no infinite running).
 * - Results bind configFingerprint + executionGeneration; stale finishes
 *   stay in history only and do not update formal evidence.
 */

import type { CapabilityEvidenceItem } from "../capability-evidence.ts";
import {
  CAPABILITY_LABEL_ZH,
  capabilityLabel,
  normalizeCapabilityIds,
  type CanonicalCapabilityId,
} from "../capability-ids.ts";
import {
  clearVerificationTaskLive,
  currentExecutionGeneration,
  getModelAdmission,
  getVerificationTask,
  listVerificationTasks,
  markVerificationTaskLive,
  mergeFormalCapabilityEvidence,
  nextExecutionGeneration,
  saveVerificationTask,
  setAutoRoutingAdmission,
  type CapabilityVerificationTask,
} from "../model-admission-store.ts";
import { getCurrentConfigFingerprint } from "../model-connection-gate.ts";
import type {
  BatchVerificationRequest,
  BatchVerificationResponse,
  CancelVerificationTaskRequest,
  CapabilityCheckRunner,
  CapabilityVerificationService,
  CreateVerificationTaskRequest,
  CreateVerificationTaskResponse,
  DiscoverCapabilitiesRequest,
  DiscoverCapabilitiesResponse,
  GetVerificationTaskRequest,
  ListVerificationTasksRequest,
  ProtocolCheckContext,
  ProtocolCheckOutcome,
  SetRoutingEligibilityRequest,
  SetRoutingEligibilityResponse,
  VerificationMode,
} from "./verification-contract.ts";

export type LocalProtocolAdapterOptions = {
  runner?: CapabilityCheckRunner;
  /**
   * Async delay before completing a task (ms). 0 = complete on next microtask
   * (or inline when using defaultSchedule).
   */
  settleDelayMs?: number;
  /** Optional scheduler for tests (receives work to run later). */
  schedule?: (work: () => void, delayMs: number) => void;
  /** Provide connectionOk lookup by modelRef + fingerprint. */
  resolveConnectionOk?: (modelRef: string, fingerprint?: string) => boolean;
  /**
   * Current config fingerprint for the model (finish-time check).
   * Defaults to getCurrentConfigFingerprint (published from config snapshot),
   * NOT admission.connectionFingerprint (last verified identity).
   */
  resolveCurrentFingerprint?: (modelRef: string) => string | undefined;
  /** Called whenever a task reaches a terminal or interrupted state (UI refresh). */
  onTaskSettled?: (task: CapabilityVerificationTask) => void;
  /**
   * When runner returns pending outcomes, wait this long then finalize as
   * checker_unavailable with a timeout note. Default 30s; tests inject smaller.
   */
  pendingTimeoutMs?: number;
};

function newTaskId(): string {
  return `cvt_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function defaultSchedule(work: () => void, delayMs: number) {
  if (delayMs <= 0) {
    queueMicrotask(work);
    return;
  }
  setTimeout(work, delayMs);
}

function isPromiseLike<T>(value: unknown): value is Promise<T> {
  return (
    !!value && typeof value === "object" && typeof (value as { then?: unknown }).then === "function"
  );
}

/**
 * Default runner: formal text_chat may pass when connectionOk (reusing probe
 * identity). tool_use / image / music are checker_unavailable — not failed —
 * until a specialized runner actually executes them.
 */
export function createDefaultProtocolRunner(
  resolveConnectionOk?: (modelRef: string, fingerprint?: string) => boolean,
): CapabilityCheckRunner {
  return {
    check(ctx: ProtocolCheckContext): ProtocolCheckOutcome[] {
      const connectionOk =
        ctx.connectionOk ?? resolveConnectionOk?.(ctx.modelRef, ctx.configFingerprint) ?? false;
      const admission = getModelAdmission(ctx.modelRef);
      return ctx.capabilityIds.map((id) => {
        if (id === "text_chat") {
          if (connectionOk) {
            const existing = admission.capabilityEvidence.find(
              (item) => item.id === "text_chat" && item.status === "passed",
            );
            const verifiedAt = existing?.verifiedAt ?? admission.connectionVerifiedAt ?? undefined;
            return {
              capabilityId: id,
              status: "passed" as const,
              testVersion: existing?.testVersion ?? "local-protocol-v1",
              sourceNote: existing
                ? "复用已通过的连接协议探测（指纹绑定）"
                : "连接协议探测通过（指纹绑定）",
              verifiedAt,
              expiresAt: existing?.expiresAt ?? Date.now() + 7 * 24 * 60 * 60 * 1000,
              reuseExistingEvidence: Boolean(existing),
            };
          }
          return {
            capabilityId: id,
            status: "failed" as const,
            failureReason: "连接未验证或指纹不匹配，不能证明文本对话可用",
            testVersion: "local-protocol-v1",
          };
        }
        if (id === "tool_use") {
          return {
            capabilityId: id,
            status: "checker_unavailable" as const,
            failureReason:
              "工具调用专项检查器尚未接入；连接成功不等于工具可用，未执行检查不记正式失败",
            testVersion: "local-protocol-v1",
            sourceNote: "检查器不可用",
          };
        }
        if (id === "image_generation" || id === "music_generation") {
          return {
            capabilityId: id,
            status: "checker_unavailable" as const,
            failureReason:
              "图片／音乐专项检查器尚未接入，未向生成服务提交请求；不能把未检查记为失败或产物缺失",
            testVersion: "local-protocol-v1",
            sourceNote: "检查器不可用",
          };
        }
        return {
          capabilityId: id,
          status: "untested" as const,
          failureReason: "该能力未纳入本次协议检查范围",
          testVersion: "local-protocol-v1",
          sourceNote: "未测试",
        };
      });
    },
  };
}

function outcomeToEvidence(
  outcome: ProtocolCheckOutcome,
  mode: VerificationMode,
): CapabilityEvidenceItem {
  const source = mode === "specialized_eval" ? "specialized_eval" : "protocol_probe";
  let status: CapabilityEvidenceItem["status"];
  switch (outcome.status) {
    case "passed":
      status = "passed";
      break;
    case "failed":
      status = "failed";
      break;
    case "pending":
      status = "pending";
      break;
    case "checker_unavailable":
      status = "checker_unavailable";
      break;
    case "untested":
    default:
      status = "untested";
      break;
  }
  return {
    id: outcome.capabilityId,
    label: capabilityLabel(outcome.capabilityId),
    source,
    status,
    verifiedAt:
      outcome.verifiedAt ?? (status === "passed" || status === "failed" ? Date.now() : undefined),
    testVersion: outcome.testVersion ?? "local-protocol-v1",
    sourceNote: outcome.sourceNote,
    failureReason: outcome.failureReason,
    expiresAt: outcome.expiresAt,
  };
}

function summarizeTaskStatus(
  results: CapabilityEvidenceItem[],
): CapabilityVerificationTask["status"] {
  const failed = results.filter((r) => r.status === "failed").length;
  const passed = results.filter((r) => r.status === "passed").length;
  const pending = results.filter((r) => r.status === "pending").length;
  const incomplete = results.filter(
    (r) =>
      r.status === "checker_unavailable" || r.status === "untested" || r.status === "suggested",
  ).length;
  if (pending > 0) {
    return "running";
  }
  if (failed > 0 && passed > 0) {
    return "partial";
  }
  if (failed > 0) {
    return "failed";
  }
  if (passed > 0 && incomplete > 0) {
    return "partial";
  }
  if (passed > 0) {
    return "succeeded";
  }
  // Only unavailable/untested — not an actual failure.
  return "partial";
}

function buildReuseHints(
  outcomes: ProtocolCheckOutcome[],
): Partial<Record<string, { verifiedAt?: number; testVersion?: string; sourceNote?: string }>> {
  const hints: Partial<
    Record<string, { verifiedAt?: number; testVersion?: string; sourceNote?: string }>
  > = {};
  for (const outcome of outcomes) {
    if (outcome.reuseExistingEvidence && outcome.status === "passed") {
      hints[outcome.capabilityId] = {
        verifiedAt: outcome.verifiedAt,
        testVersion: outcome.testVersion,
        sourceNote: outcome.sourceNote,
      };
    }
  }
  return hints;
}

export function createLocalProtocolVerificationService(
  options: LocalProtocolAdapterOptions = {},
): CapabilityVerificationService {
  const settleDelayMs = options.settleDelayMs ?? 0;
  const schedule = options.schedule ?? defaultSchedule;
  const pendingTimeoutMs = options.pendingTimeoutMs ?? 30_000;
  const runner = options.runner ?? createDefaultProtocolRunner(options.resolveConnectionOk);
  const resolveCurrentFingerprint =
    options.resolveCurrentFingerprint ??
    ((modelRef: string) => getCurrentConfigFingerprint(modelRef));

  function notifySettled(task: CapabilityVerificationTask) {
    try {
      options.onTaskSettled?.(task);
    } catch {
      // UI notify must not break persistence.
    }
  }

  function discoverCapabilities(req: DiscoverCapabilitiesRequest): DiscoverCapabilitiesResponse {
    const declared = normalizeCapabilityIds(req.declaredCapabilities ?? []);
    const base: CanonicalCapabilityId[] =
      declared.length > 0 ? declared : (["text_chat"] as CanonicalCapabilityId[]);
    const withCallType = [...base];
    if (req.callType === "image_generation" && !withCallType.includes("image_generation")) {
      withCallType.push("image_generation");
    }
    if (req.callType === "music_generation" && !withCallType.includes("music_generation")) {
      withCallType.push("music_generation");
    }
    return {
      modelRef: req.modelRef.trim(),
      adapter: "local_protocol",
      capabilities: withCallType.map((id) => ({
        id,
        label: CAPABILITY_LABEL_ZH[id],
        source: declared.includes(id) ? ("catalog_declared" as const) : ("name_inferred" as const),
        sourceNote: declared.includes(id) ? "目录／声明待验证" : "推断建议，待确认",
        suggested: true,
      })),
    };
  }

  function finishWithOutcomes(
    taskId: string,
    modelRef: string,
    mode: VerificationMode,
    requestFingerprint: string | undefined,
    executionGeneration: number,
    outcomes: ProtocolCheckOutcome[],
    opts?: { fromPendingTimeout?: boolean },
  ) {
    const latest = getVerificationTask(taskId);
    if (!latest) {
      return;
    }
    // Refuse late arrivals after any terminal state (cancel / interrupt / timeout / prior finish).
    if (latest.status !== "queued" && latest.status !== "running") {
      return;
    }

    const results = outcomes.map((o) => outcomeToEvidence(o, mode));
    const stillPending = results.some((r) => r.status === "pending");
    if (stillPending && !opts?.fromPendingTimeout) {
      // Persist running snapshot; schedule timeout to force a terminal state.
      const running: CapabilityVerificationTask = {
        ...latest,
        status: "running",
        results,
        updatedAt: Date.now(),
        configFingerprint: requestFingerprint ?? latest.configFingerprint,
        executionGeneration,
      };
      saveVerificationTask(running);
      schedule(() => {
        const timedOut = results.map((r) =>
          r.status === "pending"
            ? {
                ...r,
                status: "checker_unavailable" as const,
                failureReason: r.failureReason ?? "检查超时，未得到终态（检查器未返回）",
                sourceNote: "pending 超时",
              }
            : r,
        );
        // Re-enter as timeout finalization (no further pending wait).
        finishWithOutcomes(
          taskId,
          modelRef,
          mode,
          requestFingerprint,
          executionGeneration,
          timedOut.map((r) => ({
            capabilityId: r.id,
            status:
              r.status === "passed"
                ? "passed"
                : r.status === "failed"
                  ? "failed"
                  : r.status === "checker_unavailable"
                    ? "checker_unavailable"
                    : r.status === "untested"
                      ? "untested"
                      : "pending",
            failureReason: r.failureReason,
            testVersion: r.testVersion,
            sourceNote: r.sourceNote,
            expiresAt: r.expiresAt,
            verifiedAt: r.verifiedAt,
          })),
          { fromPendingTimeout: true },
        );
      }, pendingTimeoutMs);
      return;
    }

    const status = summarizeTaskStatus(results);
    const done: CapabilityVerificationTask = {
      ...latest,
      status,
      results,
      updatedAt: Date.now(),
      configFingerprint: requestFingerprint ?? latest.configFingerprint,
      executionGeneration,
      ...(opts?.fromPendingTimeout && stillPending ? { error: "检查超时，未得到终态" } : {}),
    };
    saveVerificationTask(done);
    clearVerificationTaskLive(taskId);

    const currentFp = resolveCurrentFingerprint(modelRef);
    const taskFp = requestFingerprint ?? latest.configFingerprint;
    const fingerprintStale = Boolean(taskFp && currentFp && taskFp !== currentFp);
    const generationStale = executionGeneration < currentExecutionGeneration(modelRef);

    if (fingerprintStale || generationStale) {
      // Keep results on the task (history) but do not update formal evidence.
      const stale: CapabilityVerificationTask = {
        ...done,
        error:
          done.error ??
          (fingerprintStale
            ? "配置指纹已变更，结果仅保留在历史中，未更新正式证据"
            : "已被更新的验证任务取代，结果仅保留在历史中，未更新正式证据"),
      };
      saveVerificationTask(stale);
      notifySettled(stale);
      return;
    }

    mergeFormalCapabilityEvidence(modelRef, results, {
      reuseHints: buildReuseHints(outcomes),
    });
    notifySettled(done);
  }

  function finishWithError(taskId: string, message: string) {
    const latest = getVerificationTask(taskId);
    if (!latest || (latest.status !== "queued" && latest.status !== "running")) {
      return;
    }
    const failed: CapabilityVerificationTask = {
      ...latest,
      status: "failed",
      error: message,
      updatedAt: Date.now(),
      results: (latest.capabilityIds ?? []).map((id) => ({
        id,
        label: capabilityLabel(id),
        source: "protocol_probe" as const,
        status: "untested" as const,
        failureReason: message,
        testVersion: "local-protocol-v1",
        sourceNote: "执行异常，未完成检查",
      })),
    };
    saveVerificationTask(failed);
    clearVerificationTaskLive(taskId);
    // Errors must not write formal failed over existing evidence.
    notifySettled(failed);
  }

  function createVerificationTask(
    req: CreateVerificationTaskRequest,
  ): CreateVerificationTaskResponse {
    const modelRef = req.modelRef.trim();
    const mode: VerificationMode = req.mode ?? "protocol_probe";
    const now = Date.now();
    const taskId = newTaskId();
    const executionGeneration = nextExecutionGeneration(modelRef);
    const queued: CapabilityVerificationTask = {
      taskId,
      modelRef,
      capabilityIds: req.capabilityIds,
      status: "queued",
      createdAt: now,
      updatedAt: now,
      estimatedCalls: req.estimatedCalls ?? req.capabilityIds.length,
      configFingerprint: req.configFingerprint,
      executionGeneration,
    };
    saveVerificationTask(queued);
    markVerificationTaskLive(taskId);

    const run = () => {
      const current = getVerificationTask(taskId);
      if (!current || current.status === "cancelled" || current.status === "interrupted") {
        return;
      }
      const running: CapabilityVerificationTask = {
        ...current,
        status: "running",
        updatedAt: Date.now(),
      };
      saveVerificationTask(running);

      let checked: ProtocolCheckOutcome[] | Promise<ProtocolCheckOutcome[]>;
      try {
        checked = runner.check({
          modelRef,
          mode,
          configFingerprint: req.configFingerprint,
          connectionOk: options.resolveConnectionOk?.(modelRef, req.configFingerprint),
          capabilityIds: req.capabilityIds,
        });
      } catch (err) {
        finishWithError(
          taskId,
          err instanceof Error ? err.message : `协议检查同步异常: ${String(err)}`,
        );
        return;
      }

      if (isPromiseLike<ProtocolCheckOutcome[]>(checked)) {
        // Timeout covers the entire runner.check() Promise lifecycle, not only
        // outcomes that already returned status "pending".
        let runnerTerminal = false;
        const settleOutcomes = (outcomes: ProtocolCheckOutcome[]) => {
          if (runnerTerminal) {
            return;
          }
          runnerTerminal = true;
          finishWithOutcomes(
            taskId,
            modelRef,
            mode,
            req.configFingerprint,
            executionGeneration,
            outcomes,
          );
        };
        const settleError = (message: string) => {
          if (runnerTerminal) {
            return;
          }
          runnerTerminal = true;
          finishWithError(taskId, message);
        };
        // Wall-clock timeout must not go through the settle `schedule` hook:
        // tests often inject a zero-delay microtask scheduler for run(), which
        // would fire the timeout before a rejecting Promise settles.
        defaultSchedule(() => {
          settleError("检查超时，runner 未在时限内返回终态");
        }, pendingTimeoutMs);
        void checked.then(
          (outcomes) => {
            settleOutcomes(outcomes);
          },
          (err: unknown) => {
            settleError(err instanceof Error ? err.message : `协议检查异步异常: ${String(err)}`);
          },
        );
        return;
      }
      finishWithOutcomes(
        taskId,
        modelRef,
        mode,
        req.configFingerprint,
        executionGeneration,
        checked,
      );
    };

    // settleDelayMs <= 0 with defaultSchedule: run inline so sync callers observe results.
    if (settleDelayMs <= 0 && schedule === defaultSchedule) {
      run();
    } else {
      schedule(run, settleDelayMs);
    }
    return { task: getVerificationTask(taskId) ?? queued, authority: "formal" };
  }

  function getTask(req: GetVerificationTaskRequest) {
    return getVerificationTask(req.taskId);
  }

  function listTasks(req?: ListVerificationTasksRequest) {
    return listVerificationTasks(req?.modelRef);
  }

  function cancelTask(req: CancelVerificationTaskRequest) {
    const task = getVerificationTask(req.taskId);
    if (!task) {
      return null;
    }
    if (task.status === "queued" || task.status === "running") {
      const next = { ...task, status: "cancelled" as const, updatedAt: Date.now() };
      saveVerificationTask(next);
      clearVerificationTaskLive(task.taskId);
      notifySettled(next);
      return next;
    }
    return task;
  }

  function setRoutingEligibility(req: SetRoutingEligibilityRequest): SetRoutingEligibilityResponse {
    setAutoRoutingAdmission(req.modelRef, req.autoRouting, {
      reason: req.reason ?? "本地草稿，后端准入尚未接入",
      taskCategories: req.taskCategories,
    });
    return {
      status: "not_wired",
      modelRef: req.modelRef.trim(),
      draft: {
        autoRouting: req.autoRouting,
        reason: req.reason,
        taskCategories: req.taskCategories,
      },
      message: "路由资格后端尚未接入；已保存为本地草稿，不代表平台生效",
    };
  }

  function createBatchVerificationTasks(req: BatchVerificationRequest): BatchVerificationResponse {
    const tasks = req.items.map((item) => createVerificationTask(item));
    return { tasks };
  }

  return {
    kind: "local_protocol",
    authority: "formal",
    discoverCapabilities,
    createVerificationTask,
    getVerificationTask: getTask,
    listVerificationTasks: listTasks,
    cancelVerificationTask: cancelTask,
    setRoutingEligibility,
    createBatchVerificationTasks,
  };
}

/**
 * Build a formal runner from explicit per-capability outcomes (tests / harness).
 * Does not call paid APIs.
 */
export function createInjectedProtocolRunner(
  outcomesByCapability: Partial<Record<CanonicalCapabilityId, ProtocolCheckOutcome>>,
): CapabilityCheckRunner {
  return {
    check(ctx) {
      return ctx.capabilityIds.map((id) => {
        const injected = outcomesByCapability[id];
        if (injected) {
          return { ...injected, capabilityId: id };
        }
        return {
          capabilityId: id,
          status: "checker_unavailable" as const,
          failureReason: "注入 runner 未提供该能力结果（未执行，不记正式失败）",
          testVersion: "injected-protocol-v1",
          sourceNote: "检查器不可用",
        };
      });
    },
  };
}
