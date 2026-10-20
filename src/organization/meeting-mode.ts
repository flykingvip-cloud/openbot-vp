/**
 * Meeting mode + joinUrl preflight for confirmation-card SPEC
 * (docs/design/confirmation-card-spec.md §4.1 / §4.4).
 *
 * Prefer explicit `meetingMode`; location regex is legacy compat only.
 * Online meetings without a usable joinUrl must not issue pending_confirmation.
 */

export type MeetingMode = "online" | "offline";

/** Shared with UI `meeting-notice-text.ts` ONLINE_LOCATION (legacy location labels). */
export const ONLINE_LOCATION_PATTERN = /线上|远程|腾讯会议|online|remote|virtual|wemeet|tencent/i;

export type MeetingModeFields = {
  meetingMode?: MeetingMode;
  location?: string;
  joinUrl?: string;
};

export function parseMeetingMode(raw: unknown): MeetingMode | undefined {
  if (raw === "online" || raw === "offline") {
    return raw;
  }
  if (typeof raw === "string") {
    const trimmed = raw.trim().toLowerCase();
    if (trimmed === "online" || trimmed === "offline") {
      return trimmed;
    }
  }
  return undefined;
}

/**
 * Resolve online|offline. Explicit meetingMode wins; otherwise legacy location regex
 * may yield "online". Non-matching legacy data returns undefined (treated as offline
 * for joinUrl requirements).
 */
export function resolveMeetingMode(meeting: MeetingModeFields): MeetingMode | undefined {
  const explicit = parseMeetingMode(meeting.meetingMode);
  if (explicit) {
    return explicit;
  }
  const location = meeting.location?.trim() ?? "";
  if (location && ONLINE_LOCATION_PATTERN.test(location)) {
    return "online";
  }
  return undefined;
}

export function isOnlineMeeting(meeting: MeetingModeFields): boolean {
  return resolveMeetingMode(meeting) === "online";
}

export function hasUsableJoinUrl(meeting: Pick<MeetingModeFields, "joinUrl">): boolean {
  return Boolean(meeting.joinUrl?.trim());
}

export type MeetingProvisionFailureReason =
  | "skipped"
  | "no_context"
  | "no_identity"
  | "policy_denied"
  | "execution_failed"
  | "missing_join_url";

export type MeetingJoinUrlPreflightOk = { ok: true };

export type MeetingJoinUrlPreflightFail = {
  ok: false;
  code: "provision_required" | "provision_failed";
  message: string;
  provisionReason?: string;
};

export type MeetingJoinUrlPreflightResult = MeetingJoinUrlPreflightOk | MeetingJoinUrlPreflightFail;

function classifyProvisionCode(
  reason: string | undefined,
): "provision_required" | "provision_failed" {
  switch (reason) {
    case "execution_failed":
    case "missing_join_url":
    case "policy_denied":
      return "provision_failed";
    case "no_context":
    case "no_identity":
    case "skipped":
    case undefined:
    default:
      return "provision_required";
  }
}

function defaultMessage(code: "provision_required" | "provision_failed"): string {
  return code === "provision_failed"
    ? "线上会议开通失败，尚未获得可用入会链接；请修复后重试，不能确认发送。"
    : "线上会议尚未开通或缺少入会链接；请先完成开通后再确认发送。";
}

/**
 * Gateway preflight before issuing pending_confirmation (and before consuming
 * a ticket for online meetings that still lack joinUrl).
 * Fail immediately — no silent N retries in the same tool/RPC call.
 */
export function preflightOnlineMeetingJoinUrl(
  meeting: MeetingModeFields,
  opts?: {
    provisionReason?: MeetingProvisionFailureReason;
    provisionDetail?: string;
  },
): MeetingJoinUrlPreflightResult {
  if (!isOnlineMeeting(meeting)) {
    return { ok: true };
  }
  if (hasUsableJoinUrl(meeting)) {
    return { ok: true };
  }
  const code = classifyProvisionCode(opts?.provisionReason);
  const detail = opts?.provisionDetail?.trim();
  const message = detail ? `${defaultMessage(code)}（${detail}）` : defaultMessage(code);
  return {
    ok: false,
    code,
    message,
    ...(opts?.provisionReason ? { provisionReason: opts.provisionReason } : {}),
  };
}
