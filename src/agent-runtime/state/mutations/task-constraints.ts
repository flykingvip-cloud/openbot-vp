import type { SessionTaskBoard, ConstraintEntry } from "../../contracts/task.js";
import { stripInboundStamp as stripStamp, normalizeConstraintEntries } from "../../policy/index.js";
import { cloneBoardShell } from "../repository/task-board-file.js";

/** Display-only short constraint marker for stop.summary (not the persistence source). */
function constraintDisplayMarker(fullText: string): string {
  const short = fullText.length > 48 ? `${fullText.slice(0, 48)}…` : fullText;
  return `约束：${short}`;
}

/**
 * Sole same-task constraint updater for the board.
 * Persists the *full* owner text on the constraint log; stop.summary gets a short display marker only.
 * - Bare continue / read queries are not persisted.
 * - Explicit *full replace* supersedes prior active rows (history kept with superseded=true).
 * - Local revision / supplement append without auto-discarding unrelated active rows.
 * Never deletes rows by keyword scan; never invents a second adjudicator.
 */
export function appendTaskConstraint(params: {
  board: SessionTaskBoard;
  constraintText: string;
  nowMs?: number;
  mode?: "supplement" | "revise" | "replace_all";
}): SessionTaskBoard {
  const board = cloneBoardShell(params.board);
  const current = board.current;
  if (!current?.unfinished) {
    return board;
  }
  const cleaned = stripStamp(params.constraintText).replace(/\s+/g, " ").trim();
  if (!cleaned) {
    return board;
  }
  const nowMs = params.nowMs ?? Date.now();
  const priorList = normalizeConstraintEntries(current.effectiveConstraints);
  if (priorList.some((row) => row.text === cleaned && !row.superseded)) {
    return board;
  }
  const fullReplace = params.mode === "replace_all";
  const revise = fullReplace || params.mode === "revise";
  // Only wholesale replace marks prior active rows superseded. Local revise keeps them.
  const nextList: ConstraintEntry[] = fullReplace
    ? priorList.map((row) => (row.superseded ? row : { ...row, superseded: true }))
    : [...priorList];
  nextList.push({
    text: cleaned,
    atMs: nowMs,
    kind: revise ? "revise" : "supplement",
  });
  const marker = constraintDisplayMarker(cleaned);
  const priorSummary = current.stop.summary?.trim() || `未完成：${current.title}`;
  const nextSummary = priorSummary.includes(marker) ? priorSummary : `${marker}｜${priorSummary}`;
  return {
    ...board,
    current: {
      ...current,
      // Owner pause must survive concurrent constraint appends (cross-process).
      ...(current.wakeSuppress ? { wakeSuppress: true } : {}),
      effectiveConstraints: nextList,
      stop: {
        ...current.stop,
        summary: nextSummary,
      },
    },
  };
}
