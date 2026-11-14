/**
 * Coordinated limited landing: controlled atomic mutations for
 * SessionTaskBoard.runtimeRuleAdaptationByTaskId.
 *
 * This module is the state mutation entry for P3 activate / revoke / rollback.
 * It wraps the official SessionTaskBoard lock and writeEpoch semantics already
 * provided by mutateSessionTaskBoard / withSessionTaskBoardLock. A rejected
 * mutation may skip the write so the disk and writeEpoch stay unchanged
 * (mutateSessionTaskBoard always writes, so it cannot host the abort path).
 *
 * Not registered as exclusive to runtime-rule-adaptation. Official owners of
 * src/agent-runtime/state/** remain the open Loom tasks recorded in the
 * limited-landing evidence. No second persistence file or transaction framework.
 */
import type { SessionTaskBoard } from "../../contracts/task.js";
import {
  readSessionTaskBoard,
  readSessionTaskBoardUnlocked,
  withSessionTaskBoardLock,
  writeSessionTaskBoardUnlocked,
} from "../repository/task-board-file.js";

export type RuntimeRuleAdaptationBoardIo = {
  withLock: typeof withSessionTaskBoardLock;
  readUnlocked: typeof readSessionTaskBoardUnlocked;
  writeUnlocked: typeof writeSessionTaskBoardUnlocked;
  read: typeof readSessionTaskBoard;
};

export const officialRuntimeRuleAdaptationBoardIo: RuntimeRuleAdaptationBoardIo = {
  withLock: withSessionTaskBoardLock,
  readUnlocked: readSessionTaskBoardUnlocked,
  writeUnlocked: writeSessionTaskBoardUnlocked,
  read: readSessionTaskBoard,
};

export function readRuntimeRuleAdaptationBoard(
  sessionFile: string,
  io: RuntimeRuleAdaptationBoardIo = officialRuntimeRuleAdaptationBoardIo,
): SessionTaskBoard {
  return io.read(sessionFile);
}

export type RuntimeRuleAdaptationBoardMutation<T> =
  | { action: "abort"; value: T }
  | {
      action: "write";
      board: SessionTaskBoard;
      value: (written: SessionTaskBoard) => T;
    };

/**
 * Locked re-read, optional CAS write, and post-write re-read.
 * Command organizes the use case and must not hold the board lock or perform
 * bare repository I/O for these transactions.
 */
export function mutateRuntimeRuleAdaptationBoard<T>(
  sessionFile: string,
  mutate: (live: SessionTaskBoard) => RuntimeRuleAdaptationBoardMutation<T>,
  io: RuntimeRuleAdaptationBoardIo = officialRuntimeRuleAdaptationBoardIo,
): T {
  return io.withLock(sessionFile, () => {
    const live = io.readUnlocked(sessionFile);
    const decision = mutate(live);
    if (decision.action === "abort") {
      return decision.value;
    }
    io.writeUnlocked(sessionFile, decision.board);
    const written = io.readUnlocked(sessionFile);
    return decision.value(written);
  });
}
