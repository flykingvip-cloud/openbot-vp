import { describe, expect, it, vi } from "vitest";
import type { SessionTaskBoard } from "../contracts/task.js";
import { queryCurrentTaskStatus } from "./task-status.js";

describe("current task status query", () => {
  it("does not read state for amendments or control", () => {
    const read = vi.fn();
    for (const prompt of ["暂停", "补充：不要发布", "换个主题"]) {
      expect(queryCurrentTaskStatus(prompt, read)).toBeUndefined();
    }
    expect(read).not.toHaveBeenCalled();
  });
  it("does not claim a task exists when current is absent", () => {
    expect(
      queryCurrentTaskStatus("进度如何？", () => ({ parked: [], focusRevision: 0 })),
    ).toBeUndefined();
  });
  it("reads once and projects recorded facts without mutating state", () => {
    const board: SessionTaskBoard = {
      parked: [],
      focusRevision: 1,
      current: {
        taskId: "task-a",
        title: "报告",
        goalText: "撰写报告",
        unfinished: true,
        createdAtMs: 1,
        wakeSuppress: true,
        stop: { summary: "已核实资料", workspacePaths: [] },
      },
    };
    const before = structuredClone(board);
    const read = vi.fn(() => board);
    const reply = queryCurrentTaskStatus("进度如何？", read);
    expect(reply).toContain("任务板最近记录：未完成");
    expect(reply).toContain("主人已暂停自动续跑");
    expect(reply).not.toContain("正在推进");
    expect(read).toHaveBeenCalledTimes(1);
    expect(board).toEqual(before);
  });
});
