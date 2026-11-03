/**
 * Mid-task reply_lane: timely ordinary-aside answers while task A stays active.
 *
 * Reuses the embedded runner with disableTools on an ephemeral session so we do
 * not contend for A's session write lock / ACTIVE_EMBEDDED_RUNS slot, do not
 * write the task board, and do not become a second task controller.
 *
 * Dialogue continuity (read/format/merge/budget) lives in
 * mid-task-aside-dialogue-history.ts — no runner dependency there — so
 * get-reply-run / chat.history can statically import helpers without pulling
 * pi-embedded. This module owns lane registry, cancel lifecycle, and the
 * ephemeral embedded run.
 */
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { resolveAgentDir, resolveAgentIdFromSessionKey } from "../../agents/agent-scope.js";
import { abortEmbeddedPiRun, runEmbeddedPiAgent } from "../../agents/pi-embedded.js";
import type { OpenBotConfig } from "../../config/config.js";
import {
  isTaskTombstoned,
  readSessionTaskBoard,
} from "../../conversation-task/session-task-board.js";
import {
  appendAsideDialogueTurn,
  buildAsideReplyLanePrompt,
  loadAsideReplyContextHistory,
} from "./mid-task-aside-dialogue-history.js";
import { stripInboundStampForDialogue } from "./mid-task-dialogue.js";

// Re-export pure history helpers for existing test imports that still point here.
export {
  ASIDE_DIALOGUE_HISTORY_TURN_CAP,
  ASIDE_NORMAL_REPLY_CONTEXT_MAX_CHARS,
  appendAsideDialogueTurn,
  asideDialogueAsChatHistoryMessages,
  asideDialogueLogPath,
  buildAsideDialogueContextPromptForNormalReply,
  buildAsideReplyLanePrompt,
  loadAsideReplyContextHistory,
  mergeAsideAndParentHistoryTurns,
  mergeChatHistoryWithAsideDialogue,
  normalizeDialogueIdentityText,
  readAsideDialogueTurns,
  selectAsideTurnsWithinCharBudget,
  stableDialogueMessageIdentity,
  type AsideDialogueTurn,
} from "./mid-task-aside-dialogue-history.js";

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
