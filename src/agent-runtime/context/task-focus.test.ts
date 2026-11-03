import { describe, expect, it } from "vitest";
import type { SessionTaskBoard } from "../contracts/task.js";
import { formatTaskBoardFocusLine } from "./task-focus.js";

describe("task focus snapshot projection", () => {
  it("preserves empty and parked-only wording", () => {
    const board: SessionTaskBoard = { parked: [], focusRevision: 0 };
    expect(formatTaskBoardFocusLine(board)).toBe("当前无进行中任务；已挂起 0 项");
    const task = {
      taskId: "a",
      title: "A",
      goalText: "A",
      unfinished: true,
      createdAtMs: 1,
      stop: { summary: "", workspacePaths: [] },
    };
    board.parked.push(task);
    expect(formatTaskBoardFocusLine(board)).toBe("当前无进行中任务；已挂起 1 项");
    board.current = { ...task, title: "  当前任务  " };
    expect(formatTaskBoardFocusLine(board)).toBe("当前任务：「当前任务」；已挂起 1 项");
    expect(board.current.title).toBe("  当前任务  ");
  });
});
