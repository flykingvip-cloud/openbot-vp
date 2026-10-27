/**
 * Demo verification adapter — UI-only simulation.
 * Results write exclusively to demoCapabilityEvidence and never enter formal verified sets.
 */

import type { CapabilityEvidenceItem } from "../capability-evidence.ts";
import { capabilityLabel } from "../capability-ids.ts";
import type { CanonicalCapabilityId } from "../capability-ids.ts";
import { CAPABILITY_LABEL_ZH, normalizeCapabilityIds } from "../capability-ids.ts";
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
  CapabilityVerificationService,
  CreateVerificationTaskRequest,
  CreateVerificationTaskResponse,
  DiscoverCapabilitiesRequest,
  DiscoverCapabilitiesResponse,
  GetVerificationTaskRequest,
  ListVerificationTasksRequest,
  SetRoutingEligibilityRequest,
  SetRoutingEligibilityResponse,
} from "./verification-contract.ts";

export type DemoSimulateOptions = {
  failIds?: CanonicalCapabilityId[];
  noArtifactIds?: CanonicalCapabilityId[];
};

export type DemoAdapterOptions = {
  /** Default simulate map applied when create request has no per-call override. */
  simulate?: DemoSimulateOptions;
};

function newTaskId(): string {
  return `cvt_demo_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function evidenceFor(
  id: CanonicalCapabilityId,
  status: CapabilityEvidenceItem["status"],
  mode: "protocol_probe" | "specialized_eval",
  extra?: Partial<CapabilityEvidenceItem>,
): CapabilityEvidenceItem {
  return {
    id,
    label: capabilityLabel(id),
    source: mode === "specialized_eval" ? "specialized_eval" : "protocol_probe",
    status,
    verifiedAt: status === "passed" || status === "failed" ? Date.now() : undefined,
    testVersion: "stub-v1-demo",
    sourceNote: extra?.sourceNote ?? "模拟结果，不代表真实能力",
    ...extra,
  };
}

export function createDemoCapabilityVerificationService(
  options: DemoAdapterOptions = {},
): CapabilityVerificationService & {
  /** Test/helper: pass simulate overrides for one create call via closure field. */
  __nextSimulate?: DemoSimulateOptions;
} {
  const service: CapabilityVerificationService & {
    __nextSimulate?: DemoSimulateOptions;
  } = {
    kind: "demo",
    authority: "demo",

    discoverCapabilities(req: DiscoverCapabilitiesRequest): DiscoverCapabilitiesResponse {
      const ids = normalizeCapabilityIds(req.declaredCapabilities ?? ["text_chat"]);
      return {
        modelRef: req.modelRef.trim(),
        adapter: "demo",
        capabilities: ids.map((id) => ({
          id,
          label: CAPABILITY_LABEL_ZH[id],
          source: "name_inferred",
          sourceNote: "演示发现，非正式档案",
          suggested: true,
        })),
      };
    },

    createVerificationTask(req: CreateVerificationTaskRequest): CreateVerificationTaskResponse {
      const simulate = service.__nextSimulate ?? options.simulate ?? {};
      service.__nextSimulate = undefined;
      const failIds = new Set(simulate.failIds ?? []);
      const noArtifactIds = new Set(simulate.noArtifactIds ?? []);
      const mode = req.mode ?? "protocol_probe";
      const now = Date.now();
      const results: CapabilityEvidenceItem[] = req.capabilityIds.map((id) => {
        if (failIds.has(id)) {
          return evidenceFor(id, "failed", mode, {
            failureReason: `${id} 专项检查失败（连接成功不等于能力可用）· 模拟结果，不代表真实能力`,
          });
        }
        if (noArtifactIds.has(id)) {
          return evidenceFor(id, "failed", mode, {
            failureReason:
              "仅返回 taskId，尚无有效产物，不能标记为目标模态完成 · 模拟结果，不代表真实能力",
          });
        }
        return evidenceFor(id, "passed", mode, {
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
        taskId: newTaskId(),
        modelRef: req.modelRef.trim(),
        capabilityIds: req.capabilityIds,
        status,
        createdAt: now,
        updatedAt: now,
        results,
        estimatedCalls: req.capabilityIds.length,
        error: "界面演示 stub — 非真实验证，不代表真实能力",
      };
      saveVerificationTask(task);

      const admission = getModelAdmission(task.modelRef);
      const byId = new Map((admission.demoCapabilityEvidence ?? []).map((item) => [item.id, item]));
      for (const item of results) {
        byId.set(item.id, item);
      }
      upsertModelAdmission(task.modelRef, {
        demoCapabilityEvidence: Array.from(byId.values()),
      });

      return { task, authority: "demo" };
    },

    getVerificationTask(req: GetVerificationTaskRequest) {
      return getVerificationTask(req.taskId);
    },

    listVerificationTasks(req?: ListVerificationTasksRequest) {
      return listVerificationTasks(req?.modelRef);
    },

    cancelVerificationTask(req: CancelVerificationTaskRequest) {
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
    },

    setRoutingEligibility(req: SetRoutingEligibilityRequest): SetRoutingEligibilityResponse {
      setAutoRoutingAdmission(req.modelRef, req.autoRouting, {
        reason: req.reason ?? "演示草稿，不代表平台生效",
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
        message: "演示适配器：路由资格仅为本地草稿，非后端决策",
      };
    },

    createBatchVerificationTasks(req: BatchVerificationRequest): BatchVerificationResponse {
      return {
        tasks: req.items.map((item) =>
          (
            service.createVerificationTask as (
              r: CreateVerificationTaskRequest,
            ) => CreateVerificationTaskResponse
          )(item),
        ),
      };
    },
  };
  return service;
}
