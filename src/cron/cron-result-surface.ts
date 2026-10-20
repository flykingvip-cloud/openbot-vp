import {
  CRON_RESULT_TITLE_MARKER,
  CRON_RESULT_TITLE_MARKER_LEGACY,
} from "./cron-result-template.js";

/**
 * Cron result cards are Projection, not Execution Context (EA-I2 / EA-B4).
 * UI may render them; agent history must omit them.
 */

const CRON_RESULT_MARKERS = [CRON_RESULT_TITLE_MARKER, CRON_RESULT_TITLE_MARKER_LEGACY] as const;
const CRON_JOB_ID_RE = /(?:定时)?任务 ID[：:]\s*`([^`]+)`/;

function textLooksLikeCronResultSurface(text: string): boolean {
  return CRON_RESULT_MARKERS.some((marker) => text.includes(marker)) && CRON_JOB_ID_RE.test(text);
}

export type CronResultSurfaceLike = {
  role?: unknown;
  content?: unknown;
  openclawCronResult?: unknown;
  model?: unknown;
};

function extractText(content: unknown): string {
  if (typeof content === "string") {
    return content;
  }
  if (!Array.isArray(content)) {
    return "";
  }
  const parts: string[] = [];
  for (const block of content) {
    if (block && typeof block === "object" && "text" in block) {
      const text = (block as { text?: unknown }).text;
      if (typeof text === "string") {
        parts.push(text);
      }
    }
  }
  return parts.join("\n");
}

export function isCronResultSurfaceMessage(message: unknown): boolean {
  if (!message || typeof message !== "object") {
    return false;
  }
  const record = message as CronResultSurfaceLike;
  const embedded = record.openclawCronResult;
  if (embedded && typeof embedded === "object") {
    const jobId = (embedded as { jobId?: unknown }).jobId;
    if (typeof jobId === "string" && jobId.trim()) {
      return true;
    }
  }
  const text = extractText(record.content);
  return textLooksLikeCronResultSurface(text);
}

export function omitCronResultSurfaces<T>(messages: readonly T[]): T[] {
  return messages.filter((message) => !isCronResultSurfaceMessage(message));
}
