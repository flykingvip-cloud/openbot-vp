/**
 * Capability admission controller: discover / start / query / cancel / routing eligibility.
 * When gateway RPC is bound, setRoutingEligibility returns applied (admission store
 * platform-effective). That is management persistence + dry-run preview input — not
 * live agent/chat model selection.
 * Offline / unbound path stays draft/not_wired via local_protocol adapter.
 */

import { requestOpenBotAppRerender } from "../../../../request-app-rerender.ts";
import type { CanonicalCapabilityId } from "../capability-ids.ts";
import type { CapabilityVerificationTask } from "../model-admission-store.ts";
import {
  expireFormalCapabilityEvidence,
  interruptOrphanedInFlightVerificationTasks,
} from "../model-admission-store.ts";
import type {
  CreateVerificationTaskRequest,
  DiscoverCapabilitiesResponse,
  SetRoutingEligibilityResponse,
  VerificationAuthority,
} from "./verification-contract.ts";
import type { CreateVerificationTaskResponse } from "./verification-contract.ts";
import {
  ensureCapabilityVerificationLifecycle,
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
 * Routing eligibility — returns applied (store write) when gateway RPC is bound;
 * otherwise local_protocol reports not_wired draft.
 * Applied does not mean live session routing already consumes eligibility.
 */
export async function setModelRoutingEligibility(input: {
  modelRef: string;
  autoRouting: "disabled" | "eligible" | "restricted" | "paused";
  reason?: string;
  taskCategories?: string[];
  tenantSelectable?: boolean;
}): Promise<SetRoutingEligibilityResponse> {
  return await getCapabilityVerificationService().setRoutingEligibility(input);
}

/** Expire formal evidence when endpoint/fingerprint changes. */
export function expireModelCapabilityEvidence(modelRef: string, reason: string) {
  return expireFormalCapabilityEvidence(modelRef, reason);
}

/**
 * Refresh recovery: in-flight local tasks cannot resume (timers/Promises are gone).
 * Marks ORPHANED tasks interrupted ("已中断，可重试") so the UI never hangs on "验证中".
 * Live tasks started in this page/process are left alone — opening a detail drawer
 * must not globally interrupt every model's running verification.
 * Returns the interrupted task for this model, else the most recent history row.
 */
export async function recoverActiveVerificationTask(
  modelRef: string,
): Promise<CapabilityVerificationTask | null> {
  const interrupted = interruptOrphanedInFlightVerificationTasks(
    "已中断，可重试（页面刷新或执行上下文丢失）",
  );
  if (interrupted.length > 0) {
    requestOpenBotAppRerender();
  }
  const tasks = await listModelVerificationTasks(modelRef);
  const forModel = interrupted.find((t) => t.modelRef === modelRef.trim());
  return forModel ?? tasks[0] ?? null;
}

export { ensureCapabilityVerificationLifecycle };
