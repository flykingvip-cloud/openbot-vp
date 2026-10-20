/**
 * User-visible guidance lead copy. Snapshot.reason may be an i18n key;
 * never render dotted keys on the employee surface.
 */

import { i18n, t } from "../../../../i18n/index.ts";

const REASON_FALLBACK: Record<string, { "zh-CN": string; en: string }> = {
  // Onboarding copy already lives in the muted prelude bubble — keep lead empty.
  "guidance.recommend.steward_onboarding": { "zh-CN": "", en: "" },
  "guidance.recommendation.steward_onboarding": { "zh-CN": "", en: "" },
  "guidance.recommend.team_stale_mission": {
    "zh-CN": "这条群使命已经有一段时间没有推进了。",
    en: "This team mission has been idle for a while.",
  },
  "guidance.recommend.upgrade_mission": {
    "zh-CN": "可以升级这条群使命，让协作重新转起来。",
    en: "Upgrade this team mission to get collaboration moving again.",
  },
  "guidance.recommend.daibai_signal": {
    "zh-CN": "大白看到一条需要你过目的信号。",
    en: "Daibai spotted a signal that needs a look.",
  },
  "guidance.recommend.none": { "zh-CN": "", en: "" },
  "guidance.none": { "zh-CN": "", en: "" },
};

const MACHINE_KEY = /^[a-z][a-z0-9._-]*\.[a-z0-9._-]+$/i;

export function resolveGuidanceReasonCopy(reason: string | null | undefined): string {
  const trimmed = reason?.trim() ?? "";
  if (!trimmed) {
    return "";
  }
  const mapped = REASON_FALLBACK[trimmed];
  if (mapped) {
    return i18n.getLocale() === "zh-CN" ? mapped["zh-CN"] : mapped.en;
  }
  // Dotted machine keys must never surface i18n templates (e.g. "{count} min").
  if (MACHINE_KEY.test(trimmed)) {
    return "";
  }
  const translated = t(trimmed);
  if (translated !== trimmed) {
    return translated;
  }
  return trimmed;
}
