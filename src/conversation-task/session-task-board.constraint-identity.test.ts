/**
 * Constraint updates must bind to the receiving task identity.
 * A mid-flight focus switch must not write task-A constraints onto task-B;
 * persist failure returns false (caller must not claim full success).
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  appendSameTaskConstraint,
  commitSameTaskConstraint,
  emptySessionTaskBoard,
  readSessionTaskBoard,
  writeSessionTaskBoard,
} from "./session-task-board.js";

describe("commitSameTaskConstraint task identity", () => {
  let tmpDir = "";
  let sessionFile = "";

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "constraint-id-"));
    sessionFile = path.join(tmpDir, "session.jsonl");
    fs.writeFileSync(sessionFile, "", "utf8");
    const board = emptySessionTaskBoard();
    board.current = {
      taskId: "task-a",
      title: "手机调研",
      goalText: "调研国内手机市场并写报告",
      unfinished: true,
      stop: { summary: "进行中", workspacePaths: [] },
      createdAtMs: Date.now(),
    };
    writeSessionTaskBoard(sessionFile, board);
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("persists when expectedTaskId still matches current unfinished task", () => {
    const ok = commitSameTaskConstraint({
      sessionFile,
      constraintText: "补充：只要国内安卓机型",
      expectedTaskId: "task-a",
    });
    expect(ok).toBe(true);
    const board = readSessionTaskBoard(sessionFile);
    expect(board.current?.taskId).toBe("task-a");
    expect(board.current?.effectiveConstraints?.join("\n")).toContain("只要国内安卓机型");
  });

  it("refuses to write when current task switched to B (A constraint must not land on B)", () => {
    const switched = emptySessionTaskBoard();
    switched.focusRevision = 2;
    switched.current = {
      taskId: "task-b",
      title: "合同审查",
      goalText: "审查供应商合同",
      unfinished: true,
      stop: { summary: "新焦点", workspacePaths: [] },
      createdAtMs: Date.now(),
    };
    writeSessionTaskBoard(sessionFile, switched);

    const ok = commitSameTaskConstraint({
      sessionFile,
      constraintText: "补充：只要国内安卓机型——这是给 A 的约束",
      expectedTaskId: "task-a",
    });
    expect(ok).toBe(false);
    const board = readSessionTaskBoard(sessionFile);
    expect(board.current?.taskId).toBe("task-b");
    expect(board.current?.effectiveConstraints ?? []).toEqual([]);
    expect(JSON.stringify(board)).not.toContain("只要国内安卓机型");
  });

  it("returns false when expectedTaskId is empty or board has no unfinished current", () => {
    expect(
      commitSameTaskConstraint({
        sessionFile,
        constraintText: "补充：x",
        expectedTaskId: "",
      }),
    ).toBe(false);

    writeSessionTaskBoard(sessionFile, emptySessionTaskBoard());
    expect(
      commitSameTaskConstraint({
        sessionFile,
        constraintText: "补充：x",
        expectedTaskId: "task-a",
      }),
    ).toBe(false);
  });

  it("returns false when writeSessionTaskBoard throws (persist failure)", () => {
    const spy = vi.spyOn(fs, "writeFileSync").mockImplementation(() => {
      throw new Error("disk full");
    });
    try {
      // Force a path that will attempt write: append then write.
      // If write fails inside commit, result must be false.
      const ok = commitSameTaskConstraint({
        sessionFile,
        constraintText: "补充：关键限制必须完整保留",
        expectedTaskId: "task-a",
      });
      expect(ok).toBe(false);
    } finally {
      spy.mockRestore();
    }
    // Board must not be half-updated via a successful prior write in this process.
    // Re-read: either unchanged or still without the new constraint if write never landed.
    const board = readSessionTaskBoard(sessionFile);
    const joined = board.current?.effectiveConstraints?.join("\n") ?? "";
    expect(joined).not.toContain("关键限制必须完整保留");
  });

  it("appendSameTaskConstraint alone never switches task identity", () => {
    const board = readSessionTaskBoard(sessionFile);
    const next = appendSameTaskConstraint({
      board,
      constraintText: "补充：保留原目标",
    });
    expect(next.current?.taskId).toBe("task-a");
  });
});
