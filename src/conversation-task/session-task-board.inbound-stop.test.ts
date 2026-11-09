/**
 * Stop protection through explicit control parsing + locked state mutation + claim.
 * Also covers full (non-truncated) constraint persistence and abortInFlight signaling.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { parseExplicitTaskControl } from "../agent-runtime/policy/index.js";
import { sessionTaskState } from "../agent-runtime/state/index.js";
import {
  activeConstraintTexts,
  emptySessionTaskBoard,
  readSessionTaskBoard,
  seedSessionTaskBoard,
} from "./session-task-board.js";
import { claimTaskBoardContinue } from "./task-board-continue.js";
import { shouldTaskParkAbortInFlight } from "./turn-relation.js";

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
    seedSessionTaskBoard(sessionFile, board);
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("owner 暂停 → wakeSuppress + abortInFlight → claim rejects", () => {
    const control = parseExplicitTaskControl("暂停");
    if (!control) {
      throw new Error("explicit pause must parse");
    }
    const result = sessionTaskState.applyExplicitControl({
      sessionFile,
      control,
      recheck: { authOk: true, stopActive: false },
    });
    if (!result) {
      throw new Error("explicit pause must update existing board");
    }
    expect(readSessionTaskBoard(sessionFile).current?.wakeSuppress).toBe(true);
    expect(result.board.current?.wakeSuppress).toBe(true);
    expect(result.abortInFlight).toBe(true);
    expect(shouldTaskParkAbortInFlight(result.cutContext, result.abortInFlight)).toBe(true);
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

  it("owner 取消当前 → tombstone + abortInFlight → claim rejects", () => {
    const control = parseExplicitTaskControl("取消当前");
    if (!control) {
      throw new Error("explicit cancel must parse");
    }
    const result = sessionTaskState.applyExplicitControl({
      sessionFile,
      control,
      recheck: { authOk: true, stopActive: false },
    });
    if (!result) {
      throw new Error("explicit cancel must update existing board");
    }
    expect(readSessionTaskBoard(sessionFile).current).toBeUndefined();
    expect(result.board.current).toBeUndefined();
    expect(result.abortInFlight).toBe(true);
    expect(shouldTaskParkAbortInFlight(result.cutContext, result.abortInFlight)).toBe(true);
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

  it("same-task amend keeps full constraint past 48 chars for resume/claim", () => {
    const longTail =
      "补充：只要国内安卓机型，并且本次调研的关键限制条件必须完整保留；下列限制必须出现在第四十八个字符之后才能生效——禁止引用任何海外评测站点的份额数据";
    expect(longTail.length).toBeGreaterThan(48);
    const critical = "禁止引用任何海外评测站点的份额数据";
    expect(longTail.indexOf(critical)).toBeGreaterThan(47);

    const before = readSessionTaskBoard(sessionFile);
    const result = sessionTaskState.applyInteractionProposal({
      sessionFile,
      expectedFocusRevision: before.focusRevision,
      expectedWriteEpoch: before.writeEpoch ?? 0,
      decision: {
        kind: "task_change",
        target: { taskId: "task-a", revision: String(before.writeEpoch ?? 0) },
        text: longTail,
        mode: "supplement",
      },
    });
    expect(result.kind).toBe("applied");
    const after = readSessionTaskBoard(sessionFile);
    expect(after.focusRevision).toBe(3);
    const stored = activeConstraintTexts(after.current);
    expect(stored.some((row) => row.includes(critical))).toBe(true);
    // Display marker may truncate, but persistence must keep the full text.
    expect(stored.join("\n")).toContain(critical);
    expect(after.current?.stop.summary).toContain("约束：");

    const claim = claimTaskBoardContinue({
      sessionFile,
      taskId: "task-a",
      focusRevision: 3,
    });
    expect(claim.ok).toBe(true);
    if (claim.ok) {
      expect(claim.prompt).toContain(critical);
      expect(claim.prompt).toContain("有效约束");
    }
  });
});
