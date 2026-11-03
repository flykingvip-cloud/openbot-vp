/**
 * Mid-task reply_lane: timely ordinary-aside answers while task A stays active.
 *
 * Reuses the embedded runner with disableTools on an ephemeral session so we do
 * not contend for A's session write lock / ACTIVE_EMBEDDED_RUNS slot, do not
 * write the task board, and do not become a second task controller.
 */
import fs from "node:fs/promises";
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

/** parentSessionId → live aside sessionIds (for stop-priority abort). */
const ASIDE_LANES_BY_PARENT = new Map<string, Set<string>>();

export function registerMidTaskAsideLane(parentSessionId: string, asideSessionId: string): void {
  const parent = parentSessionId.trim();
  const aside = asideSessionId.trim();
  if (!parent || !aside) {
    return;
  }
  let set = ASIDE_LANES_BY_PARENT.get(parent);
  if (!set) {
    set = new Set();
    ASIDE_LANES_BY_PARENT.set(parent, set);
  }
  set.add(aside);
}

export function unregisterMidTaskAsideLane(parentSessionId: string, asideSessionId: string): void {
  const parent = parentSessionId.trim();
  const set = ASIDE_LANES_BY_PARENT.get(parent);
  if (!set) {
    return;
  }
  set.delete(asideSessionId.trim());
  if (set.size === 0) {
    ASIDE_LANES_BY_PARENT.delete(parent);
  }
}

/** Abort all reply_lane asides registered under a parent (owner pause/cancel). */
export function abortMidTaskAsideLanes(parentSessionId: string): string[] {
  const parent = parentSessionId.trim();
  const set = ASIDE_LANES_BY_PARENT.get(parent);
  if (!set || set.size === 0) {
    return [];
  }
  const aborted: string[] = [];
  for (const asideId of set) {
    try {
      if (abortEmbeddedPiRun(asideId)) {
        aborted.push(asideId);
      }
    } catch {
      // best-effort; continue other asides
    }
    set.delete(asideId);
  }
  ASIDE_LANES_BY_PARENT.delete(parent);
  return aborted;
}

/** Test helper — clear registry between cases. */
export function resetMidTaskAsideLaneRegistryForTests(): void {
  ASIDE_LANES_BY_PARENT.clear();
}

export function listMidTaskAsideLanesForTests(parentSessionId: string): string[] {
  return [...(ASIDE_LANES_BY_PARENT.get(parentSessionId.trim()) ?? [])];
}

function truncate(text: string, max: number): string {
  const cleaned = text.replace(/\s+/g, " ").trim();
  if (cleaned.length <= max) {
    return cleaned;
  }
  return `${cleaned.slice(0, max)}…`;
}

/**
 * Read-only board projection injected as context. Never a mutation instruction.
 */
export function buildAsideReplyLanePrompt(params: {
  board: SessionTaskBoard;
  userPrompt: string;
}): string {
  const cleaned = stripInboundStampForDialogue(params.userPrompt);
  const focus = formatTaskBoardFocusLine(params.board);
  const current = params.board.current;
  const goal = current?.goalText?.trim() || current?.title || "（无）";
  const constraints = current ? activeConstraintTexts(current) : [];
  const constraintBlock =
    constraints.length === 0
      ? "（尚无已登记有效约束）"
      : constraints.map((row, i) => `${i + 1}. ${truncate(row, 200)}`).join("\n");
  const stop = current?.stop?.summary?.trim() || "（无）";

  return [
    "【旁路插问 — 只读回答】后台长任务仍在执行。请直接回答主人的插问。",
    "禁止：继续/推进/改写该任务、调用工具、修改任务板或工作区、把插问写成新任务目标。",
    `任务板只读投影：${focus}。`,
    `目标：${truncate(goal, 240)}`,
    `有效约束：\n${constraintBlock}`,
    `停点摘要：${truncate(stop, 160)}`,
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

/**
 * Execute a tools-disabled embedded turn on an ephemeral session.
 * Does not mutate the parent task board. Caller must deliver under `runId`.
 */
export async function runMidTaskAsideReplyLane(
  params: RunMidTaskAsideReplyLaneParams,
): Promise<AsideReplyLaneResult> {
  const parentSessionId = params.parentSessionId.trim();
  const parentSessionFile = params.parentSessionFile.trim();
  const asideSessionId = `aside-reply-${params.runId}`;
  const runEmbedded = params.runEmbedded ?? runEmbeddedPiAgent;

  const tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "openbot-aside-reply-"));
  const asideSessionFile = path.join(tmpRoot, "session.jsonl");
  await fs.writeFile(asideSessionFile, "", "utf8");

  const isolation = assertAsideReplyLaneIsolation({
    parentSessionId,
    asideSessionId,
    parentSessionFile,
    asideSessionFile,
    disableTools: true,
  });

  registerMidTaskAsideLane(parentSessionId, asideSessionId);

  const boardBefore = readSessionTaskBoard(parentSessionFile);
  const epochBefore = typeof boardBefore.writeEpoch === "number" ? boardBefore.writeEpoch : 0;
  const constraintsBefore = boardBefore.current
    ? activeConstraintTexts(boardBefore.current).join("\u0000")
    : "";

  const agentId =
    resolveAgentIdFromSessionKey(params.run.sessionKey ?? "") ||
    resolveAgentIdFromSessionKey(parentSessionId) ||
    "main";
  const agentDir = params.run.agentDir?.trim() || resolveAgentDir(params.run.config ?? {}, agentId);
  const prompt = buildAsideReplyLanePrompt({
    board: params.board,
    userPrompt: params.userPrompt,
  });

  const failText =
    "后台任务仍在执行；这次插问未能即时生成回答。未改动任务板，也未把插问排进任务续跑队列。请稍后重试，或先暂停任务后再问。";

  try {
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

    const boardAfter = readSessionTaskBoard(parentSessionFile);
    const epochAfter = typeof boardAfter.writeEpoch === "number" ? boardAfter.writeEpoch : 0;
    const constraintsAfter = boardAfter.current
      ? activeConstraintTexts(boardAfter.current).join("\u0000")
      : "";
    if (epochAfter !== epochBefore || constraintsAfter !== constraintsBefore) {
      throw new Error("aside reply_lane must not mutate the parent task board");
    }

    const text = extractAssistantText(result.payloads);
    if (!text) {
      return { ok: false, text: failText, runId: params.runId, isolation };
    }
    return { ok: true, text, runId: params.runId, isolation };
  } catch {
    return { ok: false, text: failText, runId: params.runId, isolation };
  } finally {
    unregisterMidTaskAsideLane(parentSessionId, asideSessionId);
    try {
      await fs.rm(tmpRoot, { recursive: true, force: true });
    } catch {
      // ignore cleanup errors
    }
  }
}
