/**
 * Batch 8 cron / scheduled-skill completion.
 *
 * No summary and no artifact must not be stored or shown as success.
 * The user-visible kind is failed, empty, or needs_attention, plus one line.
 * empty and needs_attention use a sentinel error so the scheduler does not
 * treat them as a transport failure (no backoff, no failure page). They are
 * still not status ok.
 */
import type { CronCompletionKind, CronRunStatus } from "./types.js";

export const CRON_COMPLETION_KINDS = ["ok", "failed", "empty", "needs_attention"] as const;
export type { CronCompletionKind };

export const CRON_COMPLETION_EMPTY_PREFIX = "cron_completion:empty";
export const CRON_COMPLETION_ATTENTION_PREFIX = "cron_completion:needs_attention";

const EMPTY_SUMMARY_RE =
  /^(?:任务已完成[，,]?\s*)?但未生成可展示的摘要[。.]?$|^这次定时运行已经结束[。.]?$/u;

const ARTIFACT_RE =
  /(?:^|[\s`'"(])(?:deliverables|output|memory\/deliverables)\/[^\s`'")]+\.(?:pdf|pptx|html|htm|md|txt|docx|png|csv)\b|\.(?:pdf|pptx|html|htm|docx)\b/iu;

export type CronCompletionInput = {
  status: CronRunStatus;
  summary?: string;
  outputText?: string;
  error?: string;
  jobName?: string;
  hasArtifact?: boolean;
};

export type CronCompletionContract = {
  completion: CronCompletionKind;
  status: CronRunStatus;
  error?: string;
  userReason: string;
};

export function isCronCompletionScheduleHold(error?: string): boolean {
  const text = error?.trim() ?? "";
  return (
    text.startsWith(CRON_COMPLETION_EMPTY_PREFIX) ||
    text.startsWith(CRON_COMPLETION_ATTENTION_PREFIX)
  );
}

export function cronUserReasonFromError(error?: string): string | undefined {
  const text = error?.trim() ?? "";
  if (text.startsWith(CRON_COMPLETION_EMPTY_PREFIX)) {
    return text.slice(CRON_COMPLETION_EMPTY_PREFIX.length).trim();
  }
  if (text.startsWith(CRON_COMPLETION_ATTENTION_PREFIX)) {
    return text.slice(CRON_COMPLETION_ATTENTION_PREFIX.length).trim();
  }
  return undefined;
}

function oneLine(text: string): string {
  const line = text.replace(/\s+/g, " ").trim();
  return line.length > 180 ? `${line.slice(0, 180).trim()}…` : line;
}

function realSummary(text: string | undefined): string | undefined {
  const trimmed = text?.trim() ?? "";
  if (!trimmed || EMPTY_SUMMARY_RE.test(trimmed)) {
    return undefined;
  }
  return trimmed;
}

function looksLikeArtifact(text: string | undefined): boolean {
  const trimmed = text?.trim() ?? "";
  if (!trimmed || /task_ledger\.json/i.test(trimmed)) {
    return false;
  }
  return ARTIFACT_RE.test(trimmed);
}

function reasonLine(kind: Exclude<CronCompletionKind, "ok">, jobName: string | undefined): string {
  const who = jobName?.trim() ? `${jobName.trim()}：` : "";
  if (kind === "empty") {
    return `${who}没有摘要，也没有产物，不能记为成功。`;
  }
  if (kind === "needs_attention") {
    return `${who}只有空的完成声称，没有产物，需要处理。`;
  }
  return `${who}定时任务失败，没有可展示的摘要或产物。`;
}

export function classifyCronCompletion(input: CronCompletionInput): CronCompletionContract {
  const held = cronUserReasonFromError(input.error);
  if (input.error?.trim().startsWith(CRON_COMPLETION_EMPTY_PREFIX)) {
    return {
      completion: "empty",
      status: "error",
      error: input.error,
      userReason: held || reasonLine("empty", input.jobName),
    };
  }
  if (input.error?.trim().startsWith(CRON_COMPLETION_ATTENTION_PREFIX)) {
    return {
      completion: "needs_attention",
      status: "error",
      error: input.error,
      userReason: held || reasonLine("needs_attention", input.jobName),
    };
  }
  if (input.status === "skipped") {
    return { completion: "ok", status: "skipped", userReason: "" };
  }

  const summary = realSummary(input.summary) ?? realSummary(input.outputText);
  const artifact =
    input.hasArtifact === true ||
    looksLikeArtifact(input.summary) ||
    looksLikeArtifact(input.outputText);
  if (summary || artifact) {
    if (input.status === "error") {
      const userReason = oneLine(input.error?.trim() || reasonLine("failed", input.jobName));
      return {
        completion: "failed",
        status: "error",
        error: input.error,
        userReason,
      };
    }
    return { completion: "ok", status: "ok", userReason: "" };
  }

  const claimed =
    Boolean(input.summary?.trim()) || Boolean(input.outputText?.trim()) || input.status === "error";
  const kind: Exclude<CronCompletionKind, "ok"> =
    input.status === "error" || input.error?.trim()
      ? "failed"
      : claimed
        ? "needs_attention"
        : "empty";
  const userReason =
    kind === "failed"
      ? oneLine(input.error?.trim() || reasonLine("failed", input.jobName))
      : reasonLine(kind, input.jobName);
  const prefix =
    kind === "empty"
      ? CRON_COMPLETION_EMPTY_PREFIX
      : kind === "needs_attention"
        ? CRON_COMPLETION_ATTENTION_PREFIX
        : "";
  return {
    completion: kind,
    status: "error",
    error: prefix ? `${prefix} ${userReason}` : input.error?.trim() || userReason,
    userReason,
  };
}
