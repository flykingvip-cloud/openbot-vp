/**
 * Mid-task reply_lane: timely ordinary-aside answers while task A stays active.
 *
 * Reuses the embedded runner with disableTools on an ephemeral session so we do
 * not contend for A's session write lock / ACTIVE_EMBEDDED_RUNS slot, do not
 * write the task board, and do not become a second task controller.
 *
 * Dialogue continuity: Q&A is persisted to a durable aside-dialogue sidecar
 * (not A's agent jsonl). Follow-ups / refresh read a time-merged view of that
 * log + parent transcript; chat.history also paints sidecar turns so refresh /
 * reconnect recover bubbles without co-writing A's jsonl. Cancel registers the
 * lane (with taskId + AbortSignal) before the first await so prepare-window
 * abort is visible; tombstones still block after current is cleared.
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
  isTaskTombstoned,
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
  /** Task that owned this aside when registered — tombstone check after current cleared. */
  taskId?: string;
  /** Prepare→run→end cancel; aborted by owner pause/cancel even before ACTIVE_EMBEDDED_RUNS. */
  abortController?: AbortController;
};

/** parentSessionId → asideSessionId → cancel signal (survives prepare/run/end). */
const ASIDE_LANES_BY_PARENT = new Map<string, Map<string, AsideLaneState>>();

export type RegisterMidTaskAsideLaneOptions = {
  taskId?: string;
  abortController?: AbortController;
};

export function asideDialogueLogPath(parentSessionFile: string): string {
  return `${parentSessionFile.trim()}.aside-dialogue.jsonl`;
}

export type AsideDialogueTurn = {
  atMs: number;
  runId: string;
  role: "user" | "assistant";
  text: string;
  /** Stable inbound / transcript message id when known (cross-source dedupe). */
  messageId?: string;
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
    ...(typeof turn.messageId === "string" && turn.messageId.trim()
      ? { messageId: turn.messageId.trim() }
      : {}),
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
          ...(typeof row.messageId === "string" && row.messageId.trim()
            ? { messageId: row.messageId.trim() }
            : {}),
        });
      }
    } catch {
      // skip malformed
    }
  }
  return turns;
}

export function registerMidTaskAsideLane(
  parentSessionId: string,
  asideSessionId: string,
  opts?: RegisterMidTaskAsideLaneOptions,
): void {
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
    // Still attach a late abortController so prepare-window abort reaches the runner.
    if (!existing.abortController && opts?.abortController) {
      existing.abortController = opts.abortController;
      if (existing.cancelled) {
        try {
          opts.abortController.abort();
        } catch {
          // ignore
        }
      }
    }
    if (!existing.taskId && opts?.taskId?.trim()) {
      existing.taskId = opts.taskId.trim();
    }
    return;
  }
  map.set(aside, {
    cancelled: false,
    ...(opts?.taskId?.trim() ? { taskId: opts.taskId.trim() } : {}),
    ...(opts?.abortController ? { abortController: opts.abortController } : {}),
  });
}

/**
 * Mark cancelled *without* dropping the registration. Abort the prepare→run
 * AbortSignal and embedded run if already in ACTIVE_EMBEDDED_RUNS; late starts
 * must observe cancelled.
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
      state.abortController?.abort();
    } catch {
      // ignore double-abort
    }
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

export function midTaskAsideLaneTaskIdForTests(
  parentSessionId: string,
  asideSessionId: string,
): string | undefined {
  return ASIDE_LANES_BY_PARENT.get(parentSessionId.trim())?.get(asideSessionId.trim())?.taskId;
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

export function normalizeDialogueIdentityText(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

/**
 * Cross-source stable message identity. Never keyed by transcript:/aside: source
 * prefixes — those only describe origin and cannot prove dedupe across sources.
 */
export function stableDialogueMessageIdentity(params: {
  messageId?: string | null;
  role: string;
  text: string;
}): string {
  const mid = typeof params.messageId === "string" ? params.messageId.trim() : "";
  // Synthetic aside: ids are display-only; they are not shared with the transcript.
  if (mid && !mid.startsWith("aside:")) {
    return `mid:${mid}`;
  }
  const role = params.role === "assistant" ? "assistant" : "user";
  return `rt:${role}:${normalizeDialogueIdentityText(params.text)}`;
}

/**
 * Merge parent transcript turns and aside sidecar turns by time + message identity.
 * Never returns aside-only when the sidecar is "full" — latest parent lines must remain.
 */
export function mergeAsideAndParentHistoryTurns(params: {
  parentTurns: AsideDialogueTurn[];
  asideTurns: AsideDialogueTurn[];
  limit?: number;
}): AsideDialogueTurn[] {
  const limit = Math.max(2, Math.min(params.limit ?? 12, 24));
  type Tagged = AsideDialogueTurn & { _identity: string; _tie: string };
  const tagged: Tagged[] = [
    ...params.parentTurns.map((turn, index) => ({
      ...turn,
      _identity: stableDialogueMessageIdentity({
        messageId: turn.messageId ?? (turn.runId.startsWith("aside:") ? undefined : turn.runId),
        role: turn.role,
        text: turn.text,
      }),
      _tie: `parent:${index}`,
    })),
    ...params.asideTurns.map((turn, index) => ({
      ...turn,
      _identity: stableDialogueMessageIdentity({
        messageId: turn.messageId,
        role: turn.role,
        text: turn.text,
      }),
      _tie: `aside:${index}`,
    })),
  ];
  // Prefer parent/transcript when timestamps tie (stable sort: parent rows first).
  tagged.sort((a, b) => a.atMs - b.atMs || a._tie.localeCompare(b._tie));
  const seen = new Set<string>();
  const merged: AsideDialogueTurn[] = [];
  for (const row of tagged) {
    if (seen.has(row._identity)) {
      continue;
    }
    seen.add(row._identity);
    merged.push({
      atMs: row.atMs,
      runId: row.runId,
      role: row.role,
      text: row.text,
      ...(row.messageId ? { messageId: row.messageId } : {}),
    });
  }
  return merged.slice(-limit);
}

/**
 * Build related history for the aside prompt: time-merge durable aside log with
 * parent-session user/assistant lines (read-only). Never mutates either.
 */
export async function loadAsideReplyContextHistory(params: {
  parentSessionFile: string;
  limit?: number;
}): Promise<AsideDialogueTurn[]> {
  const limit = Math.max(2, Math.min(params.limit ?? 12, 24));
  const fromLog = readAsideDialogueTurns(params.parentSessionFile);
  let fromParent: AsideDialogueTurn[] = [];
  try {
    const messages = await readSessionMessages(params.parentSessionFile);
    fromParent = messages.map((m, index) => ({
      atMs: m.timestamp ? Date.parse(m.timestamp) || 0 : 0,
      runId: typeof m.id === "string" ? m.id : `parent-${index}`,
      role: m.role === "assistant" ? "assistant" : "user",
      text: m.text,
      ...(typeof m.id === "string" && m.id.trim() ? { messageId: m.id.trim() } : {}),
    }));
  } catch {
    fromParent = [];
  }
  return mergeAsideAndParentHistoryTurns({
    parentTurns: fromParent,
    asideTurns: fromLog,
    limit,
  });
}

/** Paint sidecar Q&A in chat.history bubble shape (not A's agent jsonl). */
export function asideDialogueAsChatHistoryMessages(
  parentSessionFile: string,
): Array<Record<string, unknown>> {
  return readAsideDialogueTurns(parentSessionFile).map((turn) => {
    const marker = { kind: "aside_dialogue", runId: turn.runId };
    const syntheticId = `aside:${turn.runId}:${turn.role}:${turn.atMs}`;
    // Prefer inbound messageId for cross-source identity; keep synthetic id for display only.
    const stableId = turn.messageId?.trim() || syntheticId;
    return {
      role: turn.role,
      timestamp: turn.atMs > 0 ? turn.atMs : Date.now(),
      content: [{ type: "text", text: turn.text }],
      id: stableId,
      messageId: stableId,
      __openbot: marker,
      __openclaw: marker,
    };
  });
}

function chatHistoryMessageTimestamp(message: unknown, fallbackIndex: number): number {
  if (message && typeof message === "object") {
    const row = message as { timestamp?: unknown };
    if (typeof row.timestamp === "number" && Number.isFinite(row.timestamp)) {
      return row.timestamp;
    }
    if (typeof row.timestamp === "string") {
      const parsed = Date.parse(row.timestamp);
      if (Number.isFinite(parsed)) {
        return parsed;
      }
    }
  }
  return fallbackIndex;
}

function extractChatHistoryRoleText(message: unknown): {
  role: string;
  text: string;
  messageId?: string;
} {
  if (!message || typeof message !== "object") {
    return { role: "user", text: "" };
  }
  const row = message as {
    role?: unknown;
    id?: unknown;
    messageId?: unknown;
    content?: unknown;
  };
  const role = row.role === "assistant" ? "assistant" : "user";
  let text = "";
  if (typeof row.content === "string") {
    text = row.content;
  } else if (Array.isArray(row.content)) {
    text = row.content
      .map((block) =>
        block && typeof block === "object" && typeof (block as { text?: unknown }).text === "string"
          ? (block as { text: string }).text
          : "",
      )
      .filter(Boolean)
      .join("\n");
  }
  const messageIdRaw =
    (typeof row.messageId === "string" && row.messageId.trim()) ||
    (typeof row.id === "string" && row.id.trim()) ||
    "";
  return {
    role,
    text,
    ...(messageIdRaw ? { messageId: messageIdRaw } : {}),
  };
}

/**
 * Merge chat.history transcript messages with aside sidecar turns by timestamp
 * and stable message identity (cross-source). Caller must apply the original
 * history bound/limit rules AFTER this merge.
 */
export function mergeChatHistoryWithAsideDialogue(params: {
  messages: unknown[];
  parentSessionFile: string;
}): unknown[] {
  const aside = asideDialogueAsChatHistoryMessages(params.parentSessionFile);
  if (aside.length === 0) {
    return params.messages;
  }
  type Stamped = { msg: unknown; ts: number; identity: string; tie: string };
  const stamped: Stamped[] = [
    ...params.messages.map((msg, index) => {
      const extracted = extractChatHistoryRoleText(msg);
      return {
        msg,
        ts: chatHistoryMessageTimestamp(msg, index),
        identity: stableDialogueMessageIdentity(extracted),
        tie: `transcript:${index}`,
      };
    }),
    ...aside.map((msg, index) => {
      const extracted = extractChatHistoryRoleText(msg);
      return {
        msg,
        ts: chatHistoryMessageTimestamp(msg, index),
        identity: stableDialogueMessageIdentity(extracted),
        tie: `aside:${index}`,
      };
    }),
  ];
  stamped.sort((a, b) => a.ts - b.ts || a.tie.localeCompare(b.tie));
  const seen = new Set<string>();
  const merged: unknown[] = [];
  for (const row of stamped) {
    if (seen.has(row.identity)) {
      continue;
    }
    seen.add(row.identity);
    merged.push(row.msg);
  }
  return merged;
}

/**
 * Inject durable aside Q&A into the normal (post-A) reply context path via
 * extraSystemPrompt — does not co-write A's agent jsonl.
 */
export function buildAsideDialogueContextPromptForNormalReply(
  sessionFile?: string,
): string | undefined {
  const file = sessionFile?.trim() ?? "";
  if (!file) {
    return undefined;
  }
  const turns = readAsideDialogueTurns(file);
  if (turns.length === 0) {
    return undefined;
  }
  const recent = turns.slice(-24);
  const block = recent
    .map((turn) => `${turn.role === "user" ? "主人" : "助手"}：${turn.text}`)
    .join("\n");
  return [
    "【旁路插问记录（任务执行期间，未写入主任务 jsonl）】",
    "同一对话中已发生的旁路问答；刷新、重连或任务结束后的正常追问应把它们当作已发生上下文。",
    block,
  ].join("\n");
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
  /** Stable inbound message id for cross-source history dedupe with the transcript. */
  messageId?: string;
  /** Injectable for tests. */
  runEmbedded?: typeof runEmbeddedPiAgent;
  /** Injectable prepare FS — tests abort during the former mkdtemp/writeFile window. */
  fsPrepare?: {
    mkdtemp?: typeof fsp.mkdtemp;
    writeFile?: typeof fsp.writeFile;
  };
};

function ownerStopBlocksAside(parentSessionFile: string, taskId?: string): boolean {
  try {
    const live = readSessionTaskBoard(parentSessionFile);
    // Owner pause sets wakeSuppress. Task completion must NOT block delivering B.
    if (live.current?.wakeSuppress === true) {
      return true;
    }
    const id = taskId?.trim() ?? "";
    // Cancel clears current and writes a tombstone — must still block late B.
    if (id && isTaskTombstoned(live, id)) {
      return true;
    }
    return false;
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
  const taskId = params.board.current?.taskId?.trim() ?? "";
  const abortController = new AbortController();
  const mkdtemp = params.fsPrepare?.mkdtemp ?? fsp.mkdtemp.bind(fsp);
  const writeFile = params.fsPrepare?.writeFile ?? fsp.writeFile.bind(fsp);

  // Register BEFORE the first await (mkdtemp/writeFile) so cancel during prepare
  // finds B, binds the owning taskId, and can abort the runner signal.
  registerMidTaskAsideLane(parentSessionId, asideSessionId, {
    taskId,
    abortController,
  });

  let tmpRoot = "";
  // Placeholder isolation until prepare creates the ephemeral file; fail paths need a shape.
  const pendingIsolation = assertAsideReplyLaneIsolation({
    parentSessionId,
    asideSessionId,
    parentSessionFile,
    asideSessionFile: path.join(os.tmpdir(), `openbot-aside-reply-pending-${params.runId}.jsonl`),
    disableTools: true,
  });

  const fail = (
    text: string,
    cancelled = false,
    isolation: AsideReplyLaneIsolation = pendingIsolation,
  ): AsideReplyLaneResult => ({
    ok: false,
    text,
    runId: params.runId,
    isolation,
    ...(cancelled ? { cancelled: true } : {}),
  });

  try {
    if (
      isMidTaskAsideLaneCancelled(parentSessionId, asideSessionId) ||
      abortController.signal.aborted ||
      ownerStopBlocksAside(parentSessionFile, taskId)
    ) {
      return fail(CANCELLED_TEXT, true);
    }

    tmpRoot = await mkdtemp(path.join(os.tmpdir(), "openbot-aside-reply-"));
    const asideSessionFile = path.join(tmpRoot, "session.jsonl");
    await writeFile(asideSessionFile, "", "utf8");

    const isolation = assertAsideReplyLaneIsolation({
      parentSessionId,
      asideSessionId,
      parentSessionFile,
      asideSessionFile,
      disableTools: true,
    });

    if (
      isMidTaskAsideLaneCancelled(parentSessionId, asideSessionId) ||
      abortController.signal.aborted ||
      ownerStopBlocksAside(parentSessionFile, taskId)
    ) {
      return fail(CANCELLED_TEXT, true, isolation);
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
      ...(params.messageId?.trim() ? { messageId: params.messageId.trim() } : {}),
    });

    if (
      isMidTaskAsideLaneCancelled(parentSessionId, asideSessionId) ||
      abortController.signal.aborted ||
      ownerStopBlocksAside(parentSessionFile, taskId)
    ) {
      return fail(CANCELLED_TEXT, true, isolation);
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
      abortSignal: abortController.signal,
      ...(params.run.thinkLevel ? { thinkLevel: params.run.thinkLevel as never } : {}),
    });

    // Cancel after start: do not deliver a late answer.
    if (
      isMidTaskAsideLaneCancelled(parentSessionId, asideSessionId) ||
      abortController.signal.aborted ||
      ownerStopBlocksAside(parentSessionFile, taskId)
    ) {
      return fail(CANCELLED_TEXT, true, isolation);
    }

    // Call-boundary guarantee: this path never imports/calls board writers.
    // A may update/complete concurrently — that must NOT discard B's answer.
    const text = extractAssistantText(result.payloads);
    if (!text) {
      return fail(FAIL_TEXT, false, isolation);
    }

    appendAsideDialogueTurn(parentSessionFile, {
      atMs: Date.now(),
      runId: params.runId,
      role: "assistant",
      text,
    });

    return { ok: true, text, runId: params.runId, isolation };
  } catch {
    if (
      isMidTaskAsideLaneCancelled(parentSessionId, asideSessionId) ||
      abortController.signal.aborted
    ) {
      return fail(CANCELLED_TEXT, true);
    }
    return fail(FAIL_TEXT);
  } finally {
    unregisterMidTaskAsideLane(parentSessionId, asideSessionId);
    if (tmpRoot) {
      try {
        await fsp.rm(tmpRoot, { recursive: true, force: true });
      } catch {
        // ignore cleanup errors
      }
    }
  }
}
