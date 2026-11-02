import { resolveCorrectionNoticeSessionKey } from "./correction-notice-session.js";
/**
 * Session inject adapter for a correction notice.
 * Acceptance means the gateway took the transcript write.
 * It is not a read receipt and it is not task success.
 * Callers can pass a mock inject; the live path uses chat.inject.
 */
import type { CorrectionNotifySend } from "./correction-notify.js";

export const CORRECTION_NOTICE_INJECT_LABEL = "纠正记录";

export type CorrectionNoticeInjectInput = {
  method: "chat.inject";
  params: {
    sessionKey: string;
    message: string;
    label: string;
  };
  timeoutMs?: number;
};

export type CorrectionNoticeInject = (input: CorrectionNoticeInjectInput) => Promise<unknown>;

function injectAccepted(result: unknown): boolean {
  if (result == null || typeof result !== "object") {
    return result == null || typeof result === "string" || typeof result === "number";
  }
  const row = result as Record<string, unknown>;
  if (row.ok === false || row.accepted === false || row.error != null) {
    return false;
  }
  return true;
}

async function liveInject(input: CorrectionNoticeInjectInput): Promise<unknown> {
  const { callGateway } = await import("./correction-notice-inject.runtime.js");
  return await callGateway({
    method: input.method,
    params: input.params,
    timeoutMs: input.timeoutMs,
  });
}

export function createCorrectionNoticeSessionInject(options?: {
  inject?: CorrectionNoticeInject;
}): CorrectionNotifySend {
  const inject = options?.inject ?? liveInject;
  return async ({ platformUserId, text }) => {
    const sessionKey = resolveCorrectionNoticeSessionKey(platformUserId);
    const message = text.trim();
    if (!sessionKey || !message) {
      throw new Error("correction_notice_session_forbidden");
    }
    const result = await inject({
      method: "chat.inject",
      params: {
        sessionKey,
        message,
        label: CORRECTION_NOTICE_INJECT_LABEL,
      },
      timeoutMs: 20_000,
    });
    if (!injectAccepted(result)) {
      throw new Error("correction_notice_inject_rejected");
    }
    return { accepted: true };
  };
}
