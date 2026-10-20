import { callGateway } from "../gateway/call.js";
import { logWarn } from "../logger.js";
import { resolveHeartbeatParkedNoticePayload } from "./heartbeat-parked-notice.js";

export async function surfaceHeartbeatParkedNotice(params: {
  sessionKey: string;
  reason?: string;
  parkReason: "park" | "reject_park_full";
  eventTexts?: readonly string[];
  droppedTaskId?: string;
  droppedTitle?: string;
  droppedPaths?: readonly string[];
}): Promise<{ injected: boolean; outboundText: string }> {
  const payload = resolveHeartbeatParkedNoticePayload(params);
  try {
    await callGateway({
      method: "chat.inject",
      params: {
        sessionKey: params.sessionKey,
        message: payload.message,
        label: payload.label,
        ...(payload.cronJobId
          ? {
              cronJobId: payload.cronJobId,
              cronJobName: payload.cronJobName,
              cronResultKind: "parked_notice",
            }
          : {}),
      },
      timeoutMs: 20_000,
    });
    return { injected: true, outboundText: payload.outboundText };
  } catch (err) {
    logWarn(
      `heartbeat: parked-notice inject failed (sessionKey=${params.sessionKey}, reason=${params.reason ?? "none"}, err=${String(err)})`,
    );
    return { injected: false, outboundText: payload.outboundText };
  }
}
