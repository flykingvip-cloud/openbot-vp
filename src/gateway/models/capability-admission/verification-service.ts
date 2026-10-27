/**
 * Gateway capability verification service (formal authority).
 * Async tasks persist in the admission store; default runner never calls paid APIs.
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
  getModelAdmission,
  getVerificationTask,
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

export type GatewayVerificationServiceOptions = {
  runner?: CapabilityCheckRunner;
  resolveConnectionOk?: (modelRef: string, fingerprint?: string) => boolean | Promise<boolean>;
  storePath?: string;
};

export function createGatewayVerificationService(options: GatewayVerificationServiceOptions = {}) {
  const runner = options.runner ?? createDefaultProtocolRunner(options.resolveConnectionOk);
  const storePath = options.storePath;

  async function discoverCapabilities(req: DiscoverCapabilitiesRequest) {
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

  async function createVerificationTask(input: {
    modelRef: string;
    capabilityIds: string[];
    mode?: VerificationMode;
    configFingerprint?: string;
    estimatedCalls?: number;
    connectionOk?: boolean;
  }) {
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

    const running: CapabilityVerificationTask = {
      ...queued,
      status: "running",
      updatedAt: Date.now(),
    };
    await saveVerificationTask(running, storePath);

    let outcomes: ProtocolCheckOutcome[];
    try {
      outcomes = await Promise.resolve(
        runner.check({
          modelRef,
          mode,
          configFingerprint: input.configFingerprint,
          connectionOk: input.connectionOk,
          capabilityIds,
        }),
      );
    } catch (err) {
      const failed: CapabilityVerificationTask = {
        ...running,
        status: "failed",
        error: err instanceof Error ? err.message : String(err),
        updatedAt: Date.now(),
        results: capabilityIds.map((id) => ({
          id,
          label: capabilityLabel(id),
          source: "protocol_probe",
          status: "untested",
          failureReason: err instanceof Error ? err.message : String(err),
          testVersion: "gateway-protocol-v1",
          sourceNote: "执行异常，未完成检查",
        })),
      };
      await saveVerificationTask(failed, storePath);
      return { task: failed, authority: "formal" as const };
    }

    const results = outcomes.map((o) => outcomeToEvidence(o, mode));
    // Only merge formal passed/failed into admission; checker_unavailable must not
    // invent formal failed verified sets.
    const mergeable = results.filter(
      (item) => item.status === "passed" || item.status === "failed",
    );
    if (mergeable.length > 0) {
      await mergeFormalCapabilityEvidence(
        modelRef,
        mergeable,
        { configFingerprint: input.configFingerprint },
        storePath,
      );
    }

    const finished: CapabilityVerificationTask = {
      ...running,
      status: summarizeTaskStatus(results),
      results,
      updatedAt: Date.now(),
    };
    await saveVerificationTask(finished, storePath);
    return { task: finished, authority: "formal" as const };
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
