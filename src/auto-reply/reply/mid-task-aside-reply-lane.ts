/**
 * Mid-task reply_lane: timely ordinary-aside answers while task A stays active.
 *
 * Reuses the embedded runner with disableTools on an ephemeral session so we do
 * not contend for A's session write lock / ACTIVE_EMBEDDED_RUNS slot, do not
 * write the task board, and do not become a second task controller.
 *
 * Dialogue continuity: Q&A is persisted to a durable aside-dialogue sidecar
 * (not A's agent jsonl). Follow-ups / refresh read that log + full active
 * constraints. Cancel uses a prepare→run→end signal so abort cannot drop the
 * registration and let a late start deliver.
 */
import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { resolveAgentDir, resolveAgentIdFromSessionKey } from "../../agents/agent-scope.js";
import { abortEmbeddedPiRun, runEmbeddedPiAgent } from "../../agents/pi-embedded.js";
import type { OpenBotConfig } from "../../config/config.js";
import {
  activeConstraintTexts,
  formatTaskBoardFocusLine,
  readSessionTaskBoard,
  type SessionTaskBoard,
} from "../../conversation-task/session-task-board.js";
import { stripInboundStampForDialogue } from "./mid-task-dialogue.js";
import { readSessionMessages } from "./session-continuity.js";

export type AsideReplyLaneIsolation = {
  parentSessionId: string;
  asideSessionId: string;
  parentSessionFile: string;
  asideSessionFile: string;
  disableTools: true;
  boardTouched: false;
};

export type AsideReplyLaneResult = {
  ok: boolean;
  text: string;
  runId: string;
  isolation: AsideReplyLaneIsolation;
  cancelled?: boolean;
};

type AsideRunHandle = {
  sessionId: string;
  provider: string;
  model: string;
  workspaceDir: string;
  config: OpenBotConfig;
  agentDir?: string;
  sessionKey?: string;
  timeoutMs?: number;
  thinkLevel?: string;
};

type AsideLaneState = {
  cancelled: boolean;
};

/** parentSessionId → asideSessionId → cancel signal (survives prepare/run/end). */
const ASIDE_LANES_BY_PARENT = new Map<string, Map<string, AsideLaneState>>();

export function asideDialogueLogPath(parentSessionFile: string): string {
  return `${parentSessionFile.trim()}.aside-dialogue.jsonl`;
}

export type AsideDialogueTurn = {
  atMs: number;
  runId: string;
  role: "user" | "assistant";
  text: string;
};

/** Append one durable aside turn (not A's agent jsonl; not the task board). */
export function appendAsideDialogueTurn(parentSessionFile: string, turn: AsideDialogueTurn): void {
  const file = parentSessionFile.trim();
  if (!file || !turn.text.trim()) {
    return;
  }
  const line = `${JSON.stringify({
    atMs: turn.atMs,
    runId: turn.runId,
    role: turn.role,
    text: turn.text.trim(),
  })}\n`;
  fs.appendFileSync(asideDialogueLogPath(file), line, "utf8");
}

/** Read durable aside Q&A for refresh / reconnect / follow-up recovery. */
export function readAsideDialogueTurns(parentSessionFile: string): AsideDialogueTurn[] {
  const file = parentSessionFile.trim();
  if (!file) {
    return [];
  }
  const logPath = asideDialogueLogPath(file);
  if (!fs.existsSync(logPath)) {
    return [];
  }
  const turns: AsideDialogueTurn[] = [];
  for (const line of fs.readFileSync(logPath, "utf8").split("\n")) {
    if (!line.trim()) {
      continue;
    }
    try {
      const row = JSON.parse(line) as Partial<AsideDialogueTurn>;
      if (
        (row.role === "user" || row.role === "assistant") &&
        typeof row.text === "string" &&
        row.text.trim()
      ) {
        turns.push({
          atMs: typeof row.atMs === "number" ? row.atMs : 0,
          runId: typeof row.runId === "string" ? row.runId : "",
          role: row.role,
          text: row.text.trim(),
        });
      }
    } catch {
      // skip malformed
    }
  }
  return turns;
}

export function registerMidTaskAsideLane(parentSessionId: string, asideSessionId: string): void {
  const parent = parentSessionId.trim();
  const aside = asideSessionId.trim();
  if (!parent || !aside) {
    return;
  }
  let map = ASIDE_LANES_BY_PARENT.get(parent);
  if (!map) {
    map = new Map();
    ASIDE_LANES_BY_PARENT.set(parent, map);
  }
  const existing = map.get(aside);
  if (existing) {
    // Keep cancelled=true if abort already raced ahead of register.
    return;
  }
  map.set(aside, { cancelled: false });
}

/**
 * Mark cancelled *without* dropping the registration. Abort embedded if already
 * registered with ACTIVE_EMBEDDED_RUNS; late starts must observe cancelled.
 */
export function abortMidTaskAsideLanes(parentSessionId: string): string[] {
  const parent = parentSessionId.trim();
  const map = ASIDE_LANES_BY_PARENT.get(parent);
  if (!map || map.size === 0) {
    return [];
  }
  const aborted: string[] = [];
  for (const [asideId, state] of map) {
    state.cancelled = true;
    try {
      if (abortEmbeddedPiRun(asideId)) {
        aborted.push(asideId);
      } else {
        // Not yet in ACTIVE_EMBEDDED_RUNS — signal still blocks start/delivery.
        aborted.push(asideId);
      }
    } catch {
      aborted.push(asideId);
    }
  }
  return aborted;
}

export function isMidTaskAsideLaneCancelled(
  parentSessionId: string,
  asideSessionId: string,
): boolean {
  const state = ASIDE_LANES_BY_PARENT.get(parentSessionId.trim())?.get(asideSessionId.trim());
  return state?.cancelled === true;
}

export function unregisterMidTaskAsideLane(parentSessionId: string, asideSessionId: string): void {
  const parent = parentSessionId.trim();
  const map = ASIDE_LANES_BY_PARENT.get(parent);
  if (!map) {
    return;
  }
  map.delete(asideSessionId.trim());
  if (map.size === 0) {
    ASIDE_LANES_BY_PARENT.delete(parent);
  }
}

/** Test helper — clear registry between cases. */
export function resetMidTaskAsideLaneRegistryForTests(): void {
  ASIDE_LANES_BY_PARENT.clear();
}

export function listMidTaskAsideLanesForTests(parentSessionId: string): string[] {
  return [...(ASIDE_LANES_BY_PARENT.get(parentSessionId.trim())?.keys() ?? [])];
}

function truncateDisplay(text: string, max: number): string {
  const cleaned = text.replace(/\s+/g, " ").trim();
  if (cleaned.length <= max) {
    return cleaned;
  }
  return `${cleaned.slice(0, max)}…`;
}

/**
 * Build related history for the aside prompt: durable aside log first, then
 * recent parent-session user/assistant lines (read-only). Never mutates either.
 */
export async function loadAsideReplyContextHistory(params: {
  parentSessionFile: string;
  limit?: number;
}): Promise<AsideDialogueTurn[]> {
  const limit = Math.max(2, Math.min(params.limit ?? 12, 24));
  const fromLog = readAsideDialogueTurns(params.parentSessionFile);
  if (fromLog.length >= limit) {
    return fromLog.slice(-limit);
  }
  const needed = limit - fromLog.length;
  let fromParent: AsideDialogueTurn[] = [];
  try {
    const messages = await readSessionMessages(params.parentSessionFile);
    fromParent = messages.slice(-needed).map((m) => ({
      atMs: 0,
      runId: "",
      role: m.role === "assistant" ? "assistant" : "user",
      text: m.text,
    }));
  } catch {
    fromParent = [];
  }
  // Prefer durable aside log for overlap; prepend older parent turns.
  return [...fromParent, ...fromLog].slice(-limit);
}

/**
 * Read-only board projection + full active constraints + related history.
 * Truncation is display-only for goal/stop; constraints stay complete.
 */
export function buildAsideReplyLanePrompt(params: {
  board: SessionTaskBoard;
  userPrompt: string;
  history?: AsideDialogueTurn[];
}): string {
  const cleaned = stripInboundStampForDialogue(params.userPrompt);
  const focus = formatTaskBoardFocusLine(params.board);
  const current = params.board.current;
  const goal = current?.goalText?.trim() || current?.title || "（无）";
  const constraints = current ? activeConstraintTexts(current) : [];
  const constraintBlock =
    constraints.length === 0
      ? "（尚无已登记有效约束）"
      : constraints.map((row, i) => `${i + 1}. ${row}`).join("\n");
  const stop = current?.stop?.summary?.trim() || "（无）";
  const history = params.history ?? [];
  const historyBlock =
    history.length === 0
      ? "（无近期旁路对话）"
      : history.map((turn) => `${turn.role === "user" ? "主人" : "助手"}：${turn.text}`).join("\n");

  return [
    "【旁路插问 — 只读回答】后台长任务仍在执行。请直接回答主人的插问。",
    "禁止：继续/推进/改写该任务、调用工具、修改任务板或工作区、把插问写成新任务目标。",
    `任务板只读投影：${focus}。`,
    `目标：${truncateDisplay(goal, 240)}`,
    `有效约束（完整）：\n${constraintBlock}`,
    `停点摘要：${truncateDisplay(stop, 160)}`,
    `相关对话（可恢复，含刷新前旁路问答）：\n${historyBlock}`,
    "",
    `主人插问：${cleaned}`,
  ].join("\n");
}

export function assertAsideReplyLaneIsolation(params: {
  parentSessionId: string;
  asideSessionId: string;
  parentSessionFile: string;
  asideSessionFile: string;
  disableTools: boolean;
}): AsideReplyLaneIsolation {
  if (!params.parentSessionId.trim() || !params.asideSessionId.trim()) {
    throw new Error("aside reply_lane requires parent and aside session ids");
  }
  if (params.parentSessionId === params.asideSessionId) {
    throw new Error("aside reply_lane must use a distinct sessionId from the active task");
  }
  if (!params.parentSessionFile.trim() || !params.asideSessionFile.trim()) {
    throw new Error("aside reply_lane requires parent and aside session files");
  }
  if (path.resolve(params.parentSessionFile) === path.resolve(params.asideSessionFile)) {
    throw new Error(
      "aside reply_lane must use a distinct sessionFile (session write-lock isolation)",
    );
  }
  if (!params.disableTools) {
    throw new Error("aside reply_lane requires disableTools: true (no workspace/task writes)");
  }
  return {
    parentSessionId: params.parentSessionId,
    asideSessionId: params.asideSessionId,
    parentSessionFile: params.parentSessionFile,
    asideSessionFile: params.asideSessionFile,
    disableTools: true,
    boardTouched: false,
  };
}

function extractAssistantText(
  payloads: Array<{ text?: string; isError?: boolean }> | undefined,
): string {
  if (!payloads?.length) {
    return "";
  }
  return payloads
    .map((p) => (typeof p.text === "string" ? p.text.trim() : ""))
    .filter(Boolean)
    .join("\n\n")
    .trim();
}

export type RunMidTaskAsideReplyLaneParams = {
  parentSessionId: string;
  parentSessionFile: string;
  board: SessionTaskBoard;
  userPrompt: string;
  run: AsideRunHandle;
  /** Gateway / chat.send run identity for B — must not reuse A's buffered chatRunId ownership. */
  runId: string;
  /** Injectable for tests. */
  runEmbedded?: typeof runEmbeddedPiAgent;
};

function ownerStopBlocksAside(parentSessionFile: string): boolean {
  try {
    const live = readSessionTaskBoard(parentSessionFile);
    // Owner pause sets wakeSuppress. Task completion must NOT block delivering B.
    return live.current?.wakeSuppress === true;
  } catch {
    return false;
  }
}

const CANCELLED_TEXT = "主人已暂停或取消当前任务；这次插问未再启动或交付。任务板未被插问改写。";
const FAIL_TEXT =
  "后台任务仍在执行；这次插问未能即时生成回答。未改动任务板，也未把插问排进任务续跑队列。请稍后重试，或先暂停任务后再问。";

/**
 * Execute a tools-disabled embedded turn on an ephemeral session.
 * Does not mutate the parent task board. Caller must deliver under `runId`.
 * Board epoch may change while B runs (A progress) — that is NOT a B failure.
 */
export async function runMidTaskAsideReplyLane(
  params: RunMidTaskAsideReplyLaneParams,
): Promise<AsideReplyLaneResult> {
  const parentSessionId = params.parentSessionId.trim();
  const parentSessionFile = params.parentSessionFile.trim();
  const asideSessionId = `aside-reply-${params.runId}`;
  const runEmbedded = params.runEmbedded ?? runEmbeddedPiAgent;
  const cleanedPrompt = stripInboundStampForDialogue(params.userPrompt);

  const tmpRoot = await fsp.mkdtemp(path.join(os.tmpdir(), "openbot-aside-reply-"));
  const asideSessionFile = path.join(tmpRoot, "session.jsonl");
  await fsp.writeFile(asideSessionFile, "", "utf8");

  const isolation = assertAsideReplyLaneIsolation({
    parentSessionId,
    asideSessionId,
    parentSessionFile,
    asideSessionFile,
    disableTools: true,
  });

  // Register cancel signal before any await that could race with owner pause.
  registerMidTaskAsideLane(parentSessionId, asideSessionId);

  const fail = (text: string, cancelled = false): AsideReplyLaneResult => ({
    ok: false,
    text,
    runId: params.runId,
    isolation,
    ...(cancelled ? { cancelled: true } : {}),
  });

  try {
    if (
      isMidTaskAsideLaneCancelled(parentSessionId, asideSessionId) ||
      ownerStopBlocksAside(parentSessionFile)
    ) {
      return fail(CANCELLED_TEXT, true);
    }

    const agentId =
      resolveAgentIdFromSessionKey(params.run.sessionKey ?? "") ||
      resolveAgentIdFromSessionKey(parentSessionId) ||
      "main";
    const agentDir =
      params.run.agentDir?.trim() || resolveAgentDir(params.run.config ?? {}, agentId);
    const history = await loadAsideReplyContextHistory({ parentSessionFile });
    const prompt = buildAsideReplyLanePrompt({
      board: params.board,
      userPrompt: params.userPrompt,
      history,
    });

    // Persist the user turn before the model call so refresh mid-flight can recover the ask.
    appendAsideDialogueTurn(parentSessionFile, {
      atMs: Date.now(),
      runId: params.runId,
      role: "user",
      text: cleanedPrompt,
    });

    if (
      isMidTaskAsideLaneCancelled(parentSessionId, asideSessionId) ||
      ownerStopBlocksAside(parentSessionFile)
    ) {
      return fail(CANCELLED_TEXT, true);
    }

    const result = await runEmbedded({
      sessionId: asideSessionId,
      sessionKey: `temp:aside-reply:${params.runId}`,
      agentId,
      sessionFile: asideSessionFile,
      workspaceDir: params.run.workspaceDir,
      agentDir,
      config: params.run.config,
      prompt,
      provider: params.run.provider,
      model: params.run.model,
      timeoutMs: Math.min(params.run.timeoutMs ?? 60_000, 60_000),
      runId: params.runId,
      disableTools: true,
      ...(params.run.thinkLevel ? { thinkLevel: params.run.thinkLevel as never } : {}),
    });

    // Cancel after start: do not deliver a late answer.
    if (
      isMidTaskAsideLaneCancelled(parentSessionId, asideSessionId) ||
      ownerStopBlocksAside(parentSessionFile)
    ) {
      return fail(CANCELLED_TEXT, true);
    }

    // Call-boundary guarantee: this path never imports/calls board writers.
    // A may update/complete concurrently — that must NOT discard B's answer.
    const text = extractAssistantText(result.payloads);
    if (!text) {
      return fail(FAIL_TEXT);
    }

    appendAsideDialogueTurn(parentSessionFile, {
      atMs: Date.now(),
      runId: params.runId,
      role: "assistant",
      text,
    });

    return { ok: true, text, runId: params.runId, isolation };
  } catch {
    if (isMidTaskAsideLaneCancelled(parentSessionId, asideSessionId)) {
      return fail(CANCELLED_TEXT, true);
    }
    return fail(FAIL_TEXT);
  } finally {
    unregisterMidTaskAsideLane(parentSessionId, asideSessionId);
    try {
      await fsp.rm(tmpRoot, { recursive: true, force: true });
    } catch {
      // ignore cleanup errors
    }
  }
}
