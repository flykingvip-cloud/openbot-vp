/**
 * User-message focus switch (EA-B1). Decision logic is pure.
 * Session-file helpers are read-only and never write Task / Ledger / chat.
 */

import fs from "node:fs";
import { type PreserveArticleOptions } from "./preserve-article-across-cut.js";
import { qualifyTurn } from "./qualification.js";
import { isSureDistinctWork } from "./session-task-board.js";

export type { PreserveArticleOptions } from "./preserve-article-across-cut.js";

const CURRENT_WORK_DEIXIS =
  /当前(?:你做的)?(?:这个|这份)?工作|刚才(?:在做的)?(?:这个|这份|那个|那份|那篇)(?:工作)?|正在做的|当前焦点|把当前(?:的)?(?:这个|工作)/u;

const NEW_TASK_MARKERS =
  /请使用\s*[\w-]+|做一次.{0,12}(调研|研究|分析|检查)|另外[帮再]|现在改做|新任务|先放下|换[一个题]|不要做刚才|调研问题[:：]|任务目标[:：]|生成今日/u;

const SYNTHETIC_USER_TURN =
  /^(?:来自\s+\S+（1:1 会话|\[数字人回复\]|\[诊断交接\]|\[任务发出\]|\[任务返回\]|\[任务接收\]|\[HEARTBEAT_PARKED_NOTICE\]|\[PARKED_TASK_REMINDER\]|\[CRON_PARKED)/u;

const BARE_A2A_OPENER = /^我先(?:查|读|看|确认|检查).{0,16}(?:记忆|当前工作区|工作区|长文)/u;

const INJECTED_DELIVERABLE = /^「[\s\S]{0,80}(?:\*{0,2}\d+\s*字总结|\*{0,2}100\s*字)/u;

const HEADERLESS_A2A_REPLY = /^(?:已完成核对|以下是「|#\s*技能来源基线清单)/u;

const FORCE_HANDOFF_REQUEST = /请不要先问我|conversation_send|直接.{0,12}交接给|交接给\s*\S+/u;

const GOAL_LIKE = /阅读|输出|总结|清单|调研|生成|请使用|任务目标|验收|完成|交接/u;

export const GOAL_OVERLAP_THRESHOLD = 0.22;

const GOAL_IDENTITY_NOISE = new Set([
  "skill",
  "skill孵化",
  "conversation_send",
  "bot-skill",
  "openbot",
  "openclaw",
  "daibai",
]);

const INBOUND_STAMP_RE = /^\[[A-Za-z]{3} \d{4}-\d{2}-\d{2} [0-9:]{4,8} GMT[+-]\d+\]\s*/;

export {
  applyFocusSwitchGate,
  evaluateFocusSwitch,
  readFocusSwitchDecisionCount,
  recordFocusSwitchDecision,
  resetFocusSwitchDecisionCountsForTest,
} from "./session-task-board.js";
export type {
  FocusGateDecisionCode,
  FocusSwitchDecision,
  FocusSwitchGateDecision,
} from "./session-task-board.js";

function extractText(content: unknown): string {
  if (typeof content === "string") {
    return content;
  }
  if (!Array.isArray(content)) {
    return "";
  }
  return content
    .map((block) => {
      if (!block || typeof block !== "object" || !("text" in block)) {
        return "";
      }
      const text = (block as { text?: unknown }).text;
      return typeof text === "string" ? text : "";
    })
    .join("\n");
}

export function readUserTurnTextsFromTranscript(text: string): string[] {
  const turns: string[] = [];
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) {
      continue;
    }
    try {
      const parsed = JSON.parse(line) as {
        message?: { role?: unknown; content?: unknown };
        role?: unknown;
        content?: unknown;
      };
      const role = parsed.message?.role ?? parsed.role;
      if (role !== "user") {
        continue;
      }
      const body = stripInboundStamp(extractText(parsed.message?.content ?? parsed.content));
      if (body) {
        turns.push(body);
      }
    } catch {
      // Ignore malformed transcript lines.
    }
  }
  return turns;
}

export function readLastUserTextFromTranscript(text: string): string | undefined {
  const turns = readUserTurnTextsFromTranscript(text);
  return turns.at(-1);
}

export function isSyntheticUserTurn(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) {
    return true;
  }
  if (SYNTHETIC_USER_TURN.test(trimmed)) {
    return true;
  }
  if (trimmed.includes("（1:1 会话") || trimmed.includes("对象会话：")) {
    return true;
  }
  if (
    BARE_A2A_OPENER.test(trimmed) ||
    INJECTED_DELIVERABLE.test(trimmed) ||
    HEADERLESS_A2A_REPLY.test(trimmed)
  ) {
    return true;
  }
  return false;
}

export function isForceHandoffRequest(text: string): boolean {
  return FORCE_HANDOFF_REQUEST.test(stripInboundStamp(text));
}

export function shouldPeelCurrentInbound(text: string): boolean {
  const trimmed = stripInboundStamp(text);
  if (!trimmed) {
    return false;
  }
  if (isSyntheticUserTurn(trimmed)) {
    return true;
  }
  if (isCurrentWorkDeixis(trimmed) && !isLikelyNewTask(trimmed)) {
    return true;
  }
  return isForceHandoffRequest(trimmed);
}

/** Drop「不要做X / 不要输出X」so a rejection cannot look like the rejected goal. */
export function stripNegatedSpans(text: string): string {
  return stripInboundStamp(text)
    .replace(/请不要先问我[。.]?/g, " ")
    .replace(/不要做刚才的?[^。；;\n]*/g, " ")
    .replace(/别做刚才的?[^。；;\n]*/g, " ")
    .replace(/不要输出[^。；;\n]*/g, " ")
    .replace(/不要生成[^。；;\n]*/g, " ")
    .replace(/不要做[^。；;\n]*/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function incomingRejectsFocus(incoming: string, currentFocus: string): boolean {
  const matches = stripInboundStamp(incoming).matchAll(
    /(?:不要(?:做刚才的?|做|输出|生成)|别做刚才的?)([^。；;\n]*)/g,
  );
  for (const match of matches) {
    const rejected = `${match[0]} ${match[1] ?? ""}`.trim();
    if (
      tokenOverlapRatio(rejected, currentFocus, { keepNegation: true }) >= GOAL_OVERLAP_THRESHOLD
    ) {
      return true;
    }
  }
  return false;
}

export function stripInboundStamp(text: string): string {
  return text.replace(INBOUND_STAMP_RE, "").trim();
}

export function isCurrentWorkDeixis(text: string): boolean {
  return CURRENT_WORK_DEIXIS.test(stripInboundStamp(text));
}

export function isSessionGoalLike(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) {
    return false;
  }
  if (isLikelyNewTask(trimmed)) {
    return true;
  }
  return trimmed.length >= 12 && GOAL_LIKE.test(trimmed);
}

/** Last owner task after park fences; skips A2A / inject impersonation. */
export function readLastFocusTextFromTranscript(text: string): string | undefined {
  const turns = readUserTurnTextsFromTranscript(text);
  let start = 0;
  for (let i = 0; i < turns.length; i++) {
    if (hasFocusParkFence(turns[i] ?? "")) {
      start = i;
    }
  }
  const window = turns
    .slice(start)
    .map((turn) => stripFocusParkFence(turn).trim())
    .filter((turn) => turn && !isSyntheticUserTurn(turn));
  let lastGoal: string | undefined;
  for (const turn of window) {
    if (isCurrentWorkDeixis(turn) && !isLikelyNewTask(turn)) {
      continue;
    }
    if (isForceHandoffRequest(turn)) {
      continue;
    }
    if (isLikelyNewTask(turn) || isSessionGoalLike(turn)) {
      lastGoal = turn;
    }
  }
  return lastGoal ?? window.at(-1);
}

function readSessionFileTail(sessionFile: string): string {
  const stat = fs.statSync(sessionFile);
  const maxBytes = 256_000;
  const start = Math.max(0, stat.size - maxBytes);
  const buf = Buffer.alloc(stat.size - start);
  const fd = fs.openSync(sessionFile, "r");
  try {
    fs.readSync(fd, buf, 0, buf.length, start);
  } finally {
    fs.closeSync(fd);
  }
  return buf.toString("utf8");
}

export function readLastUserTextFromSessionFile(sessionFile: string): string | undefined {
  return readLastUserTextFromTranscript(readSessionFileTail(sessionFile));
}

export function readLastFocusTextFromSessionFile(sessionFile: string): string | undefined {
  return readLastFocusTextFromTranscript(readSessionFileTail(sessionFile));
}

const DECORATIVE_TITLE_LINE = /^(?:[「」『』【】（）()[\]"'“”‘’*#\-_—…·`\s])+$/u;

function normalizeTitleLine(line: string): string {
  return line
    .replace(/^#+\s*/, "")
    .replace(/^\*+\s*|\s*\*+$/g, "")
    .replace(/^[「『【]\s*|\s*[」』】]$/g, "")
    .trim();
}

export function titleFromTaskText(text: string): string {
  const cleaned = stripInboundStamp(text);
  const first = cleaned
    .split(/\r?\n/)
    .map((line) => normalizeTitleLine(line))
    .find(
      (line) =>
        line &&
        !line.startsWith("[") &&
        !DECORATIVE_TITLE_LINE.test(line) &&
        !line.startsWith("任务目标"),
    );
  const compact = (first ?? normalizeTitleLine(cleaned.replace(/\s+/g, " ")))
    .replace(/\s+/g, " ")
    .trim();
  return compact.length > 36 ? `${compact.slice(0, 36)}…` : compact;
}

export function tokenOverlapRatio(
  left: string,
  right: string,
  opts?: { keepNegation?: boolean },
): number {
  const tokenize = (value: string): Set<string> => {
    const tokens = new Set<string>();
    const cleaned = opts?.keepNegation ? stripInboundStamp(value) : stripNegatedSpans(value);
    for (const run of cleaned.match(/[\u4e00-\u9fff]+/g) ?? []) {
      if (run.length === 1) {
        continue;
      }
      for (let i = 0; i < run.length - 1; i++) {
        tokens.add(run.slice(i, i + 2));
      }
    }
    for (const match of cleaned.matchAll(/[a-zA-Z][a-zA-Z0-9_-]{2,}/g)) {
      const token = match[0].toLowerCase();
      if (!GOAL_IDENTITY_NOISE.has(token)) {
        tokens.add(token);
      }
    }
    return tokens;
  };
  const a = tokenize(left);
  const b = tokenize(right);
  if (a.size === 0 || b.size === 0) {
    return 0;
  }
  let hits = 0;
  for (const token of a) {
    if (b.has(token)) {
      hits += 1;
    }
  }
  return hits / Math.min(a.size, b.size);
}

export function isLikelyContinuation(incoming: string, currentFocus: string): boolean {
  const trimmed = incoming.trim();
  if (!trimmed || !currentFocus.trim()) {
    return true;
  }
  return !isSureDistinctWork(trimmed, currentFocus);
}

export function isLikelyNewTask(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) {
    return false;
  }
  if (NEW_TASK_MARKERS.test(trimmed)) {
    return true;
  }
  const kind = qualifyTurn({ messageId: "focus-switch", text: trimmed }).kind;
  return kind === "long_running_candidate" || kind === "scheduled_action";
}

/** Transcript marker: previous turns are parked (EA-B6 / §5.3). UI must strip this. */
export const FOCUS_PARKED_SENTINEL = "[FOCUS_PARKED]";
export const FOCUS_PARKED_AGENT_NOTE =
  "上一任务已暂停。不要继续未完成的步骤。当前这句话可以指向上一轮已经声明的成果。只用用户这句话的语言回复。";

/** Transcript marker: user consented to cancel the previous focus. UI must strip this. */
export const FOCUS_CANCELLED_SENTINEL = "[FOCUS_CANCELLED]";
export const FOCUS_CANCELLED_AGENT_NOTE =
  "上一任务已取消。不要继续未完成的步骤。当前这句话可以指向上一轮已经声明的成果。只用用户这句话的语言回复。";

export type FocusSwitchFenceKind = "park" | "cancel";

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function hasFocusParkFence(text: string): boolean {
  return text.includes(FOCUS_PARKED_SENTINEL) || text.includes(FOCUS_CANCELLED_SENTINEL);
}

export function applyFocusSwitchFence(
  text: string,
  kind: FocusSwitchFenceKind,
  opts?: { agentNote?: boolean },
): string {
  const trimmed = text.trim();
  if (!trimmed || hasFocusParkFence(trimmed)) {
    return trimmed;
  }
  const sentinel = kind === "cancel" ? FOCUS_CANCELLED_SENTINEL : FOCUS_PARKED_SENTINEL;
  const note = kind === "cancel" ? FOCUS_CANCELLED_AGENT_NOTE : FOCUS_PARKED_AGENT_NOTE;
  if (opts?.agentNote) {
    return `${sentinel}\n${note}\n\n${trimmed}`;
  }
  return `${sentinel}\n${trimmed}`;
}

export function applyFocusParkFence(text: string, opts?: { agentNote?: boolean }): string {
  return applyFocusSwitchFence(text, "park", opts);
}

export function applyFocusCancelFence(text: string, opts?: { agentNote?: boolean }): string {
  return applyFocusSwitchFence(text, "cancel", opts);
}

export function stripFocusParkFence(text: string): string {
  if (!text || !hasFocusParkFence(text)) {
    return text;
  }
  return text
    .replace(new RegExp(`^\\s*${escapeRegExp(FOCUS_PARKED_SENTINEL)}\\s*\\n?`), "")
    .replace(new RegExp(`^\\s*${escapeRegExp(FOCUS_CANCELLED_SENTINEL)}\\s*\\n?`), "")
    .replace(new RegExp(`^\\s*${escapeRegExp(FOCUS_PARKED_AGENT_NOTE)}\\s*\\n*`), "")
    .replace(new RegExp(`^\\s*${escapeRegExp(FOCUS_CANCELLED_AGENT_NOTE)}\\s*\\n*`), "")
    .trimStart();
}

export {
  isTaskStatusSeparatorMessage,
  omitTaskStatusSeparators,
  transcriptEntriesForInboundTurn,
  omitParkedPriorTurns,
} from "../agent-runtime/context/sources/task-history.js";
