import { describe, expect, it } from "vitest";
import type { ControlledDiscussToTaskResult } from "./controlled-discuss-to-task.js";
import {
  buildDiscussToTaskChatReceipt,
  formatDiscussToTaskUserVisibleStatus,
} from "./discuss-to-task-chat-receipt.js";
import { stagesFromActivation } from "./discuss-to-task-stages.js";

function stub(partial: Partial<ControlledDiscussToTaskResult>): ControlledDiscussToTaskResult {
  return {
    classification: "explicit_delegation",
    classificationReason: "explicit_team_task",
    attempted: true,
    taskId: "task-abc",
    activationKey: "ak",
    activation: null,
    stages: stagesFromActivation({ taskEnsured: true, boardPublished: false }),
    statusCode: "formal_task_established_board_pending",
    userMessage: "任务已建立，工作项尚未发布。",
    ...partial,
  };
}

describe("discuss-to-task-chat-receipt", () => {
  it("builds coordinator binding that forbids inventing 已派工", () => {
    const view = buildDiscussToTaskChatReceipt(
      stub({
        statusCode: "formal_task_blocked_flag_off",
        userMessage: "当前组未启用正式任务能力，尚未建立正式任务。",
        taskId: null,
        stages: stagesFromActivation({ taskEnsured: false, boardPublished: false }),
      }),
    );
    expect(view.coordinatorBindingText).toContain("禁止另编任务或口头宣称已派工");
    expect(view.coordinatorBindingText).toContain("formal_task_blocked_flag_off");
    expect(view.userMessage).not.toMatch(/已派工/);
  });

  it("user-visible status includes taskId and stages when present", () => {
    const text = formatDiscussToTaskUserVisibleStatus(stub({}));
    expect(text).toContain("任务已建立");
    expect(text).toContain("task-abc");
    expect(text).not.toMatch(/已派工/);
  });

  it("pending confirm / rejected / not attempted remain visible", () => {
    for (const row of [
      stub({
        statusCode: "formal_task_needs_confirm",
        userMessage: "正式任务待确认后发布工作项。",
        attempted: true,
      }),
      stub({
        statusCode: "formal_task_blocked_auth",
        userMessage: "无权在该组建立正式任务。",
        taskId: null,
        attempted: true,
      }),
      stub({
        statusCode: "not_attempted",
        userMessage: "尚未尝试建立正式任务。",
        taskId: null,
        attempted: false,
      }),
    ]) {
      const view = buildDiscussToTaskChatReceipt(row);
      expect(view.userMessage.length).toBeGreaterThan(0);
      expect(view.coordinatorBindingText).toContain(row.statusCode);
    }
  });
});
