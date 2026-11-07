import { randomUUID } from "node:crypto";
import fs from "node:fs";
import { SESSION_TASK_BOARD_LOCK_OPTIONS, withFileLockSync } from "../../../infra/file-lock.js";
import type { SessionTaskBoard, TaskBoardScope, TrackedTask } from "../../contracts/task.js";
import { normalizeConstraintEntries } from "../../policy/index.js";

export function emptySessionTaskBoard(scope?: TaskBoardScope): SessionTaskBoard {
  return { parked: [], focusRevision: 0, ...(scope ? { scope } : {}) };
}

export function sessionTaskBoardPath(sessionFile: string): string {
  return `${sessionFile}.task-board.json`;
}

function normalizeTrackedTask(task: TrackedTask | undefined): TrackedTask | undefined {
  if (!task) {
    return undefined;
  }
  const entries = normalizeConstraintEntries(task.effectiveConstraints);
  return {
    ...task,
    ...(entries.length > 0
      ? { effectiveConstraints: entries }
      : { effectiveConstraints: undefined }),
  };
}

export function withSessionTaskBoardLock<T>(sessionFile: string, fn: () => T): T {
  const boardPath = sessionTaskBoardPath(sessionFile);
  return withFileLockSync(boardPath, SESSION_TASK_BOARD_LOCK_OPTIONS, fn);
}

export function readSessionTaskBoardUnlocked(sessionFile?: string): SessionTaskBoard {
  const file = sessionFile?.trim();
  if (!file) {
    return emptySessionTaskBoard();
  }
  try {
    const raw = fs.readFileSync(sessionTaskBoardPath(file), "utf8");
    const parsed = JSON.parse(raw) as SessionTaskBoard;
    if (!parsed || !Array.isArray(parsed.parked)) {
      return emptySessionTaskBoard();
    }
    return {
      current: normalizeTrackedTask(parsed.current),
      parked: parsed.parked.map((row) => normalizeTrackedTask(row) ?? row),
      focusRevision: typeof parsed.focusRevision === "number" ? parsed.focusRevision : 0,
      ...(typeof parsed.writeEpoch === "number" ? { writeEpoch: parsed.writeEpoch } : {}),
      ...(Array.isArray(parsed.tombstones) ? { tombstones: parsed.tombstones } : {}),
      ...(Array.isArray(parsed.archived) ? { archived: parsed.archived } : {}),
      ...(parsed.scope ? { scope: parsed.scope } : {}),
    };
  } catch {
    return emptySessionTaskBoard();
  }
}

/**
 * Write under an already-held board lock. Epoch always advances from the *on-disk*
 * value so concurrent callers cannot invent a non-monotonic generation from a stale board.
 */
export function writeSessionTaskBoardUnlocked(sessionFile: string, board: SessionTaskBoard): void {
  const disk = readSessionTaskBoardUnlocked(sessionFile);
  const diskEpoch = typeof disk.writeEpoch === "number" ? disk.writeEpoch : 0;
  const normalized: SessionTaskBoard = {
    ...board,
    focusRevision: board.focusRevision ?? 0,
    writeEpoch: diskEpoch + 1,
    parked: board.parked ?? [],
    current: normalizeTrackedTask(board.current) ?? board.current,
  };
  const target = sessionTaskBoardPath(sessionFile);
  const tmp = `${target}.${process.pid}.${randomUUID()}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(normalized)}\n`, "utf8");
  fs.renameSync(tmp, target);
}

export function readSessionTaskBoard(sessionFile?: string): SessionTaskBoard {
  return readSessionTaskBoardUnlocked(sessionFile);
}

export class StaleSessionTaskBoardWriteError extends Error {
  readonly claimedEpoch: number | undefined;
  readonly diskEpoch: number;
  constructor(claimedEpoch: number | undefined, diskEpoch: number) {
    super(
      `stale session task board write: claimed writeEpoch=${String(claimedEpoch)} disk=${diskEpoch}`,
    );
    this.name = "StaleSessionTaskBoardWriteError";
    this.claimedEpoch = claimedEpoch;
    this.diskEpoch = diskEpoch;
  }
}

/**
 * Locked read → mutate → write. Production RMW must use this (or commitSameTaskConstraint /
 * commitBoardMutation). Never read outside the lock and call writeSessionTaskBoard with a snapshot.
 */
export function mutateSessionTaskBoard<T>(
  sessionFile: string,
  mutate: (live: SessionTaskBoard) => { board: SessionTaskBoard; value: T },
): T {
  return withSessionTaskBoardLock(sessionFile, () => {
    const live = readSessionTaskBoardUnlocked(sessionFile);
    const { board, value } = mutate(live);
    writeSessionTaskBoardUnlocked(sessionFile, board);
    return value;
  });
}

/**
 * Fixture/bootstrap replace under the same file lock, without writeEpoch CAS.
 * Runtime production paths must not call this — use mutateSessionTaskBoard /
 * commitSameTaskConstraint / commitBoardMutation.
 */
export function seedSessionTaskBoard(sessionFile: string, board: SessionTaskBoard): void {
  withSessionTaskBoardLock(sessionFile, () => {
    writeSessionTaskBoardUnlocked(sessionFile, board);
  });
}

/**
 * Locked write with explicit writeEpoch compare-and-set against the on-disk board.
 * - Empty / epoch-0 disk: bootstrap allowed without a claimed epoch.
 * - Non-zero disk epoch: caller must pass board.writeEpoch equal to disk; otherwise throws
 *   StaleSessionTaskBoardWriteError (closes the stale-snapshot overwrite window).
 * Production RMW should prefer mutateSessionTaskBoard so the mutate fn sees the live board.
 */
export function writeSessionTaskBoard(sessionFile: string, board: SessionTaskBoard): void {
  withSessionTaskBoardLock(sessionFile, () => {
    const disk = readSessionTaskBoardUnlocked(sessionFile);
    const diskEpoch = typeof disk.writeEpoch === "number" ? disk.writeEpoch : 0;
    const claimed = board.writeEpoch;
    if (diskEpoch > 0 && claimed !== diskEpoch) {
      throw new StaleSessionTaskBoardWriteError(claimed, diskEpoch);
    }
    writeSessionTaskBoardUnlocked(sessionFile, board);
  });
}

export function cloneBoardShell(board: SessionTaskBoard): SessionTaskBoard {
  return {
    current: board.current,
    parked: [...board.parked],
    focusRevision: board.focusRevision ?? 0,
    ...(typeof board.writeEpoch === "number" ? { writeEpoch: board.writeEpoch } : {}),
    ...(board.tombstones ? { tombstones: [...board.tombstones] } : {}),
    ...(board.archived ? { archived: [...board.archived] } : {}),
    ...(board.scope ? { scope: { ...board.scope } } : {}),
  };
}
