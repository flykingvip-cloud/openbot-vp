import {
  formatUserTime,
  resolveUserTimeFormat,
  resolveUserTimezone,
  type ResolvedTimeFormat,
} from "../../agents/date-time.js";
import type { OpenBotConfig } from "../../config/config.js";
import type { UserProfile } from "../../gateway/user-modeling/types.js";

/** Default for webchat when host/config leave timezone at UTC. */
export const WEBCHAT_DEFAULT_TIMEZONE = "Asia/Shanghai";

function isValidIanaTimezone(value: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value }).format(new Date());
    return true;
  } catch {
    return false;
  }
}

export function resolveReplyUserTimezone(params: {
  cfg: OpenBotConfig;
  profile?: Pick<UserProfile, "preferredTimezone"> | null;
  isWebchat?: boolean;
}): string {
  const profileTz = params.profile?.preferredTimezone?.trim();
  if (profileTz && isValidIanaTimezone(profileTz)) {
    return profileTz;
  }
  const configured = params.cfg?.agents?.defaults?.userTimezone?.trim();
  if (configured && isValidIanaTimezone(configured)) {
    return configured;
  }
  const hostTz = resolveUserTimezone(undefined);
  if (params.isWebchat && (!hostTz || hostTz === "UTC")) {
    return WEBCHAT_DEFAULT_TIMEZONE;
  }
  return hostTz;
}

export function buildReplyUserTimezonePrompt(params: {
  cfg: OpenBotConfig;
  profile?: Pick<UserProfile, "preferredTimezone"> | null;
  isWebchat?: boolean;
  now?: Date;
}): string {
  const timeZone = resolveReplyUserTimezone(params);
  const timeFormat: ResolvedTimeFormat = resolveUserTimeFormat(
    params.cfg?.agents?.defaults?.timeFormat,
  );
  const now = params.now ?? new Date();
  const formatted = formatUserTime(now, timeZone, timeFormat);
  const lines = ["## User Local Time (authoritative for scheduling)", `Time zone: ${timeZone}`];
  if (formatted) {
    lines.push(`Current local time: ${formatted}`);
  }
  lines.push(
    "When creating reminders, cron jobs, or discussing dates/times, use this timezone and show local times unless the user specifies another zone.",
  );
  return lines.join("\n");
}
