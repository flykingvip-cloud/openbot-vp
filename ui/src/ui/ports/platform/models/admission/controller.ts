/**
 * Capability admission controller: discover / start / query / cancel / routing eligibility.
 * Keeps first-batch authenticity: routing eligibility stays draft/not_wired until backend RPC.
 */

import { requestOpenBotAppRerender } from "../../../../request-app-rerender.ts";
import type { CanonicalCapabilityId } from "../capability-ids.ts";
import type { CapabilityVerificationTask } from "../model-admission-store.ts";
import {
  expireFormalCapabilityEvidence,
  interruptInFlightVerificationTasks,
} from "../model-admission-store.ts";
import type {
  CreateVerificationTaskRequest,
  DiscoverCapabilitiesResponse,
  SetRoutingEligibilityResponse,
  VerificationAuthority,
} from "./verification-contract.ts";
import type { CreateVerificationTaskResponse } from "./verification-contract.ts";
import {
  getCapabilityVerificationService,
  type DemoSimulateOptions,
} from "./verification-service.ts";

export type StartVerificationInput = {
  modelRef: string;
  capabilityIds: CanonicalCapabilityId[];
  mode?: "protocol_probe" | "specialized_eval";
  configFingerprint?: string;
  /** Demo-only overrides; ignored by formal adapters. */
  demoSimulate?: DemoSimulateOptions;
};

export type StartVerificationResult = {
  task: CapabilityVerificationTask;
  authority: VerificationAuthority;
};

export async function discoverModelCapabilities(input: {
  modelRef: string;
  declaredCapabilities?: string[];
  callType?: string;
}): Promise<DiscoverCapabilitiesResponse> {
  const service = getCapabilityVerificationService();
  return await service.discoverCapabilities(input);
}

export async function startCapabilityVerification(
  input: StartVerificationInput,
): Promise<StartVerificationResult> {
  const service = getCapabilityVerificationService();
  if (service.kind === "demo" && input.demoSimulate) {
    (service as { __nextSimulate?: DemoSimulateOptions }).__nextSimulate = input.demoSimulate;
  }
  const req: CreateVerificationTaskRequest = {
    modelRef: input.modelRef,
    capabilityIds: input.capabilityIds,
    mode: input.mode,
    configFingerprint: input.configFingerprint,
  };
  const response = await service.createVerificationTask(req);
  requestOpenBotAppRerender();
  return { task: response.task, authority: response.authority };
}

export async function startBatchCapabilityVerification(
  items: StartVerificationInput[],
): Promise<CreateVerificationTaskResponse[]> {
  const service = getCapabilityVerificationService();
  const response = await service.createBatchVerificationTasks({
    items: items.map((item) => ({
      modelRef: item.modelRef,
      capabilityIds: item.capabilityIds,
      mode: item.mode,
      configFingerprint: item.configFingerprint,
    })),
  });
  requestOpenBotAppRerender();
  return response.tasks;
}

export async function queryCapabilityVerificationTask(
  taskId: string,
): Promise<CapabilityVerificationTask | null> {
  return await getCapabilityVerificationService().getVerificationTask({ taskId });
}

export async function listModelVerificationTasks(
  modelRef?: string,
): Promise<CapabilityVerificationTask[]> {
  return await getCapabilityVerificationService().listVerificationTasks(
    modelRef ? { modelRef } : undefined,
  );
}

export async function cancelCapabilityVerification(
  taskId: string,
): Promise<CapabilityVerificationTask | null> {
  const task = await getCapabilityVerificationService().cancelVerificationTask({ taskId });
  requestOpenBotAppRerender();
  return task;
}

export async function retryCapabilityVerification(
  input: StartVerificationInput,
): Promise<StartVerificationResult> {
  return startCapabilityVerification(input);
}

/**
 * Routing eligibility — always reports not_wired until backend admission RPC lands.
 * Draft may be stored locally; UI must not present it as platform-effective.
 */
export async function setModelRoutingEligibility(input: {
  modelRef: string;
  autoRouting: "disabled" | "eligible" | "restricted" | "paused";
  reason?: string;
  taskCategories?: string[];
}): Promise<SetRoutingEligibilityResponse> {
  return await getCapabilityVerificationService().setRoutingEligibility(input);
}

/** Expire formal evidence when endpoint/fingerprint changes. */
export function expireModelCapabilityEvidence(modelRef: string, reason: string) {
  return expireFormalCapabilityEvidence(modelRef, reason);
}

/**
 * Refresh recovery: in-flight local tasks cannot resume (timers/Promises are gone).
 * Mark them interrupted ("已中断，可重试") so the UI never hangs on "验证中".
 * Returns the interrupted task for this model, else the most recent history row.
 */
export async function recoverActiveVerificationTask(
  modelRef: string,
): Promise<CapabilityVerificationTask | null> {
  const interrupted = interruptInFlightVerificationTasks(
    "已中断，可重试（页面刷新或执行上下文丢失）",
  );
  if (interrupted.length > 0) {
    requestOpenBotAppRerender();
  }
  const tasks = await listModelVerificationTasks(modelRef);
  const forModel = interrupted.find((t) => t.modelRef === modelRef.trim());
  return forModel ?? tasks[0] ?? null;
}
