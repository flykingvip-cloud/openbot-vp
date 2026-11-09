/**
 * Child worker for cross-process board lock races (slice3).
 * Env:
 *   BOARD_SESSION_FILE (required)
 *   BOARD_MODE = constraint | complete | cancel | pause | switch | stale_write
 *   BOARD_TASK_ID, BOARD_CONSTRAINT, BOARD_ROUNDS (constraint)
 *   BOARD_INCOMING_TEXT (switch)
 */
import {
  applyIncomingUserMessage,
  activeConstraintTexts,
  commitSameTaskConstraint,
  mutateSessionTaskBoard,
  readSessionTaskBoard,
  recordCheckedTaskCompletion,
  captureTaskCompletionBinding,
  writeSessionTaskBoard,
  type SessionTaskBoard,
} from "./session-task-board.js";

const sessionFile = process.env.BOARD_SESSION_FILE?.trim() ?? "";
const mode = (process.env.BOARD_MODE?.trim() || "constraint").toLowerCase();
const taskId = process.env.BOARD_TASK_ID?.trim() ?? "";
const constraint = process.env.BOARD_CONSTRAINT?.trim() ?? "";
const rounds = Math.max(1, Number(process.env.BOARD_ROUNDS ?? "20"));
const incomingText = process.env.BOARD_INCOMING_TEXT?.trim() ?? "";

if (!sessionFile) {
  process.stderr.write("missing BOARD_SESSION_FILE\n");
  process.exit(2);
}

function snapshot(): SessionTaskBoard {
  return readSessionTaskBoard(sessionFile);
}

if (mode === "constraint") {
  if (!taskId || !constraint) {
    process.stderr.write("constraint mode needs BOARD_TASK_ID / BOARD_CONSTRAINT\n");
    process.exit(2);
  }
  let ok = 0;
  let fail = 0;
  for (let i = 0; i < rounds; i += 1) {
    const text = `${constraint}#${process.pid}-${i}`;
    const succeeded = commitSameTaskConstraint({
      sessionFile,
      constraintText: text,
      expectedTaskId: taskId,
    });
    if (succeeded) {
      ok += 1;
    } else {
      fail += 1;
    }
  }
  const board = snapshot();
  process.stdout.write(
    JSON.stringify({
      mode,
      pid: process.pid,
      ok,
      fail,
      writeEpoch: board.writeEpoch ?? 0,
      activeCount: (board.current?.effectiveConstraints ?? []).length,
    }),
  );
  process.exit(0);
}

if (mode === "complete") {
  // Busy-loop complete attempts interleaved with constraint writers.
  // Never let lock/stale throws kill the child mid-loop (stdout must stay JSON).
  let ok = 0;
  let fail = 0;
  for (let i = 0; i < rounds; i += 1) {
    try {
      const result = recordCheckedTaskCompletion({
        sessionFile,
        closed: true,
        binding: captureTaskCompletionBinding(sessionFile),
      });
      if (result.persisted) {
        ok += 1;
        break;
      }
      fail += 1;
    } catch {
      fail += 1;
    }
  }
  const board = snapshot();
  process.stdout.write(
    JSON.stringify({
      mode,
      pid: process.pid,
      ok,
      fail,
      unfinished: board.current?.unfinished ?? null,
      writeEpoch: board.writeEpoch ?? 0,
      constraintCount: board.current?.effectiveConstraints?.length ?? 0,
    }),
  );
  process.exit(0);
}

if (mode === "cancel" || mode === "pause") {
  const text = mode === "cancel" ? "取消当前任务" : "暂停";
  let applied = false;
  for (let i = 0; i < rounds; i += 1) {
    try {
      const result = mutateSessionTaskBoard(sessionFile, (board) => {
        const next = applyIncomingUserMessage({ board, incomingText: text });
        return { board: next.board, value: next };
      });
      if (mode === "cancel" && result.action === "cancel_parked") {
        applied = true;
        break;
      }
      if (mode === "pause" && result.abortInFlight) {
        // Confirm disk retained wakeSuppress before claiming applied (writer races).
        if (snapshot().current?.wakeSuppress === true) {
          applied = true;
          break;
        }
      }
    } catch {
      // lock timeout / stale — retry
    }
  }
  const board = snapshot();
  process.stdout.write(
    JSON.stringify({
      mode,
      pid: process.pid,
      applied,
      currentTaskId: board.current?.taskId ?? null,
      wakeSuppress: board.current?.wakeSuppress ?? null,
      tombstoneIds: (board.tombstones ?? []).map((row) => row.taskId),
      writeEpoch: board.writeEpoch ?? 0,
      activeConstraints: activeConstraintTexts(board.current),
      parkedConstraints: board.parked.flatMap((row) => activeConstraintTexts(row)),
    }),
  );
  process.exit(0);
}

if (mode === "switch") {
  const text =
    incomingText || "另外帮我审查这份供应商合同，重点看违约责任和付款条款，这是完全不同的任务。";
  let switched = false;
  for (let i = 0; i < rounds; i += 1) {
    const result = mutateSessionTaskBoard(sessionFile, (board) => {
      const next = applyIncomingUserMessage({ board, incomingText: text });
      return { board: next.board, value: next };
    });
    if (result.action === "switch" || result.action === "resume") {
      switched = true;
      break;
    }
  }
  const board = snapshot();
  process.stdout.write(
    JSON.stringify({
      mode,
      pid: process.pid,
      switched,
      currentTaskId: board.current?.taskId ?? null,
      parkedIds: board.parked.map((row) => row.taskId),
      writeEpoch: board.writeEpoch ?? 0,
      parkedConstraintTexts: board.parked.flatMap((row) => activeConstraintTexts(row)),
      currentConstraintTexts: activeConstraintTexts(board.current),
    }),
  );
  process.exit(0);
}

if (mode === "stale_write") {
  // Read a snapshot, wait briefly while peer commits, then try blind overwrite.
  const stale = snapshot();
  const delayMs = Math.max(5, Number(process.env.BOARD_STALE_DELAY_MS ?? "30"));
  const until = Date.now() + delayMs;
  while (Date.now() < until) {
    /* spin so peer constraint commits can land */
  }
  let rejected = false;
  let errorName = "";
  try {
    // Drop writeEpoch to simulate the historical production bug (blind snapshot write).
    const { writeEpoch: _ignored, ...withoutEpoch } = stale;
    writeSessionTaskBoard(sessionFile, withoutEpoch as typeof stale);
  } catch (err) {
    rejected = true;
    errorName = err instanceof Error ? err.name : "unknown";
  }
  const board = snapshot();
  process.stdout.write(
    JSON.stringify({
      mode,
      pid: process.pid,
      rejected,
      errorName,
      writeEpoch: board.writeEpoch ?? 0,
      activeCount: (board.current?.effectiveConstraints ?? []).length,
    }),
  );
  process.exit(0);
}

process.stderr.write(`unknown BOARD_MODE=${mode}\n`);
process.exit(2);
