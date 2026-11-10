import { describe, expect, it } from "vitest";
import { INTERACTION_PROSE_PROTOCOL_DOWNGRADE } from "../contracts/interaction.js";
import type { SessionTaskBoard, TrackedTask } from "../contracts/task.js";
import { admittedTaskQueryContinuation } from "./admitted-task-query-continuation.js";

function task(overrides: Partial<TrackedTask> = {}): TrackedTask {
  return {
    taskId: "task-research",
    title: "数据库选型",
    goalText: "交付 Markdown 报告与比较 CSV",
    unfinished: true,
    createdAtMs: 1,
    admittedGeneration: 0,
    stop: { summary: "未完成", workspacePaths: [] },
    ...overrides,
  };
}

function board(current?: TrackedTask, resetGeneration = 0): SessionTaskBoard {
  return { current, parked: [], focusRevision: 1, writeEpoch: 1, resetGeneration };
}

describe("admitted task query continuation", () => {
  it("keeps an already-admitted runnable task after a mid-run query", () => {
    const result = admittedTaskQueryContinuation({ board: board(task()) });
    expect(result).toEqual({
      shouldContinue: true,
      taskId: "task-research",
      reason: "continue_admitted",
    });
  });

  it("does not continue a paused, finished, unbound, or prose-downgraded turn", () => {
    expect(
      admittedTaskQueryContinuation({ board: board(task({ wakeSuppress: true })) }).reason,
    ).toBe("task_paused");
    expect(admittedTaskQueryContinuation({ board: board(task({ unfinished: false })) }).reason).toBe(
      "already_finished",
    );
    expect(admittedTaskQueryContinuation({ board: board() }).reason).toBe("no_current_task");
    expect(
      admittedTaskQueryContinuation({ board: board(task({ admittedGeneration: 0 }), 1) }).reason,
    ).toBe("generation_mismatch");
    expect(
      admittedTaskQueryContinuation({
        board: board(task()),
        protocolDowngrade: INTERACTION_PROSE_PROTOCOL_DOWNGRADE,
      }).reason,
    ).toBe("prose_downgrade");
  });
});
