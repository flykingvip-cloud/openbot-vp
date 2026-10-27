/**
 * Gateway capability verification service (formal authority).
 * Async tasks persist in the admission store; default runner never calls paid APIs.
 *
 * Lifecycle (aligned with UI local_protocol protections):
 * - create returns taskId promptly; runner work continues in background
 * - before merging formal evidence: re-check cancel / interrupt, config
 *   fingerprint, and execution generation
 * - wall-clock timeout covers the entire runner execution
 * - late success after cancel or a superseded generation must not pollute
 *   current formal evidence
 */

import {
  capabilityLabel,
  normalizeCapabilityIds,
  toCanonicalCapabilityId,
} from "./capability-ids.js";
import {
  createDefaultProtocolRunner,
  outcomeToEvidence,
  type CapabilityCheckRunner,
} from "./protocol-runner.js";
import {
  finalizeVerificationTaskIfInFlight,
  getCurrentExecutionGeneration,
  getModelAdmission,
  getVerificationTask,
  interruptInFlightVerificationTasks,
  listVerificationTasks,
  mergeFormalCapabilityEvidence,
  nextExecutionGeneration,
  saveVerificationTask,
  setAutoRoutingAdmission,
} from "./store.js";
import type {
  AutoRoutingAdmission,
  CanonicalCapabilityId,
  CapabilityEvidenceItem,
  CapabilityVerificationTask,
  ModelAdmissionRecord,
  ProtocolCheckOutcome,
  VerificationMode,
} from "./types.js";

export type DiscoverCapabilitiesRequest = {
  modelRef: string;
  declaredCapabilities?: string[];
  callType?: string;
};

export type DiscoveredCapability = {
  id: CanonicalCapabilityId;
  label: string;
  source: CapabilityEvidenceItem["source"];
  sourceNote?: string;
  suggested: boolean;
};

function newTaskId(): string {
  return `gcvt_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function summarizeTaskStatus(
  results: CapabilityEvidenceItem[],
): CapabilityVerificationTask["status"] {
  if (results.length === 0) {
    return "failed";
  }
  const meaningful = results.filter((r) => r.status === "passed" || r.status === "failed");
  if (meaningful.length === 0) {
    // Only checker_unavailable / untested — partial authenticity, not formal failure.
    return "partial";
  }
  const passed = meaningful.filter((r) => r.status === "passed").length;
  const failed = meaningful.filter((r) => r.status === "failed").length;
  if (passed > 0 && failed === 0 && meaningful.length === results.length) {
    return "succeeded";
  }
  if (failed > 0 && passed === 0) {
    return "failed";
  }
  return "partial";
}

const DEFAULT_RUNNER_TIMEOUT_MS = 30_000;

export type GatewayVerificationServiceOptions = {
  runner?: CapabilityCheckRunner;
  /**
   * Server-trusted connection probe. Client RPC connectionOk is never consulted.
   */
  resolveConnectionOk?: (modelRef: string, fingerprint?: string) => boolean | Promise<boolean>;
  /**
   * Current config fingerprint at finish time (stale-check).
   * Defaults to admission.connectionFingerprint when unset.
   */
  resolveCurrentFingerprint?: (
    modelRef: string,
  ) => string | undefined | Promise<string | undefined>;
  /** Wall-clock timeout covering the entire runner.check() Promise. */
  runnerTimeoutMs?: number;
  storePath?: string;
  /**
   * When true (default), interrupt prior-process queued/running tasks on create.
   * Tests may set false to avoid wiping fixtures.
   */
  interruptOrphansOnCreate?: boolean;
};

export function createGatewayVerificationService(options: GatewayVerificationServiceOptions = {}) {
  const runner =
    options.runner ?? createDefaultProtocolRunner(options.resolveConnectionOk, options.storePath);
  const storePath = options.storePath;
  const runnerTimeoutMs = options.runnerTimeoutMs ?? DEFAULT_RUNNER_TIMEOUT_MS;
  const resolveCurrentFingerprint = options.resolveCurrentFingerprint;
  const background = new Map<string, Promise<void>>();
  let orphansInterrupted = false;

  async function ensureOrphansInterrupted() {
    if (options.interruptOrphansOnCreate === false) {
      return;
    }
    if (orphansInterrupted) {
      return;
    }
    orphansInterrupted = true;
    await interruptInFlightVerificationTasks(
      "已中断，可重试（网关进程重启或执行上下文丢失）",
      storePath,
    );
  }

  async function discoverCapabilities(req: DiscoverCapabilitiesRequest) {
    await ensureOrphansInterrupted();
    const modelRef = req.modelRef.trim();
    const declared = normalizeCapabilityIds(req.declaredCapabilities ?? []);
    const extras: string[] = [];
    if (req.callType === "image_gen" || req.callType === "image_generation") {
      extras.push("image_generation");
    }
    if (req.callType === "music_gen" || req.callType === "music_generation") {
      extras.push("music_generation");
    }
    const ids = normalizeCapabilityIds([...declared, ...extras, "text_chat"]);
    return {
      modelRef,
      adapter: "gateway_protocol",
      capabilities: ids.map((id) => ({
        id,
        label: capabilityLabel(id),
        source: "inferred" as const,
        suggested: true,
        sourceNote: "发现结果仅为建议，不得当作已验证",
      })),
    };
  }

  async function resolveFingerprintNow(modelRef: string): Promise<string | undefined> {
    if (resolveCurrentFingerprint) {
      return await resolveCurrentFingerprint(modelRef);
    }
    const admission = await getModelAdmission(modelRef, storePath);
    return admission.connectionFingerprint;
  }

  async function finishWithOutcomes(
    taskId: string,
    modelRef: string,
    mode: VerificationMode,
    requestFingerprint: string | undefined,
    executionGeneration: number,
    outcomes: ProtocolCheckOutcome[],
  ) {
    const results = outcomes.map((o) => outcomeToEvidence(o, mode));
    const status = summarizeTaskStatus(results);

    // Atomic vs cancel/interrupt: only transition while still in-flight.
    const done = await finalizeVerificationTaskIfInFlight(
      taskId,
      (latest) => ({
        ...latest,
        status,
        results,
        updatedAt: Date.now(),
        configFingerprint: requestFingerprint ?? latest.configFingerprint,
        executionGeneration,
      }),
      storePath,
    );
    if (!done) {
      // Cancel / interrupt / prior terminal already won — do not pollute evidence.
      return;
    }

    const currentFp = await resolveFingerprintNow(modelRef);
    const taskFp = requestFingerprint ?? done.configFingerprint;
    const fingerprintStale = Boolean(taskFp && currentFp && taskFp !== currentFp);
    const currentGen = await getCurrentExecutionGeneration(modelRef, storePath);
    const generationStale = executionGeneration < currentGen;

    if (fingerprintStale || generationStale) {
      const stale: CapabilityVerificationTask = {
        ...done,
        error:
          done.error ??
          (fingerprintStale
            ? "配置指纹已变更，结果仅保留在历史中，未更新正式证据"
            : "已被更新的验证任务取代，结果仅保留在历史中，未更新正式证据"),
      };
      await saveVerificationTask(stale, storePath);
      return;
    }

    const mergeable = results.filter(
      (item) => item.status === "passed" || item.status === "failed",
    );
    if (mergeable.length > 0) {
      await mergeFormalCapabilityEvidence(
        modelRef,
        mergeable,
        { configFingerprint: requestFingerprint },
        storePath,
      );
    }
  }

  async function finishWithError(
    taskId: string,
    capabilityIds: CanonicalCapabilityId[],
    message: string,
  ) {
    await finalizeVerificationTaskIfInFlight(
      taskId,
      (latest) => ({
        ...latest,
        status: "failed",
        error: message,
        updatedAt: Date.now(),
        results: capabilityIds.map((id) => ({
          id,
          label: capabilityLabel(id),
          source: "protocol_probe" as const,
          status: "untested" as const,
          failureReason: message,
          testVersion: "gateway-protocol-v1",
          sourceNote: "执行异常，未完成检查",
        })),
      }),
      storePath,
    );
  }

  function runInBackground(
    taskId: string,
    modelRef: string,
    mode: VerificationMode,
    capabilityIds: CanonicalCapabilityId[],
    requestFingerprint: string | undefined,
    executionGeneration: number,
  ) {
    const work = (async () => {
      const running = await finalizeVerificationTaskIfInFlight(
        taskId,
        (current) => ({
          ...current,
          status: "running",
          updatedAt: Date.now(),
        }),
        storePath,
      );
      if (!running) {
        // Cancelled / interrupted before start — abandon.
        return;
      }

      let runnerTerminal = false;
      const settleOutcomes = async (outcomes: ProtocolCheckOutcome[]) => {
        if (runnerTerminal) {
          return;
        }
        runnerTerminal = true;
        await finishWithOutcomes(
          taskId,
          modelRef,
          mode,
          requestFingerprint,
          executionGeneration,
          outcomes,
        );
      };
      const settleError = async (message: string) => {
        if (runnerTerminal) {
          return;
        }
        runnerTerminal = true;
        await finishWithError(taskId, capabilityIds, message);
      };

      let timeoutTimer: ReturnType<typeof setTimeout> | undefined;
      const timeout = new Promise<never>((_, reject) => {
        timeoutTimer = setTimeout(() => {
          reject(new Error("检查超时，runner 未在时限内返回终态"));
        }, runnerTimeoutMs);
      });

      try {
        // Client connectionOk is intentionally omitted — only server resolveConnectionOk
        // (wired into the default runner) or an injected runner may mint formal passed.
        const checked = await Promise.race([
          Promise.resolve(
            runner.check({
              modelRef,
              mode,
              configFingerprint: requestFingerprint,
              capabilityIds,
            }),
          ),
          timeout,
        ]);
        if (timeoutTimer) {
          clearTimeout(timeoutTimer);
        }
        await settleOutcomes(checked);
      } catch (err) {
        if (timeoutTimer) {
          clearTimeout(timeoutTimer);
        }
        await settleError(err instanceof Error ? err.message : String(err));
      }
    })().finally(() => {
      background.delete(taskId);
    });
    background.set(taskId, work);
  }

  /**
   * Create a verification task and return taskId promptly.
   * Runner work continues in the background; poll getVerificationTask for results.
   *
   * Note: `connectionOk` on the input is accepted for schema/back-compat but
   * **ignored** for formal authority — clients cannot mint passed evidence.
   */
  async function createVerificationTask(input: {
    modelRef: string;
    capabilityIds: string[];
    mode?: VerificationMode;
    configFingerprint?: string;
    estimatedCalls?: number;
    /** @deprecated Ignored for formal evidence. Server resolveConnectionOk only. */
    connectionOk?: boolean;
  }) {
    await ensureOrphansInterrupted();
    const modelRef = input.modelRef.trim();
    const capabilityIds = normalizeCapabilityIds(input.capabilityIds);
    if (!modelRef || capabilityIds.length === 0) {
      throw new Error("modelRef and capabilityIds are required");
    }
    const mode: VerificationMode = input.mode ?? "protocol_probe";
    const now = Date.now();
    const taskId = newTaskId();
    const executionGeneration = await nextExecutionGeneration(modelRef, storePath);
    const queued: CapabilityVerificationTask = {
      taskId,
      modelRef,
      capabilityIds,
      status: "queued",
      createdAt: now,
      updatedAt: now,
      estimatedCalls: input.estimatedCalls ?? capabilityIds.length,
      configFingerprint: input.configFingerprint,
      executionGeneration,
    };
    await saveVerificationTask(queued, storePath);

    // Kick off background work; return taskId without awaiting the runner.
    runInBackground(
      taskId,
      modelRef,
      mode,
      capabilityIds,
      input.configFingerprint,
      executionGeneration,
    );

    return { task: queued, authority: "formal" as const };
  }

  async function cancelVerificationTask(taskId: string) {
    const task = await getVerificationTask(taskId, storePath);
    if (!task) {
      return null;
    }
    if (task.status === "queued" || task.status === "running") {
      const next: CapabilityVerificationTask = {
        ...task,
        status: "cancelled",
        updatedAt: Date.now(),
      };
      await saveVerificationTask(next, storePath);
      return next;
    }
    return task;
  }

  async function setRoutingEligibility(input: {
    modelRef: string;
    autoRouting: AutoRoutingAdmission;
    reason?: string;
    taskCategories?: string[];
    tenantSelectable?: boolean;
  }) {
    const record = await setAutoRoutingAdmission(
      input.modelRef,
      input.autoRouting,
      {
        reason: input.reason,
        taskCategories: input.taskCategories,
        tenantSelectable: input.tenantSelectable,
      },
      storePath,
    );
    return {
      status: "applied" as const,
      modelRef: record.modelRef,
      autoRouting: record.autoRouting,
      admission: record,
    };
  }

  /** Test helper: await all in-flight background verification work. */
  async function __flushBackgroundForTest() {
    const pending = [...background.values()];
    await Promise.all(pending);
  }

  return {
    discoverCapabilities,
    createVerificationTask,
    getVerificationTask: (taskId: string) => getVerificationTask(taskId, storePath),
    listVerificationTasks: (modelRef?: string) => listVerificationTasks(modelRef, storePath),
    cancelVerificationTask,
    setRoutingEligibility,
    getModelAdmission: (modelRef: string) => getModelAdmission(modelRef, storePath),
    createBatchVerificationTasks: async (
      items: Array<Parameters<typeof createVerificationTask>[0]>,
    ) => {
      const tasks = [];
      for (const item of items) {
        tasks.push(await createVerificationTask(item));
      }
      return { tasks };
    },
    __flushBackgroundForTest,
  };
}

export type GatewayVerificationService = ReturnType<typeof createGatewayVerificationService>;

export function normalizeCapabilityIdList(raw: unknown): string[] {
  if (!Array.isArray(raw)) {
    return [];
  }
  return raw.filter((v): v is string => typeof v === "string");
}

export function parseAutoRouting(raw: unknown): AutoRoutingAdmission | null {
  if (raw === "disabled" || raw === "eligible" || raw === "restricted" || raw === "paused") {
    return raw;
  }
  return null;
}

export function isCanonicalCapabilityId(raw: string): boolean {
  return toCanonicalCapabilityId(raw) != null;
}

export type { ModelAdmissionRecord, CapabilityVerificationTask };
