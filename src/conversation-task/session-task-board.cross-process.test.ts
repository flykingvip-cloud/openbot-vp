/**
 * True cross-process races on session task board writes.
 * Sequential stale-epoch checks are not sufficient — these spawn OS processes.
 * Assertions check constraints / tombstones / cancellation — not only writeEpoch.
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  activeConstraintTexts,
  emptySessionTaskBoard,
  isTaskTombstoned,
  readSessionTaskBoard,
  seedSessionTaskBoard,
  StaleSessionTaskBoardWriteError,
  writeSessionTaskBoard,
} from "./session-task-board.js";

const CHILD = path.resolve("src/conversation-task/session-task-board.cross-process-child.ts");

function spawnChild(env: Record<string, string>): Promise<{
  code: number | null;
  stdout: string;
  stderr: string;
}> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["--import", "tsx", CHILD], {
      env: { ...process.env, ...env },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });
    child.on("error", reject);
    child.on("close", (code) => {
      resolve({ code, stdout, stderr });
    });
  });
}

function seedActiveTask(sessionFile: string): void {
  const board = emptySessionTaskBoard();
  board.focusRevision = 1;
  board.current = {
    taskId: "task-a",
    title: "手机调研",
    goalText: "调研国内手机市场并写报告",
    unfinished: true,
    stop: { summary: "正在抓取评测站点", workspacePaths: [] },
    createdAtMs: Date.now(),
  };
  seedSessionTaskBoard(sessionFile, board);
}

describe("session task board cross-process lock", () => {
  let tmpDir = "";
  let sessionFile = "";

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "board-xproc-"));
    sessionFile = path.join(tmpDir, "session.jsonl");
    fs.writeFileSync(sessionFile, "", "utf8");
    seedActiveTask(sessionFile);
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("two processes concurrent commits: both land, writeEpoch monotonic, no lost rows", async () => {
    const rounds = 25;
    const [left, right] = await Promise.all([
      spawnChild({
        BOARD_SESSION_FILE: sessionFile,
        BOARD_MODE: "constraint",
        BOARD_TASK_ID: "task-a",
        BOARD_CONSTRAINT: "补充：进程甲约束",
        BOARD_ROUNDS: String(rounds),
      }),
      spawnChild({
        BOARD_SESSION_FILE: sessionFile,
        BOARD_MODE: "constraint",
        BOARD_TASK_ID: "task-a",
        BOARD_CONSTRAINT: "补充：进程乙约束",
        BOARD_ROUNDS: String(rounds),
      }),
    ]);
    expect(left.code, left.stderr).toBe(0);
    expect(right.code, right.stderr).toBe(0);
    const leftResult = JSON.parse(left.stdout) as {
      ok: number;
      fail: number;
      writeEpoch: number;
    };
    const rightResult = JSON.parse(right.stdout) as {
      ok: number;
      fail: number;
      writeEpoch: number;
    };
    expect(leftResult.ok + rightResult.ok).toBe(rounds * 2);
    expect(leftResult.fail + rightResult.fail).toBe(0);

    const finalBoard = readSessionTaskBoard(sessionFile);
    const active = activeConstraintTexts(finalBoard.current);
    expect(active.filter((t) => t.includes("进程甲约束")).length).toBe(rounds);
    expect(active.filter((t) => t.includes("进程乙约束")).length).toBe(rounds);
    expect(finalBoard.writeEpoch ?? 0).toBeGreaterThanOrEqual(1 + rounds * 2);
    const lockPath = `${sessionFile}.task-board.json.lock`;
    expect(fs.existsSync(lockPath)).toBe(false);
  }, 60_000);

  it("constraint commit vs task completion: landed constraints survive; no silent wipe", async () => {
    const rounds = 40;
    const [writer, completer] = await Promise.all([
      spawnChild({
        BOARD_SESSION_FILE: sessionFile,
        BOARD_MODE: "constraint",
        BOARD_TASK_ID: "task-a",
        BOARD_CONSTRAINT: "补充：完成交叉约束",
        BOARD_ROUNDS: String(rounds),
      }),
      spawnChild({
        BOARD_SESSION_FILE: sessionFile,
        BOARD_MODE: "complete",
        BOARD_ROUNDS: "80",
      }),
    ]);
    expect(writer.code, writer.stderr).toBe(0);
    expect(completer.code, completer.stderr).toBe(0);
    const writeResult = JSON.parse(writer.stdout) as { ok: number; fail: number };
    const completeResult = JSON.parse(completer.stdout) as {
      ok: number;
      unfinished: boolean | null;
    };
    expect(completeResult.ok).toBeGreaterThanOrEqual(1);
    expect(completeResult.unfinished).toBe(false);

    const finalBoard = readSessionTaskBoard(sessionFile);
    expect(finalBoard.current?.taskId).toBe("task-a");
    expect(finalBoard.current?.unfinished).toBe(false);
    // Constraints that committed while unfinished must remain on the finished current.
    // Writers may fail after completion — only assert no loss of successful commits.
    const active = activeConstraintTexts(finalBoard.current);
    expect(active.filter((t) => t.includes("完成交叉约束")).length).toBe(writeResult.ok);
    expect(writeResult.ok + writeResult.fail).toBe(rounds);
  }, 60_000);

  it("constraint commit vs cancel: tombstone kept; cancelled task does not resurrect", async () => {
    const rounds = 40;
    const [writer, canceler] = await Promise.all([
      spawnChild({
        BOARD_SESSION_FILE: sessionFile,
        BOARD_MODE: "constraint",
        BOARD_TASK_ID: "task-a",
        BOARD_CONSTRAINT: "补充：取消交叉约束",
        BOARD_ROUNDS: String(rounds),
      }),
      spawnChild({
        BOARD_SESSION_FILE: sessionFile,
        BOARD_MODE: "cancel",
        BOARD_ROUNDS: "80",
      }),
    ]);
    expect(writer.code, writer.stderr).toBe(0);
    expect(canceler.code, canceler.stderr).toBe(0);
    const cancelResult = JSON.parse(canceler.stdout) as {
      applied: boolean;
      currentTaskId: string | null;
      tombstoneIds: string[];
    };
    expect(cancelResult.applied).toBe(true);

    const finalBoard = readSessionTaskBoard(sessionFile);
    expect(finalBoard.current).toBeUndefined();
    expect(isTaskTombstoned(finalBoard, "task-a")).toBe(true);
    expect(cancelResult.tombstoneIds).toContain("task-a");
    // Cancelled focus must not be revived by a stale constraint/completer snapshot.
    expect(finalBoard.current?.taskId).not.toBe("task-a");
  }, 60_000);

  it("constraint commit vs pause: wakeSuppress set; constraints that landed are kept", async () => {
    const rounds = 40;
    const [writer, pauser] = await Promise.all([
      spawnChild({
        BOARD_SESSION_FILE: sessionFile,
        BOARD_MODE: "constraint",
        BOARD_TASK_ID: "task-a",
        BOARD_CONSTRAINT: "补充：暂停交叉约束",
        BOARD_ROUNDS: String(rounds),
      }),
      spawnChild({
        BOARD_SESSION_FILE: sessionFile,
        BOARD_MODE: "pause",
        BOARD_ROUNDS: "80",
      }),
    ]);
    expect(writer.code, writer.stderr).toBe(0);
    expect(pauser.code, pauser.stderr).toBe(0);
    const writeResult = JSON.parse(writer.stdout) as { ok: number };
    const pauseResult = JSON.parse(pauser.stdout) as {
      applied: boolean;
      wakeSuppress: boolean | null;
    };
    expect(pauseResult.applied).toBe(true);

    const finalBoard = readSessionTaskBoard(sessionFile);
    expect(finalBoard.current?.taskId).toBe("task-a");
    expect(finalBoard.current?.wakeSuppress).toBe(true);
    const active = activeConstraintTexts(finalBoard.current);
    expect(active.filter((t) => t.includes("暂停交叉约束")).length).toBe(writeResult.ok);
  }, 60_000);

  it("constraint commit vs focus switch: parked A keeps landed constraints; B is current", async () => {
    const rounds = 40;
    const [writer, switcher] = await Promise.all([
      spawnChild({
        BOARD_SESSION_FILE: sessionFile,
        BOARD_MODE: "constraint",
        BOARD_TASK_ID: "task-a",
        BOARD_CONSTRAINT: "补充：切换交叉约束",
        BOARD_ROUNDS: String(rounds),
      }),
      spawnChild({
        BOARD_SESSION_FILE: sessionFile,
        BOARD_MODE: "switch",
        BOARD_ROUNDS: "80",
        BOARD_INCOMING_TEXT:
          "另外帮我审查这份供应商合同，重点看违约责任和付款条款，这是完全不同的任务。",
      }),
    ]);
    expect(writer.code, writer.stderr).toBe(0);
    expect(switcher.code, switcher.stderr).toBe(0);
    const writeResult = JSON.parse(writer.stdout) as { ok: number; fail: number };
    const switchResult = JSON.parse(switcher.stdout) as {
      switched: boolean;
      currentTaskId: string | null;
      parkedIds: string[];
      parkedConstraintTexts: string[];
    };
    expect(switchResult.switched).toBe(true);

    const finalBoard = readSessionTaskBoard(sessionFile);
    expect(finalBoard.current?.taskId).not.toBe("task-a");
    const parkedA = finalBoard.parked.find((row) => row.taskId === "task-a");
    // If switch happened after some commits, those commits must sit on parked A — not vanish.
    // Commits after switch fail (expectedTaskId mismatch) and must not recreate A as current.
    expect(finalBoard.current?.taskId).not.toBe("task-a");
    if (writeResult.ok > 0 && parkedA) {
      const parkedActive = activeConstraintTexts(parkedA);
      expect(parkedActive.filter((t) => t.includes("切换交叉约束")).length).toBeGreaterThan(0);
      // Successful commits should equal parked rows when all commits preceded or interleaved safely.
      expect(parkedActive.filter((t) => t.includes("切换交叉约束")).length).toBe(writeResult.ok);
    } else if (writeResult.ok > 0) {
      // Switch might have archived A under heavy parking pressure — still must not resurrect as current.
      expect(finalBoard.current?.taskId).not.toBe("task-a");
      const archived = (finalBoard.archived ?? []).find((row) => row.taskId === "task-a");
      const elsewhere = [
        ...activeConstraintTexts(parkedA),
        ...activeConstraintTexts(archived),
        ...activeConstraintTexts(finalBoard.current),
      ];
      expect(elsewhere.some((t) => t.includes("切换交叉约束"))).toBe(true);
    }
    expect(writeResult.ok + writeResult.fail).toBe(rounds);
  }, 60_000);

  it("stale snapshot writeSessionTaskBoard is rejected while peer commits constraints", async () => {
    const [writer, stale] = await Promise.all([
      spawnChild({
        BOARD_SESSION_FILE: sessionFile,
        BOARD_MODE: "constraint",
        BOARD_TASK_ID: "task-a",
        BOARD_CONSTRAINT: "补充：防陈旧覆盖",
        BOARD_ROUNDS: "30",
      }),
      spawnChild({
        BOARD_SESSION_FILE: sessionFile,
        BOARD_MODE: "stale_write",
        BOARD_STALE_DELAY_MS: "20",
      }),
    ]);
    expect(writer.code, writer.stderr).toBe(0);
    expect(stale.code, stale.stderr).toBe(0);
    const writeResult = JSON.parse(writer.stdout) as { ok: number };
    const staleResult = JSON.parse(stale.stdout) as {
      rejected: boolean;
      errorName: string;
      activeCount: number;
    };
    expect(staleResult.rejected).toBe(true);
    expect(staleResult.errorName).toBe("StaleSessionTaskBoardWriteError");
    expect(writeResult.ok).toBe(30);

    const finalBoard = readSessionTaskBoard(sessionFile);
    const active = activeConstraintTexts(finalBoard.current);
    expect(active.filter((t) => t.includes("防陈旧覆盖")).length).toBe(30);
  }, 60_000);

  it("in-process writeSessionTaskBoard rejects missing/stale writeEpoch against live disk", () => {
    const live = readSessionTaskBoard(sessionFile);
    expect(live.writeEpoch ?? 0).toBeGreaterThan(0);
    const stale = {
      ...live,
      current: {
        ...live.current!,
        stop: { summary: "should not land", workspacePaths: [] },
      },
    };
    delete (stale as { writeEpoch?: number }).writeEpoch;
    expect(() => writeSessionTaskBoard(sessionFile, stale)).toThrow(
      StaleSessionTaskBoardWriteError,
    );

    const mismatched = { ...live, writeEpoch: (live.writeEpoch ?? 0) - 1 };
    expect(() => writeSessionTaskBoard(sessionFile, mismatched)).toThrow(
      StaleSessionTaskBoardWriteError,
    );

    // Matching epoch still allowed (CAS success path).
    writeSessionTaskBoard(sessionFile, {
      ...live,
      writeEpoch: live.writeEpoch,
      current: {
        ...live.current!,
        stop: { summary: "cas-ok", workspacePaths: [] },
      },
    });
    expect(readSessionTaskBoard(sessionFile).current?.stop.summary).toBe("cas-ok");
  });
});
