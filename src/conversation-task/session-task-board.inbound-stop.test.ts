/**
 * P2: stop protection through real inbound applyIncomingUserMessage + claim.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  applyIncomingUserMessage,
  emptySessionTaskBoard,
  readSessionTaskBoard,
  writeSessionTaskBoard,
} from "./session-task-board.js";
import { claimTaskBoardContinue } from "./task-board-continue.js";

describe("inbound stop / cancel / same-task revise → claim", () => {
  let tmpDir = "";
  let sessionFile = "";

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "inbound-stop-"));
    sessionFile = path.join(tmpDir, "session.jsonl");
    fs.writeFileSync(sessionFile, "", "utf8");
    const board = emptySessionTaskBoard();
    board.focusRevision = 3;
    board.current = {
      taskId: "task-a",
      title: "手机调研",
      goalText: "调研国内手机市场并写报告",
      unfinished: true,
      stop: { summary: "旧计划：先写竞品表", workspacePaths: [] },
      createdAtMs: Date.now(),
    };
    writeSessionTaskBoard(sessionFile, board);
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("owner 暂停 → wakeSuppress → claim rejects", () => {
    const result = applyIncomingUserMessage({
      board: readSessionTaskBoard(sessionFile),
      incomingText: "暂停",
    });
    writeSessionTaskBoard(sessionFile, result.board);
    expect(result.board.current?.wakeSuppress).toBe(true);
    expect(result.board.focusRevision).toBe(3);
    const claim = claimTaskBoardContinue({
      sessionFile,
      taskId: "task-a",
      focusRevision: 3,
    });
    expect(claim.ok).toBe(false);
    if (!claim.ok) {
      expect(claim.reason).toBe("wake_suppress");
    }
  });

  it("owner 取消当前 → tombstone → claim rejects", () => {
    const result = applyIncomingUserMessage({
      board: readSessionTaskBoard(sessionFile),
      incomingText: "取消当前",
    });
    writeSessionTaskBoard(sessionFile, result.board);
    expect(result.board.current).toBeUndefined();
    expect(result.board.tombstones?.some((t) => t.taskId === "task-a")).toBe(true);
    const claim = claimTaskBoardContinue({
      sessionFile,
      taskId: "task-a",
      focusRevision: 3,
    });
    expect(claim.ok).toBe(false);
    if (!claim.ok) {
      expect(["tombstoned", "no_unfinished_current"]).toContain(claim.reason);
    }
  });

  it("same-task amend updates stop; claim prompt follows revised plan (no rev bump)", () => {
    const result = applyIncomingUserMessage({
      board: readSessionTaskBoard(sessionFile),
      incomingText: "补充：只要国内安卓机型",
    });
    writeSessionTaskBoard(sessionFile, result.board);
    expect(result.board.focusRevision).toBe(3);
    expect(result.board.current?.stop.summary).toContain("约束：");
    expect(result.board.current?.stop.summary).toContain("旧计划");
    const claim = claimTaskBoardContinue({
      sessionFile,
      taskId: "task-a",
      focusRevision: 3,
    });
    expect(claim.ok).toBe(true);
    if (claim.ok) {
      // Live rebuild must carry the new constraint; prior stop may remain after ｜.
      expect(claim.prompt).toMatch(/约束：.*只要国内/);
      expect(claim.prompt.indexOf("约束：")).toBeLessThan(
        claim.prompt.indexOf("旧计划：先写竞品表"),
      );
    }
  });
});
