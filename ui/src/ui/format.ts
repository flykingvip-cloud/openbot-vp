import { applyUserVisibleOutputGate } from "../../../src/agents/model-output-boundary.js";
import { formatDurationHuman } from "../../../src/infra/format-time/format-duration.ts";
import { formatRelativeTimestamp } from "../../../src/infra/format-time/format-relative.ts";
import { stripAssistantInternalScaffolding } from "../../../src/shared/text/assistant-visible-text.js";
import { t } from "../i18n/index.ts";

export { formatRelativeTimestamp, formatDurationHuman };

export function formatMs(ms?: number | null): string {
  if (!ms && ms !== 0) {
    return t("common.na");
  }
  return new Date(ms).toLocaleString();
}

/** Parse ISO / epoch timestamps for employee-facing absolute datetime display. */
export function formatIsoTimestamp(
  value: string | number | null | undefined,
  locale: "zh-CN" | "en" = "zh-CN",
  fallback = locale === "zh-CN" ? "未知" : "unknown",
): string {
  const ms =
    typeof value === "number"
      ? value
      : typeof value === "string" && value.trim()
        ? Date.parse(value.trim())
        : Number.NaN;
  if (!Number.isFinite(ms)) {
    return fallback;
  }
  return new Date(ms).toLocaleString(locale === "en" ? "en-US" : "zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
}

export function formatList(values?: Array<string | null | undefined>): string {
  if (!values || values.length === 0) {
    return t("common.none");
  }
  return values.filter((v): v is string => Boolean(v && v.trim())).join(", ");
}

export function clampText(value: string, max = 120): string {
  if (value.length <= max) {
    return value;
  }
  return `${value.slice(0, Math.max(0, max - 1))}…`;
}

export function truncateText(
  value: string,
  max: number,
): {
  text: string;
  truncated: boolean;
  total: number;
} {
  if (value.length <= max) {
    return { text: value, truncated: false, total: value.length };
  }
  return {
    text: value.slice(0, Math.max(0, max)),
    truncated: true,
    total: value.length,
  };
}

export function toNumber(value: string, fallback: number): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

export function parseList(input: string): string[] {
  return input
    .split(/[,\n]/)
    .map((v) => v.trim())
    .filter((v) => v.length > 0);
}

export function stripThinkingTags(value: string): string {
  return applyUserVisibleOutputGate(stripAssistantInternalScaffolding(value)).visibleText;
}
