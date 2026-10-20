import { callGateway } from "../gateway/call.js";
import {
  defaultDiagnosisTick,
  startDiagnosisScheduler,
  stopDiagnosisScheduler,
} from "./diagnose-tick.js";
import {
  DIAGNOSIS_DAIBAI_DELIVERY_ENABLED,
  DIAGNOSIS_P24_5_LIVE_SESSION_KEY,
  registerProductionDaibaiLiveSend,
} from "./production-cutover.js";

let started = false;
let daibaiSendRegistered = false;

/**
 * Wire canary-scoped chat.send bridge for live Da Bai transport.
 * Idempotent. Only meaningful when DIAGNOSIS_DAIBAI_DELIVERY_ENABLED is true.
 */
export function ensureProductionDaibaiLiveSendRegistered(): void {
  if (daibaiSendRegistered) {
    return;
  }
  daibaiSendRegistered = true;
  registerProductionDaibaiLiveSend(async (input) => {
    const sessionKey = input.sessionKey?.trim() || DIAGNOSIS_P24_5_LIVE_SESSION_KEY;
    const injectOnce = async () => {
      await callGateway({
        method: "chat.inject",
        params: {
          sessionKey,
          message: input.text,
          label: "诊断提醒",
        },
        timeoutMs: 10_000,
      });
    };
    const ensureCanarySession = async () => {
      // chat.inject requires a store entry; tip-smoke canary key is not user-created.
      await callGateway({
        method: "sessions.reset",
        params: { key: sessionKey, reason: "new" },
        timeoutMs: 10_000,
      });
    };
    try {
      // Prefer chat.send (P24.5 contract). deliver:false keeps canary off external channels.
      await callGateway({
        method: "chat.send",
        params: {
          sessionKey,
          message: input.text,
          idempotencyKey: input.deliveryId,
          deliver: false,
        },
        timeoutMs: 15_000,
      });
      return "accepted" as const;
    } catch {
      // Fallback: chat.inject into the same canary session (still a real gateway write).
      try {
        await injectOnce();
        return "accepted" as const;
      } catch (injectErr) {
        const msg = injectErr instanceof Error ? injectErr.message : String(injectErr);
        if (!/session not found/i.test(msg)) {
          return "unavailable" as const;
        }
        try {
          await ensureCanarySession();
          await injectOnce();
          return "accepted" as const;
        } catch {
          return "unavailable" as const;
        }
      }
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
