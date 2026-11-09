import path from "node:path";
import { isEnterpriseDataKnowledgeTurn } from "./enterprise-data-intent.js";

const PROJECT_DATA_MARKERS =
  /(?:项目风险|风险清单|本周项目|portfolio|project\s+risk|risk\s+register)/iu;

const DIRECTORY_DATA_MARKERS =
  /(?:机器人列表|有哪些机器人|bot\s+list|directory\.bots|协作组机器人)/iu;

const SCHEDULE_DATA_MARKERS = /(?:提醒|cron|日程|会议邀请|schedule|reminder|recurring)/iu;

const MEMORY_DATA_MARKERS = /(?:记忆|memory_search|历史对话|上次|continue\s+above|继续上面)/iu;

export type TaskDataPreflightGap =
  | "project_kb"
  | "bot_directory"
  | "schedule_cron"
  | "memory_history"
  | "enterprise_feed";

export function detectTaskDataPreflightGaps(text: string): TaskDataPreflightGap[] {
  const normalized = text.trim();
  if (!normalized) {
    return [];
  }
  const gaps: TaskDataPreflightGap[] = [];
  if (PROJECT_DATA_MARKERS.test(normalized)) {
    gaps.push("project_kb");
  }
  if (DIRECTORY_DATA_MARKERS.test(normalized)) {
    gaps.push("bot_directory");
  }
  if (SCHEDULE_DATA_MARKERS.test(normalized)) {
    gaps.push("schedule_cron");
  }
  if (MEMORY_DATA_MARKERS.test(normalized)) {
    gaps.push("memory_history");
  }
  if (isEnterpriseDataKnowledgeTurn(normalized)) {
    gaps.push("enterprise_feed");
  }
  return gaps;
}

const GAP_GUIDANCE: Record<TaskDataPreflightGap, string> = {
  project_kb:
    "verify project/KB sources via tools before listing risks; if empty, say what is missing and where to add it",
  bot_directory:
    "call collaboration.directory.bots.list (tenant context required) before naming robots; never fabricate a roster",
  schedule_cron:
    "confirm user timezone and existing cron/schedule entries before proposing times; show local time, not UTC-only",
  memory_history:
    "run memory_search / read recent transcript before claiming prior work is missing; cite what was found or not found",
  enterprise_feed:
    "answer 用友 T+ warehouse and inventory from Knowledge Universe feed objects already in context (titles such as 001-用友T+仓库 / 001-用友T+存货). If they are not in context, call knowledge_search then knowledge_get with the native tool channel and cite the object title plus the excerpt rows. The summary excerpt is only a preview; pass knowledge_get offset to page later materialized rows. Do not tell the user to click 立即物化 when the excerpt is short or the default product looks stale — connect and the gateway sync schedule refresh those feeds. A missing seat grant is the authorization gate. Do not call browser, do not open 云电脑, and do not use data_capability action=invoke (it is knowledge-object-only and returns no connector rows).",
};

/**
 * Read-only preflight for data-dependent long tasks. Injected when activation
 * patterns or steward intents need real backing data — blocks empty templates.
 */
export function buildTaskDataPreflightPrompt(text: string): string | undefined {
  const gaps = detectTaskDataPreflightGaps(text);
  if (gaps.length === 0) {
    return undefined;
  }
  const lines = gaps.map((gap) => `- ${GAP_GUIDANCE[gap]}`);
  return [
    "Task data preflight (mandatory before replying):",
    ...lines,
    "If required data is unavailable after tool checks, state the gap and next user action — do not emit an empty framework or placeholder list.",
  ].join("\n");
}

/** Basename-only archive pointer for session reset continuity prompts. */
export function formatArchivedTranscriptPointer(archivedPath: string): string {
  return path.basename(archivedPath);
}
