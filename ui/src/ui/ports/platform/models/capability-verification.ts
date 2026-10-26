/**
 * Capability verification task API.
 *
 * Frontend stub for batch-2/3 UX. Stub/demo outcomes write ONLY to
 * demoCapabilityEvidence and must never enter formal verified sets or
 * platform admission judgments. Real protocol_probe results will use a
 * backend taskId once the verification RPC lands.
 */

import {
  type CapabilityEvidenceItem,
  type CapabilityEvidenceSource,
} from "./capability-evidence.ts";
import type { CanonicalCapabilityId } from "./capability-ids.ts";
import {
  expireFormalCapabilityEvidence,
  getVerificationTask,
  listVerificationTasks,
  saveVerificationTask,
  type CapabilityVerificationTask,
  upsertModelAdmission,
  getModelAdmission,
} from "./model-admission-store.ts";

export type CreateVerificationInput = {
  modelRef: string;
  capabilityIds: CanonicalCapabilityId[];
  /** protocol_probe = cheap connectivity; specialized_eval = quality suite. */
  mode?: "protocol_probe" | "specialized_eval";
  /**
   * Simulate outcomes for UI demos without calling paid APIs.
   * Results always land in demoCapabilityEvidence, never formal evidence.
   */
  simulate?: {
    /** Capabilities that should fail (e.g. tool_use while text_chat passes). */
    failIds?: CanonicalCapabilityId[];
    /** Capabilities that return taskId-only / no artifact (image/music). */
    noArtifactIds?: CanonicalCapabilityId[];
  };
};

function newTaskId(): string {
  return `cvt_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function evidenceFor(
  id: CanonicalCapabilityId,
  status: CapabilityEvidenceItem["status"],
  source: CapabilityEvidenceSource,
  extra?: Partial<CapabilityEvidenceItem>,
): CapabilityEvidenceItem {
  return {
    id,
    label: id,
    source,
    status,
    verifiedAt: status === "passed" || status === "failed" ? Date.now() : undefined,
    testVersion: "stub-v1-demo",
    sourceNote: extra?.sourceNote ?? "模拟结果，不代表真实能力",
    ...extra,
  };
}

/**
 * Create an async verification task (frontend stub).
 * Completes synchronously. Demo results are isolated from formal evidence.
 */
export function createCapabilityVerificationTask(
  input: CreateVerificationInput,
): CapabilityVerificationTask {
  const taskId = newTaskId();
  const now = Date.now();
  const mode = input.mode ?? "protocol_probe";
  const source: CapabilityEvidenceSource =
    mode === "specialized_eval" ? "specialized_eval" : "protocol_probe";
  const failIds = new Set(input.simulate?.failIds ?? []);
  const noArtifactIds = new Set(input.simulate?.noArtifactIds ?? []);

  const results: CapabilityEvidenceItem[] = input.capabilityIds.map((id) => {
    if (failIds.has(id)) {
      return evidenceFor(id, "failed", source, {
        failureReason: `${id} 专项检查失败（连接成功不等于能力可用）· 模拟结果，不代表真实能力`,
        sourceNote: "模拟结果，不代表真实能力",
      });
    }
    if (noArtifactIds.has(id)) {
      return evidenceFor(id, "failed", source, {
        failureReason:
          "仅返回 taskId，尚无有效产物，不能标记为目标模态完成 · 模拟结果，不代表真实能力",
        sourceNote: "模拟结果，不代表真实能力",
      });
    }
    return evidenceFor(id, "passed", source, {
      sourceNote: "模拟结果，不代表真实能力",
      expiresAt: now + 7 * 24 * 60 * 60 * 1000,
    });
  });

  const failed = results.filter((r) => r.status === "failed").length;
  const passed = results.filter((r) => r.status === "passed").length;
  let status: CapabilityVerificationTask["status"] = "succeeded";
  if (failed > 0 && passed > 0) {
    status = "partial";
  } else if (failed > 0) {
    status = "failed";
  }

  const task: CapabilityVerificationTask = {
    taskId,
    modelRef: input.modelRef.trim(),
    capabilityIds: input.capabilityIds,
    status,
    createdAt: now,
    updatedAt: now,
    results,
    estimatedCalls: input.capabilityIds.length,
    error: "界面演示 stub — 非真实验证，不代表真实能力",
  };
  saveVerificationTask(task);

  // Demo isolation: never merge into formal capabilityEvidence.
  const admission = getModelAdmission(task.modelRef);
  const byId = new Map((admission.demoCapabilityEvidence ?? []).map((item) => [item.id, item]));
  for (const item of results) {
    byId.set(item.id, item);
  }
  upsertModelAdmission(task.modelRef, {
    demoCapabilityEvidence: Array.from(byId.values()),
  });

  return task;
}

export function cancelCapabilityVerificationTask(
  taskId: string,
): CapabilityVerificationTask | null {
  const task = getVerificationTask(taskId);
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

export function refreshCapabilityVerificationTask(
  taskId: string,
): CapabilityVerificationTask | null {
  return getVerificationTask(taskId);
}

export { listVerificationTasks, getVerificationTask };

/** Expire formal evidence when connection fingerprint changes. */
export function expireCapabilityEvidenceForModel(modelRef: string, reason: string) {
  return expireFormalCapabilityEvidence(modelRef, reason);
}
