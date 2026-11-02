/**
 * Child worker for cross-process board lock race (slice3).
 * Env: BOARD_SESSION_FILE, BOARD_TASK_ID, BOARD_CONSTRAINT, BOARD_ROUNDS
 */
import { commitSameTaskConstraint, readSessionTaskBoard } from "./session-task-board.js";

const sessionFile = process.env.BOARD_SESSION_FILE?.trim() ?? "";
const taskId = process.env.BOARD_TASK_ID?.trim() ?? "";
const constraint = process.env.BOARD_CONSTRAINT?.trim() ?? "";
const rounds = Math.max(1, Number(process.env.BOARD_ROUNDS ?? "20"));

if (!sessionFile || !taskId || !constraint) {
  process.stderr.write("missing BOARD_SESSION_FILE / BOARD_TASK_ID / BOARD_CONSTRAINT\n");
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

const board = readSessionTaskBoard(sessionFile);
process.stdout.write(
  JSON.stringify({
    pid: process.pid,
    ok,
    fail,
    writeEpoch: board.writeEpoch ?? 0,
    activeCount: (board.current?.effectiveConstraints ?? []).length,
  }),
);
