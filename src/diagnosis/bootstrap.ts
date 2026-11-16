import {
  defaultDiagnosisTick,
  startDiagnosisScheduler,
  stopDiagnosisScheduler,
} from "./diagnose-tick.js";
import { deliverDiagnosisViaOfficialLiveGateway } from "./official-live-send.js";
import {
  DIAGNOSIS_DAIBAI_DELIVERY_ENABLED,
  DIAGNOSIS_P24_5_LIVE_SESSION_KEY,
  registerProductionDaibaiLiveSend,
} from "./production-cutover.js";
import { isDiagnosisContractError } from "./types.js";

let started = false;
let daibaiSendRegistered = false;

/**
 * Wire canary-scoped chat.send bridge for live Da Bai transport.
 * Idempotent. Only meaningful when DIAGNOSIS_DAIBAI_DELIVERY_ENABLED is true.
 * Writes stay on the official canary session; auth failures do not fall back
 * to chat.inject; sessions.reset is only used for that canary key.
 */
export function ensureProductionDaibaiLiveSendRegistered(): void {
  if (daibaiSendRegistered) {
    return;
  }
  daibaiSendRegistered = true;
  registerProductionDaibaiLiveSend(async (input) => {
    const sessionKey = input.sessionKey?.trim() || DIAGNOSIS_P24_5_LIVE_SESSION_KEY;
    try {
      const result = await deliverDiagnosisViaOfficialLiveGateway({
        sessionKey,
        tenantId: input.tenantId,
        text: input.text,
        deliveryId: input.deliveryId,
        route: input.route,
      });
      return result === "accepted" ? "accepted" : "unavailable";
    } catch (error) {
      if (isDiagnosisContractError(error)) {
        return "unavailable";
      }
      return "unavailable";
    }
  });
  void DIAGNOSIS_DAIBAI_DELIVERY_ENABLED;
}

/** Idempotent production registration for the diagnosis interval job. */
export function ensureDiagnosisSchedulerStarted(): void {
  ensureProductionDaibaiLiveSendRegistered();
  if (started) {
    return;
  }
  started = true;
  startDiagnosisScheduler(async () => {
    await defaultDiagnosisTick();
  });
}

export function stopDiagnosisSchedulerForShutdown(): void {
  stopDiagnosisScheduler();
  started = false;
}
