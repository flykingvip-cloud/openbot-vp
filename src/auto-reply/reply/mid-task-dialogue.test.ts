import { describe, expect, it } from "vitest";
import {
  emptySessionTaskBoard,
  type SessionTaskBoard,
} from "../../conversation-task/session-task-board.js";
import {
  applySameTaskConstraintNote,
  formatAmendConstraintAck,
  formatTaskBoardProgressReply,
  isProgressStatusQuery,
} from "./mid-task-dialogue.js";

describe("mid-task-dialogue helpers", () => {
  it("detects narrow progress status queries", () => {
    expect(isProgressStatusQuery("进度如何")).toBe(true);
    expect(isProgressStatusQuery("做到哪了")).toBe(true);
    expect(isProgressStatusQuery("怎么样了？")).toBe(true);
    expect(isProgressStatusQuery("当前进度")).toBe(true);
    expect(isProgressStatusQuery("补充：只要国内安卓")).toBe(false);
    expect(isProgressStatusQuery("现在改做合同审查")).toBe(false);
  });

  it("formats progress from board projection", () => {
    const board: SessionTaskBoard = {
      ...emptySessionTaskBoard(),
      current: {
        taskId: "task-a",
        title: "手机调研",
        goalText: "调研国内手机市场并写报告",
        unfinished: true,
        stop: { summary: "正在收集评测", workspacePaths: [] },
        createdAtMs: 1,
      },
      focusRevision: 2,
    };
    const text = formatTaskBoardProgressReply(board);
    expect(text).toContain("手机调研");
    expect(text).toContain("进行中");
    expect(text).toContain("正在收集评测");
    expect(text).not.toContain("请确认");
  });

  it("acks amend once without inventing a second controller", () => {
    expect(formatAmendConstraintAck("补充：只要国内安卓机型")).toContain("仅一次");
  });

  it("applies constraint note without changing taskId", () => {
    const task = {
      taskId: "task-a",
      title: "手机调研",
      goalText: "调研国内手机市场并写报告",
      unfinished: true,
      stop: { summary: "进行中", workspacePaths: [] as string[] },
      createdAtMs: 1,
    };
    const next = applySameTaskConstraintNote(task, "补充：只要国内安卓机型");
    expect(next.taskId).toBe("task-a");
    expect(next.stop.summary).toContain("约束：");
    expect(next.stop.summary).toContain("进行中");
  });
});
