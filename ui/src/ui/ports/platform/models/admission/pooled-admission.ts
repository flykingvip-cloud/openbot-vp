/**
 * After 入池 (or a successful probe of a model already in the pool), write the
 * gateway admission row live chat actually reads.
 * Local drafts are not execution authority. An existing gateway row — including
 * an admin pause or disable — is left as stored.
 *
 * Reason text matches the gateway sync in
 * `src/gateway/models/capability-admission/sync-pooled-admission.ts`.
 */

import { getModelAdmission } from "../model-admission-store.ts";
import { setModelRoutingEligibility } from "./controller.ts";
import { isCapabilityAdmissionRpcActive } from "./verification-service.ts";

export const POOLED_HEALTHY_ADMISSION_REASON = "已入池且连接健康，同步为可执行准入";

export async function admitPooledModelAfterConnection(modelRef: string): Promise<boolean> {
  const key = modelRef.trim();
  if (!key || !isCapabilityAdmissionRpcActive()) {
    return false;
  }
  try {
    const existing = getModelAdmission(key);
    if (existing.platformEffective) {
      return false;
    }
    const result = await setModelRoutingEligibility({
      modelRef: key,
      autoRouting: "eligible",
      reason: POOLED_HEALTHY_ADMISSION_REASON,
    });
    return result.status === "applied";
  } catch {
    return false;
  }
}
