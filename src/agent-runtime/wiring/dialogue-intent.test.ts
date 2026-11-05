import { describe, expect, it } from "vitest";
import { resolveInteractionDialogue } from "../../agent-runtime/wiring/command-adapters.js";
import { emptySessionTaskBoard } from "../../conversation-task/session-task-board.js";
import { classifyTurnRelation } from "../../conversation-task/turn-relation.js";

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

describe("resolveInteractionDialogue", () => {
  it("maps progress asks to progress (not board_readonly)", () => {
    expect(
      resolveInteractionDialogue({ prompt: "进度如何", board: boardWithConstraints() }),
    ).toEqual({
      kind: "progress",
    });
  });

  it("answers goal/constraint asks from board without implying write", () => {
    const board = boardWithConstraints();
    const goal = resolveInteractionDialogue({ prompt: "当前目标是什么", board });
    expect(goal.kind).toBe("board_readonly");
    if (goal.kind === "board_readonly") {
      expect(goal.reply).toContain("调研国内手机市场");
      expect(goal.reply).toContain("任务板最近记录");
      expect(goal.reply).not.toContain("wakeSuppress");
    }
    // Even when turn-relation would label this amend, read ask stays board_readonly.
    expect(classifyTurnRelation("有效约束有哪些", board.current!.goalText)).toBe("amend");
    const constraints = resolveInteractionDialogue({ prompt: "有效约束有哪些", board });
    expect(constraints.kind).toBe("board_readonly");
    if (constraints.kind === "board_readonly") {
      expect(constraints.reply).toContain("只要国内安卓机型");
      expect(constraints.reply).toContain("禁止引用海外评测站点份额数据");
    }
  });

  it("marks general aside as reply_lane_pending (timely lane owns the answer)", () => {
    expect(
      resolveInteractionDialogue({
        prompt: "今天北京天气怎么样",
        board: boardWithConstraints(),
      }),
    ).toEqual({ kind: "conversation" });
  });

  it("routes supplement/correct/safety to not_aside (board entry), not reply_lane", () => {
    const board = boardWithConstraints();
    for (const prompt of ["报告增加欧洲市场", "改为只要公开资料", "先别发布", "不要付款"]) {
      const d = resolveInteractionDialogue({ prompt, board });
      expect(d.kind, prompt).toBe("task_command");
      expect(classifyTurnRelation(prompt, board.current!.goalText)).toBe("amend");
    }
  });

  it("keeps ordinary questions on reply_lane_pending", () => {
    expect(
      resolveInteractionDialogue({
        prompt: "今天北京天气怎么样",
        board: boardWithConstraints(),
      }).kind,
    ).toBe("conversation");
  });
});
