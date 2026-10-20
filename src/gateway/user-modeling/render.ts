import type { ExecAsk } from "../../infra/exec-approvals.js";
import type { UserProfile } from "./types.js";
import { DEFAULT_USER_PROFILE } from "./types.js";

export type UserProfileRenderOptions = {
  /**
   * 企业 exec ask。不是 `off` 时，proactive 不能写成「避免确认」，
   * 改留仍服从当前审批。未传入时按默认 on-miss 处理。
   */
  execAsk?: ExecAsk | null;
};

/**
 * Render learned user preferences for system prompt injection.
 * Neutral defaults produce no lines; empty → "".
 */
export function renderUserProfileInstructions(
  profile: UserProfile,
  options?: UserProfileRenderOptions,
): string {
  const merged = { ...DEFAULT_USER_PROFILE, ...profile };
  const lines: string[] = [];

  if (merged.preferredReplyLanguage?.trim()) {
    const lang = merged.preferredReplyLanguage.trim();
    lines.push(`Reply in ${lang === "zh" ? "Chinese" : lang === "en" ? "English" : lang}.`);
  }

  if (merged.preferredTimezone?.trim()) {
    lines.push(`Use timezone ${merged.preferredTimezone.trim()} for schedules and local times.`);
  }

  switch (merged.preferredOutputFormat) {
    case "concise":
      lines.push("Keep replies concise and to the point.");
      break;
    case "detailed":
      lines.push("Provide detailed, thorough replies.");
      break;
    case "conversational":
      lines.push("Keep a natural, conversational tone in structure and length.");
      break;
    case "structured":
      break;
  }

  switch (merged.verbosity) {
    case "terse":
      lines.push("Prefer very short answers unless detail is essential.");
      break;
    case "verbose":
      lines.push("Provide fuller explanations when helpful.");
      break;
    case "normal":
      break;
  }

  switch (merged.confirmationPreference) {
    case "proactive":
      if (options?.execAsk === "off") {
        lines.push("Act proactively on low-risk steps; avoid unnecessary confirmation loops.");
      } else {
        lines.push("Still obey the current approval policy; do not skip confirmation.");
      }
      break;
    case "confirm_first":
      break;
  }

  if (merged.preferredTone === "formal") {
    lines.push("Use a formal, professional tone.");
  } else if (merged.preferredTone === "friendly") {
    lines.push("Use a warm, friendly tone.");
  }

  if (lines.length === 0) {
    return "";
  }
  return ["Apply this user's learned preferences:", ...lines.map((line) => `- ${line}`)].join("\n");
}
