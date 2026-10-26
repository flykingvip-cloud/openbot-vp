/**
 * Local protocol verification adapter.
 *
 * Produces formal evidence only from CapabilityCheckRunner outcomes.
 * Does not call paid Midjourney/Suno/etc. APIs — inject a runner for tests
 * or use the default structural runner (connection-backed text_chat only).
 */

import type { CapabilityEvidenceItem } from "../capability-evidence.ts";
import {
  CAPABILITY_LABEL_ZH,
  capabilityLabel,
  normalizeCapabilityIds,
  type CanonicalCapabilityId,
} from "../capability-ids.ts";
import {
  getModelAdmission,
  getVerificationTask,
  listVerificationTasks,
  saveVerificationTask,
  setAutoRoutingAdmission,
  upsertModelAdmission,
  type CapabilityVerificationTask,
} from "../model-admission-store.ts";
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
   * Async delay before completing a task (ms). 0 = complete on next microtask.
   * Tests pass 0 and optionally a custom scheduler.
   */
  settleDelayMs?: number;
  /** Optional scheduler for tests (receives work to run later). */
  schedule?: (work: () => void, delayMs: number) => void;
  /** Provide connectionOk lookup by modelRef + fingerprint. */
  resolveConnectionOk?: (modelRef: string, fingerprint?: string) => boolean;
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

/**
 * Default runner: formal text_chat may pass when connectionOk; tool_use /
 * image / music never invent passes without an injected specialized runner.
 */
export function createDefaultProtocolRunner(
  resolveConnectionOk?: (modelRef: string, fingerprint?: string) => boolean,
): CapabilityCheckRunner {
  return {
    check(ctx: ProtocolCheckContext): ProtocolCheckOutcome[] {
      const connectionOk =
        ctx.connectionOk ?? resolveConnectionOk?.(ctx.modelRef, ctx.configFingerprint) ?? false;
      return ctx.capabilityIds.map((id) => {
        if (id === "text_chat") {
          if (connectionOk) {
            return {
              capabilityId: id,
              status: "passed" as const,
              testVersion: "local-protocol-v1",
              sourceNote: "连接协议探测通过（指纹绑定）",
              expiresAt: Date.now() + 7 * 24 * 60 * 60 * 1000,
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
            status: "failed" as const,
            failureReason: "连接成功不等于工具调用可用；专项协议检查尚未返回工具请求/回传证据",
            testVersion: "local-protocol-v1",
          };
        }
        if (id === "image_generation" || id === "music_generation") {
          return {
            capabilityId: id,
            status: "failed" as const,
            failureReason: "仅返回 taskId，尚无有效产物，不能标记为目标模态完成",
            artifactMissing: true,
            testVersion: "local-protocol-v1",
          };
        }
        return {
          capabilityId: id,
          status: "failed" as const,
          failureReason: "专项协议检查未提供该能力的正式证据",
          testVersion: "local-protocol-v1",
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
  const status =
    outcome.status === "passed" ? "passed" : outcome.status === "pending" ? "pending" : "failed";
  return {
    id: outcome.capabilityId,
    label: capabilityLabel(outcome.capabilityId),
    source,
    status,
    verifiedAt: status === "passed" || status === "failed" ? Date.now() : undefined,
    testVersion: outcome.testVersion ?? "local-protocol-v1",
    sourceNote: outcome.sourceNote,
    failureReason: outcome.failureReason,
    expiresAt: outcome.expiresAt,
  };
}

function mergeFormalEvidence(modelRef: string, results: CapabilityEvidenceItem[]) {
  const admission = getModelAdmission(modelRef);
  const byId = new Map(admission.capabilityEvidence.map((item) => [item.id, item]));
  for (const item of results) {
    byId.set(item.id, item);
  }
  upsertModelAdmission(modelRef, {
    capabilityEvidence: Array.from(byId.values()),
  });
}

function summarizeTaskStatus(
  results: CapabilityEvidenceItem[],
): CapabilityVerificationTask["status"] {
  const failed = results.filter((r) => r.status === "failed").length;
  const passed = results.filter((r) => r.status === "passed").length;
  const pending = results.filter((r) => r.status === "pending").length;
  if (pending > 0) {
    return "running";
  }
  if (failed > 0 && passed > 0) {
    return "partial";
  }
  if (failed > 0) {
    return "failed";
  }
  return "succeeded";
}

export function createLocalProtocolVerificationService(
  options: LocalProtocolAdapterOptions = {},
): CapabilityVerificationService {
  const settleDelayMs = options.settleDelayMs ?? 0;
  const schedule = options.schedule ?? defaultSchedule;
  const runner = options.runner ?? createDefaultProtocolRunner(options.resolveConnectionOk);

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

  function createVerificationTask(
    req: CreateVerificationTaskRequest,
  ): CreateVerificationTaskResponse {
    const modelRef = req.modelRef.trim();
    const mode: VerificationMode = req.mode ?? "protocol_probe";
    const now = Date.now();
    const taskId = newTaskId();
    const queued: CapabilityVerificationTask = {
      taskId,
      modelRef,
      capabilityIds: req.capabilityIds,
      status: "queued",
      createdAt: now,
      updatedAt: now,
      estimatedCalls: req.estimatedCalls ?? req.capabilityIds.length,
    };
    saveVerificationTask(queued);

    const finishWithOutcomes = (outcomes: ProtocolCheckOutcome[]) => {
      const latest = getVerificationTask(taskId);
      if (!latest || latest.status === "cancelled") {
        return;
      }
      const results = outcomes.map((o) => outcomeToEvidence(o, mode));
      const status = summarizeTaskStatus(results);
      const done: CapabilityVerificationTask = {
        ...latest,
        status,
        results,
        updatedAt: Date.now(),
      };
      saveVerificationTask(done);
      // Formal only — never write demoCapabilityEvidence here.
      mergeFormalEvidence(modelRef, results);
    };

    const run = () => {
      const current = getVerificationTask(taskId);
      if (!current || current.status === "cancelled") {
        return;
      }
      const running: CapabilityVerificationTask = {
        ...current,
        status: "running",
        updatedAt: Date.now(),
      };
      saveVerificationTask(running);

      const checked = runner.check({
        modelRef,
        mode,
        configFingerprint: req.configFingerprint,
        connectionOk: options.resolveConnectionOk?.(modelRef, req.configFingerprint),
        capabilityIds: req.capabilityIds,
      });
      if (checked && typeof (checked as Promise<unknown>).then === "function") {
        void (checked as Promise<ProtocolCheckOutcome[]>).then(finishWithOutcomes);
        return;
      }
      finishWithOutcomes(checked as ProtocolCheckOutcome[]);
    };

    // settleDelayMs <= 0: run inline so sync callers/tests observe completed formal evidence.
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
      return next;
    }
    return task;
  }

  function setRoutingEligibility(req: SetRoutingEligibilityRequest): SetRoutingEligibilityResponse {
    // Backend admission RPC not wired — persist draft only, never claim applied.
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
          status: "failed" as const,
          failureReason: "注入 runner 未提供该能力结果",
          testVersion: "injected-protocol-v1",
        };
      });
    },
  };
}
