/**
 * Session FOCUS / PARKED snapshot.
 * The session task board is the source of truth. Transcript fences are not.
 * conversation_send of the current task does not wait for owner confirmation.
 */
import fs from "node:fs";
import {
  hasFocusParkFence,
  isSyntheticUserTurn,
  readUserTurnTextsFromTranscript,
  stripFocusParkFence,
  titleFromTaskText,
} from "./focus-switch.js";
import {
  applyIncomingUserMessage,
  buildResumePrompt,
  emptySessionTaskBoard,
  evaluateCurrentTaskSend,
  readSessionTaskBoard,
  type SessionTaskBoard,
  type TrackedTask,
} from "./session-task-board.js";

export type FocusResumeDecision = { action: "continue"; requiresOwner: false; taskId?: string };

export type SessionGoalSlot = {
  text: string;
  title: string;
  taskId?: string;
  stopSummary?: string;
  workspacePaths?: string[];
  parkedAtMs?: number;
};

export type SessionFocusSnapshot = {
  focus?: SessionGoalSlot;
  parked: SessionGoalSlot[];
};

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

function slotFromTask(task: TrackedTask): SessionGoalSlot {
  return {
    text: task.goalText,
    title: task.title || titleFromTaskText(task.goalText),
    taskId: task.taskId,
    stopSummary: task.stop.summary,
    workspacePaths: task.stop.workspacePaths,
    parkedAtMs: task.parkedAtMs,
  };
}

export function snapshotFromBoard(board: SessionTaskBoard): SessionFocusSnapshot {
  return {
    focus: board.current ? slotFromTask(board.current) : undefined,
    parked: board.parked.map(slotFromTask),
  };
}

/** Replay owner turns onto the task board. Fence markers do not reset the board. */
export function resolveSessionFocusSnapshot(turns: readonly string[]): SessionFocusSnapshot {
  let board = emptySessionTaskBoard();
  for (const raw of turns) {
    const text = stripFocusParkFence(raw).trim();
    if (
      !text ||
      isSyntheticUserTurn(text) ||
      (hasFocusParkFence(raw) && !stripFocusParkFence(raw).trim())
    ) {
      continue;
    }
    board = applyIncomingUserMessage({ board, incomingText: text }).board;
  }
  return snapshotFromBoard(board);
}

export function resolveSessionFocusFromTranscript(text: string): SessionFocusSnapshot {
  return resolveSessionFocusSnapshot(readUserTurnTextsFromTranscript(text));
}

export function resolveSessionFocusFromSessionFile(sessionFile?: string): SessionFocusSnapshot {
  const file = sessionFile?.trim();
  if (!file) {
    return { parked: [] };
  }
  const stored = readSessionTaskBoard(file);
  if (stored.current || stored.parked.length > 0) {
    return snapshotFromBoard(stored);
  }
  try {
    if (!fs.existsSync(file)) {
      return { parked: [] };
    }
    return resolveSessionFocusFromTranscript(readSessionFileTail(file));
  } catch {
    return { parked: [] };
  }
}

export function evaluateAgentGoalAgainstFocus(params: {
  snapshot: SessionFocusSnapshot;
  intendedGoal: string;
  taskId?: string;
  proceed?: boolean;
}): FocusResumeDecision {
  const send = evaluateCurrentTaskSend({
    currentTaskId: params.snapshot.focus?.taskId,
    taskId: params.taskId ?? params.snapshot.focus?.taskId,
  });
  return { action: "continue", requiresOwner: false, taskId: send.taskId };
}

export function isFocusResumeSessionAvailable(sessionFile?: string): boolean {
  const file = sessionFile?.trim();
  if (!file) {
    return false;
  }
  try {
    return fs.existsSync(file);
  } catch {
    return false;
  }
}

/** Current-task delivery never waits for the owner. Missing files do not block. */
export function applyFocusResumeGate(params: {
  sessionFile?: string;
  intendedGoal: string;
  taskId?: string;
  proceed?: boolean;
}): FocusResumeDecision {
  const snapshot = resolveSessionFocusFromSessionFile(params.sessionFile);
  return evaluateAgentGoalAgainstFocus({
    snapshot,
    intendedGoal: params.intendedGoal,
    taskId: params.taskId,
    proceed: params.proceed,
  });
}

export function buildFocusResumePrompt(snapshot: SessionFocusSnapshot): string {
  const focus = snapshot.focus;
  if (!focus) {
    return "";
  }
  const lines = [
    `Current task: 「${focus.title}」`,
    "Follow-ups, supplements, constraint changes, extra sections, and progress questions stay on this task.",
    "Do not cut this task's context unless the message is clearly different work.",
  ];
  if (snapshot.parked.length > 0) {
    lines.push(
      "Parked tasks are outside this context. Resume restores only the stop summary and file paths, not the old transcript.",
    );
    for (const slot of snapshot.parked) {
      const where = slot.stopSummary ? `停在：${slot.stopSummary}` : "";
      lines.push(`「${slot.title}」${where}`);
    }
  }
  if (focus.taskId && focus.stopSummary) {
    lines.push(
      buildResumePrompt({
        taskId: focus.taskId,
        title: focus.title,
        goalText: focus.text,
        unfinished: true,
        stop: {
          summary: focus.stopSummary,
          workspacePaths: focus.workspacePaths ?? [],
        },
        createdAtMs: 0,
      }),
    );
  }
  return lines.join("\n");
}

export function buildFocusResumePromptFromSessionFile(sessionFile?: string): string {
  return buildFocusResumePrompt(resolveSessionFocusFromSessionFile(sessionFile));
}
