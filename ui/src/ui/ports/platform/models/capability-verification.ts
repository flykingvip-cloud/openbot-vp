/**
 * Capability verification facade.
 *
 * Formal path → local_protocol adapter (evidence → capabilityEvidence).
 * Demo/simulate path → isolated demoCapabilityEvidence only.
 */

import {
  cancelCapabilityVerification,
  discoverModelCapabilities,
  listModelVerificationTasks,
  queryCapabilityVerificationTask,
  recoverActiveVerificationTask,
  retryCapabilityVerification,
  setModelRoutingEligibility,
  startBatchCapabilityVerification,
  startCapabilityVerification,
} from "./admission/controller.ts";
import type { DemoSimulateOptions } from "./admission/demo-adapter.ts";
import {
  configureCapabilityVerificationService,
  createDemoCapabilityVerificationService,
  getCapabilityVerificationService,
  setCapabilityVerificationService,
  __resetCapabilityVerificationServiceForTest,
} from "./admission/verification-service.ts";
import type { CanonicalCapabilityId } from "./capability-ids.ts";
import {
  expireFormalCapabilityEvidence,
  getVerificationTask,
  listVerificationTasks,
  saveVerificationTask,
  type CapabilityVerificationTask,
} from "./model-admission-store.ts";

export type CreateVerificationInput = {
  modelRef: string;
  capabilityIds: CanonicalCapabilityId[];
  mode?: "protocol_probe" | "specialized_eval";
  configFingerprint?: string;
  /**
   * When set, forces the demo adapter for this call (isolated from formal evidence).
   * Omit for formal local_protocol verification.
   */
  simulate?: DemoSimulateOptions;
};

/**
 * Create a verification task.
 * - With `simulate`: demo adapter only (never formal evidence).
 * - Without: active formal service (default local_protocol).
 */
export function createCapabilityVerificationTask(
  input: CreateVerificationInput,
): CapabilityVerificationTask {
  if (input.simulate) {
    const demo = createDemoCapabilityVerificationService({ simulate: input.simulate });
    const { task } = demo.createVerificationTask({
      modelRef: input.modelRef,
      capabilityIds: input.capabilityIds,
      mode: input.mode,
      configFingerprint: input.configFingerprint,
    }) as { task: CapabilityVerificationTask };
    return task;
  }
  const service = getCapabilityVerificationService();
  const response = service.createVerificationTask({
    modelRef: input.modelRef,
    capabilityIds: input.capabilityIds,
    mode: input.mode,
    configFingerprint: input.configFingerprint,
  });
  // Local adapter may return sync; normalize.
  if (response && typeof (response as Promise<unknown>).then === "function") {
    throw new Error(
      "createCapabilityVerificationTask sync API requires a synchronous adapter; use startCapabilityVerification for async",
    );
  }
  return (response as { task: CapabilityVerificationTask }).task;
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

export {
  cancelCapabilityVerification,
  configureCapabilityVerificationService,
  discoverModelCapabilities,
  listModelVerificationTasks,
  queryCapabilityVerificationTask,
  recoverActiveVerificationTask,
  retryCapabilityVerification,
  setCapabilityVerificationService,
  setModelRoutingEligibility,
  startBatchCapabilityVerification,
  startCapabilityVerification,
  __resetCapabilityVerificationServiceForTest,
};
