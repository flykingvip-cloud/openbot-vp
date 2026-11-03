import { describe, expect, it } from "vitest";
import { emptySessionTaskBoard } from "../../conversation-task/session-task-board.js";
import { classifyTurnRelation } from "../../conversation-task/turn-relation.js";
import { formatBoardReadonlyAsideReply, resolveMidTaskAsideDisposition } from "./mid-task-aside.js";

function boardWithConstraints() {
  const board = emptySessionTaskBoard();
  board.current = {
    taskId: "task-a",
    title: "手机调研",
    goalText: "调研国内手机市场并写报告",
    unfinished: true,
    effectiveConstraints: ["只要国内安卓机型", "禁止引用海外评测站点份额数据"],
    stop: { summary: "约束：只要国内安卓机型…｜进行中", workspacePaths: [] },
    createdAtMs: Date.now(),
  };
  return board;
}

describe("resolveMidTaskAsideDisposition", () => {
  it("maps progress asks to progress (not board_readonly)", () => {
    expect(
      resolveMidTaskAsideDisposition({ prompt: "进度如何", board: boardWithConstraints() }),
    ).toEqual({
      kind: "progress",
    });
  });

  it("answers goal/constraint asks from board without implying write", () => {
    const board = boardWithConstraints();
    const goal = resolveMidTaskAsideDisposition({ prompt: "当前目标是什么", board });
    expect(goal.kind).toBe("board_readonly");
    if (goal.kind === "board_readonly") {
      expect(goal.reply).toContain("调研国内手机市场");
      expect(goal.reply).toContain("任务板最近记录");
      expect(goal.reply).not.toContain("wakeSuppress");
    }
    // Even when turn-relation would label this amend, read ask stays board_readonly.
    expect(classifyTurnRelation("有效约束有哪些", board.current!.goalText)).toBe("amend");
    const constraints = resolveMidTaskAsideDisposition({ prompt: "有效约束有哪些", board });
    expect(constraints.kind).toBe("board_readonly");
    if (constraints.kind === "board_readonly") {
      expect(constraints.reply).toContain("只要国内安卓机型");
      expect(constraints.reply).toContain("禁止引用海外评测站点份额数据");
    }
  });

  it("marks general aside as reply_lane_pending (timely lane owns the answer)", () => {
    expect(
      resolveMidTaskAsideDisposition({
        prompt: "今天北京天气怎么样",
        board: boardWithConstraints(),
      }),
    ).toEqual({ kind: "reply_lane_pending" });
  });

  it("formatBoardReadonlyAsideReply stays projection-only", () => {
    const text = formatBoardReadonlyAsideReply(boardWithConstraints(), "constraints");
    expect(text).toContain("有效约束 2 条");
    expect(text).not.toContain("wakeSuppress");
  });
});
