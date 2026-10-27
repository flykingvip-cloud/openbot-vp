/**
 * Gateway RPC adapter for capability verification / routing eligibility.
 * Formal authority — results may enter verified sets when backend says so.
 * Requires a live gateway request function; does not invent local stub verified.
 */

import {
  saveVerificationTask,
  upsertModelAdmission,
  type CapabilityVerificationTask,
  type ModelAdmissionRecord,
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

export type AdmissionGatewayRequest = <T>(
  method: string,
  params?: Record<string, unknown>,
) => Promise<T>;

export const MODELS_ADMISSION_METHODS = {
  discoverCapabilities: "models.admission.discoverCapabilities",
  createVerificationTask: "models.admission.createVerificationTask",
  getVerificationTask: "models.admission.getVerificationTask",
  listVerificationTasks: "models.admission.listVerificationTasks",
  cancelVerificationTask: "models.admission.cancelVerificationTask",
  createBatchVerificationTasks: "models.admission.createBatchVerificationTasks",
  setRoutingEligibility: "models.admission.setRoutingEligibility",
  getModelAdmission: "models.admission.getModelAdmission",
  listModelAdmissions: "models.admission.listModelAdmissions",
  previewRoutingDecision: "models.admission.previewRoutingDecision",
} as const;

function mirrorTask(task: CapabilityVerificationTask | null | undefined) {
  if (task && typeof task.taskId === "string") {
    saveVerificationTask(task);
  }
}

function mirrorAdmission(admission: ModelAdmissionRecord | null | undefined) {
  if (!admission || typeof admission.modelRef !== "string") {
    return;
  }
  const { modelRef, ...rest } = admission;
  upsertModelAdmission(modelRef, {
    ...rest,
    // Mark as platform-effective so adapter may surface controls.
    platformEffective: true,
  });
}

export function createRpcCapabilityVerificationService(
  request: AdmissionGatewayRequest,
): CapabilityVerificationService {
  return {
    kind: "rpc",
    authority: "formal",

    async discoverCapabilities(
      req: DiscoverCapabilitiesRequest,
    ): Promise<DiscoverCapabilitiesResponse> {
      const result = await request<DiscoverCapabilitiesResponse>(
        MODELS_ADMISSION_METHODS.discoverCapabilities,
        {
          modelRef: req.modelRef,
          ...(req.declaredCapabilities ? { declaredCapabilities: req.declaredCapabilities } : {}),
          ...(req.callType ? { callType: req.callType } : {}),
        },
      );
      return {
        modelRef: result.modelRef,
        adapter: result.adapter ?? "gateway_rpc",
        capabilities: result.capabilities ?? [],
      };
    },

    async createVerificationTask(
      req: CreateVerificationTaskRequest,
    ): Promise<CreateVerificationTaskResponse> {
      const result = await request<{
        task: CapabilityVerificationTask;
        authority: "formal" | "demo";
      }>(MODELS_ADMISSION_METHODS.createVerificationTask, {
        modelRef: req.modelRef,
        capabilityIds: req.capabilityIds,
        ...(req.mode ? { mode: req.mode } : {}),
        ...(req.configFingerprint ? { configFingerprint: req.configFingerprint } : {}),
        ...(req.estimatedCalls != null ? { estimatedCalls: req.estimatedCalls } : {}),
      });
      mirrorTask(result.task);
      // Refresh admission so formal evidence is visible in UI store.
      try {
        const { admission } = await request<{ admission: ModelAdmissionRecord }>(
          MODELS_ADMISSION_METHODS.getModelAdmission,
          { modelRef: req.modelRef },
        );
        mirrorAdmission(admission);
      } catch {
        // Task already mirrored; admission refresh is best-effort.
      }
      return {
        task: result.task,
        authority: result.authority === "demo" ? "demo" : "formal",
      };
    },

    async getVerificationTask(
      req: GetVerificationTaskRequest,
    ): Promise<CapabilityVerificationTask | null> {
      const result = await request<{ task: CapabilityVerificationTask | null }>(
        MODELS_ADMISSION_METHODS.getVerificationTask,
        { taskId: req.taskId },
      );
      mirrorTask(result.task ?? undefined);
      return result.task ?? null;
    },

    async listVerificationTasks(
      req?: ListVerificationTasksRequest,
    ): Promise<CapabilityVerificationTask[]> {
      const result = await request<{ tasks: CapabilityVerificationTask[] }>(
        MODELS_ADMISSION_METHODS.listVerificationTasks,
        req?.modelRef ? { modelRef: req.modelRef } : {},
      );
      for (const task of result.tasks ?? []) {
        mirrorTask(task);
      }
      return result.tasks ?? [];
    },

    async cancelVerificationTask(
      req: CancelVerificationTaskRequest,
    ): Promise<CapabilityVerificationTask | null> {
      const result = await request<{ task: CapabilityVerificationTask | null }>(
        MODELS_ADMISSION_METHODS.cancelVerificationTask,
        { taskId: req.taskId },
      );
      mirrorTask(result.task ?? undefined);
      return result.task ?? null;
    },

    async setRoutingEligibility(
      req: SetRoutingEligibilityRequest,
    ): Promise<SetRoutingEligibilityResponse> {
      const result = await request<{
        status: "applied";
        modelRef: string;
        autoRouting: SetRoutingEligibilityRequest["autoRouting"];
        admission?: ModelAdmissionRecord;
      }>(MODELS_ADMISSION_METHODS.setRoutingEligibility, {
        modelRef: req.modelRef,
        autoRouting: req.autoRouting,
        ...(req.reason ? { reason: req.reason } : {}),
        ...(req.taskCategories ? { taskCategories: req.taskCategories } : {}),
        ...(req.tenantSelectable !== undefined ? { tenantSelectable: req.tenantSelectable } : {}),
      });
      if (result.admission) {
        mirrorAdmission(result.admission);
      } else {
        upsertModelAdmission(req.modelRef, {
          autoRouting: result.autoRouting,
          autoRoutingReason: req.reason,
          ...(req.taskCategories ? { autoRoutingTaskCategories: req.taskCategories } : {}),
          platformEffective: true,
        } as never);
      }
      return {
        status: "applied",
        modelRef: result.modelRef,
        autoRouting: result.autoRouting,
      };
    },

    async createBatchVerificationTasks(
      req: BatchVerificationRequest,
    ): Promise<BatchVerificationResponse> {
      const result = await request<{
        tasks: CreateVerificationTaskResponse[];
      }>(MODELS_ADMISSION_METHODS.createBatchVerificationTasks, {
        items: req.items.map((item) => ({
          modelRef: item.modelRef,
          capabilityIds: item.capabilityIds,
          ...(item.mode ? { mode: item.mode } : {}),
          ...(item.configFingerprint ? { configFingerprint: item.configFingerprint } : {}),
          ...(item.estimatedCalls != null ? { estimatedCalls: item.estimatedCalls } : {}),
        })),
      });
      for (const entry of result.tasks ?? []) {
        mirrorTask(entry.task);
      }
      return { tasks: result.tasks ?? [] };
    },
  };
}

/** Pull all backend admissions into the local UI store (platform-effective). */
export async function syncAdmissionsFromGateway(request: AdmissionGatewayRequest): Promise<number> {
  const result = await request<{ admissions: ModelAdmissionRecord[] }>(
    MODELS_ADMISSION_METHODS.listModelAdmissions,
    {},
  );
  let count = 0;
  for (const admission of result.admissions ?? []) {
    mirrorAdmission(admission);
    count += 1;
  }
  return count;
}
