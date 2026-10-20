import { extractTextCached } from "./message-extract.ts";

export type CronResultMessageMeta = {
  jobId: string;
  runId?: string;
  jobName?: string;
  kind?: "result" | "parked_notice";
  parkReason?: "park" | "reject_park_full";
};

export type CronResultSurfaceSections = {
  title?: string;
  summaryMarkdown: string;
  deliverableMarkdown: string;
  footerMarkdown: string;
};

const CRON_RESULT_MARKERS = ["定时执行结果", "定时任务结果"] as const;
const CRON_JOB_ID_RE = /(?:定时)?任务 ID[：:]\s*`([^`]+)`/;
const CRON_TITLE_RE =
  /(?:\*\*(?:定时执行结果|定时任务结果)\*\*|(?:定时执行结果|定时任务结果))\s*·\s*([^\n*]+)/;
const SECTION_SUMMARY_RE = /^##\s*任务摘要\s*$/im;
const SECTION_DELIVERABLE_RE = /^##\s*任务成果\s*$/im;
const LEGACY_SUMMARY_RE = /^\*\*摘要\*\*\s*$/im;

function hashCronDeliverableText(text: string): string {
  let hash = 5381;
  for (let index = 0; index < text.length; index += 1) {
    hash = (hash * 33) ^ text.charCodeAt(index);
  }
  return (hash >>> 0).toString(36);
}

function timestampToIso(value: unknown): string {
  if (typeof value === "string" && value.trim()) {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString();
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString();
  }
  return new Date().toISOString();
}

function sliceSection(text: string, start: number, end: number): string {
  return text.slice(start, end).trim();
}

function findSectionStart(text: string, pattern: RegExp): number {
  const match = pattern.exec(text);
  if (!match || match.index == null) {
    return -1;
  }
  return match.index + match[0].length;
}

function parseLegacyCronResultSections(text: string): CronResultSurfaceSections | null {
  const titleMatch = CRON_TITLE_RE.exec(text);
  const dividerIndex = text.indexOf("\n---\n");
  const legacySummaryStart = findSectionStart(text, LEGACY_SUMMARY_RE);
  if (legacySummaryStart < 0) {
    return null;
  }
  const bodyEnd = dividerIndex >= 0 ? dividerIndex : text.length;
  const body = sliceSection(text, legacySummaryStart, bodyEnd);
  const footer = dividerIndex >= 0 ? text.slice(dividerIndex + 5).trim() : "";
  return {
    title: titleMatch?.[1]?.trim(),
    summaryMarkdown: body,
    deliverableMarkdown: body,
    footerMarkdown: footer,
  };
}

function textHasCronResultMarker(text: string): boolean {
  return CRON_RESULT_MARKERS.some((marker) => text.includes(marker));
}

export function parseCronResultSurfaceSections(text: string): CronResultSurfaceSections | null {
  const trimmed = text.trim();
  if (!textHasCronResultMarker(trimmed)) {
    return null;
  }
  const titleMatch = CRON_TITLE_RE.exec(trimmed);
  const summaryStart = findSectionStart(trimmed, SECTION_SUMMARY_RE);
  const deliverableStart = findSectionStart(trimmed, SECTION_DELIVERABLE_RE);
  if (summaryStart < 0 || deliverableStart < 0 || deliverableStart <= summaryStart) {
    return parseLegacyCronResultSections(trimmed);
  }
  const dividerIndex = trimmed.indexOf("\n---\n", deliverableStart);
  const deliverableEnd = dividerIndex >= 0 ? dividerIndex : trimmed.length;
  return {
    title: titleMatch?.[1]?.trim(),
    summaryMarkdown: sliceSection(trimmed, summaryStart, deliverableStart),
    deliverableMarkdown: sliceSection(trimmed, deliverableStart, deliverableEnd),
    footerMarkdown: dividerIndex >= 0 ? trimmed.slice(dividerIndex + 5).trim() : "",
  };
}

function readEmbeddedCronResult(message: Record<string, unknown>): CronResultMessageMeta | null {
  const embedded = message.openclawCronResult;
  if (!embedded || typeof embedded !== "object") {
    return null;
  }
  const record = embedded as Record<string, unknown>;
  const jobId = typeof record.jobId === "string" ? record.jobId.trim() : "";
  if (!jobId) {
    return null;
  }
  const kind = record.kind === "parked_notice" ? "parked_notice" : undefined;
  return {
    jobId,
    runId: typeof record.runId === "string" ? record.runId.trim() : undefined,
    jobName: typeof record.jobName === "string" ? record.jobName.trim() : undefined,
    ...(kind ? { kind } : {}),
  };
}

export function readCronResultMessageMeta(message: unknown): CronResultMessageMeta | null {
  if (!message || typeof message !== "object") {
    return null;
  }
  const record = message as Record<string, unknown>;
  const text = extractTextCached(message)?.trim() ?? "";
  const parkedFromText =
    text.includes("[CRON_PARKED_NOTICE]") || text.includes("[CRON_PARK_FULL_NOTICE]");
  const parkReason = text.includes("[CRON_PARK_FULL_NOTICE]")
    ? ("reject_park_full" as const)
    : parkedFromText
      ? ("park" as const)
      : undefined;
  const embedded = readEmbeddedCronResult(record);
  if (embedded) {
    return {
      ...embedded,
      ...(embedded.kind === "parked_notice" || parkedFromText
        ? { kind: "parked_notice" as const, ...(parkReason ? { parkReason } : {}) }
        : {}),
    };
  }

  if (!textHasCronResultMarker(text)) {
    return null;
  }
  const jobIdMatch = CRON_JOB_ID_RE.exec(text);
  if (!jobIdMatch?.[1]) {
    return null;
  }
  const titleMatch = CRON_TITLE_RE.exec(text);
  const parked = text.includes("[CRON_PARKED_NOTICE]") || text.includes("[CRON_PARK_FULL_NOTICE]");
  return {
    jobId: jobIdMatch[1].trim(),
    jobName: titleMatch?.[1]?.trim(),
    ...(parked
      ? {
          kind: "parked_notice" as const,
          parkReason: text.includes("[CRON_PARK_FULL_NOTICE]")
            ? ("reject_park_full" as const)
            : ("park" as const),
        }
      : {}),
  };
}

export function isCronResultMessage(message: unknown): boolean {
  return readCronResultMessageMeta(message) !== null;
}

export function isCronParkedNoticeMessage(message: unknown): boolean {
  const meta = readCronResultMessageMeta(message);
  if (!meta) {
    return false;
  }
  if (meta.kind === "parked_notice") {
    return true;
  }
  const text = extractTextCached(message) ?? "";
  return text.includes("[CRON_PARKED_NOTICE]") || text.includes("[CRON_PARK_FULL_NOTICE]");
}

/**
 * Display/artifact helper: find the latest cron result card before a user turn.
 * Do not use this to stamp `chat.send` provenance — composer send is explicit-only
 * (`chatCronReplyContext` or an explicit “追问这个结果” action). See EA-B1 / EA-B4.
 */
export function resolveImplicitCronReplyContext(messages: unknown[]): CronResultMessageMeta | null {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (!message || typeof message !== "object") {
      continue;
    }
    const record = message as Record<string, unknown>;
    const role = typeof record.role === "string" ? record.role.toLowerCase() : "";
    if (role === "user") {
      return null;
    }
    const meta = readCronResultMessageMeta(message);
    if (meta) {
      return meta;
    }
  }
  return null;
}

export function resolveCronResultArtifactRecord(message: unknown): Record<string, unknown> | null {
  const meta = readCronResultMessageMeta(message);
  if (!meta || !message || typeof message !== "object" || isCronParkedNoticeMessage(message)) {
    return null;
  }
  const record = message as Record<string, unknown>;
  const text = extractTextCached(message)?.trim() ?? "";
  const sections = parseCronResultSurfaceSections(text);
  const deliverable = sections?.deliverableMarkdown?.trim() || text;
  if (!deliverable) {
    return null;
  }
  const title = `${meta.jobName?.trim() || "定时任务"} · 本次执行成果`;
  const createdAt = timestampToIso(record.timestamp);
  const artifactId = `cron-result:${meta.jobId}:${hashCronDeliverableText(deliverable)}`;
  return {
    artifactId,
    artifactType: "report",
    storageClass: "inline-media",
    title,
    mimeType: "text/markdown",
    provider: "cron-result",
    createdAt,
    updatedAt: createdAt,
    lifecycleState: "shared",
    sourceMessage: deliverable,
    providerMetadata: {
      previewText: deliverable,
      cronJobId: meta.jobId,
      ...(meta.runId ? { cronRunId: meta.runId } : {}),
    },
  };
}
