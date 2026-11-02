/**
 * True cross-process race on session task board writes.
 * Sequential stale-epoch checks are not sufficient — this spawns two OS processes.
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  activeConstraintTexts,
  emptySessionTaskBoard,
  readSessionTaskBoard,
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

describe("session task board cross-process lock", () => {
  let tmpDir = "";
  let sessionFile = "";

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "board-xproc-"));
    sessionFile = path.join(tmpDir, "session.jsonl");
    fs.writeFileSync(sessionFile, "", "utf8");
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
    writeSessionTaskBoard(sessionFile, board);
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("two processes concurrent commits: both land, writeEpoch monotonic, no lost rows", async () => {
    const rounds = 25;
    const [left, right] = await Promise.all([
      spawnChild({
        BOARD_SESSION_FILE: sessionFile,
        BOARD_TASK_ID: "task-a",
        BOARD_CONSTRAINT: "补充：进程甲约束",
        BOARD_ROUNDS: String(rounds),
      }),
      spawnChild({
        BOARD_SESSION_FILE: sessionFile,
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
    // Initial writeSessionTaskBoard bumped once; then 50 commits → epoch >= 1 + 50
    expect(finalBoard.writeEpoch ?? 0).toBeGreaterThanOrEqual(1 + rounds * 2);
    // Lock file must not be left behind
    const lockPath = `${sessionFile}.task-board.json.lock`;
    expect(fs.existsSync(lockPath)).toBe(false);
  }, 60_000);
});
