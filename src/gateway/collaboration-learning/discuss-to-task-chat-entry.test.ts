/**
 * Chat-entry visibility for discuss→task (not pack-registration-only).
 * Proves flag-off / failure → userMessage + coordinator binding, no 已派工假象.
 */
import { describe, expect, it } from "vitest";
import type { ControlledDiscussToTaskResult } from "./controlled-discuss-to-task.js";
import {
  buildDiscussToTaskChatReceipt,
  formatDiscussToTaskUserVisibleStatus,
} from "./discuss-to-task-chat-receipt.js";
import { FORMAL_TASK_FLAG_OFF_USER_MESSAGE } from "./discuss-to-task-receipt.js";
import { stagesFromActivation } from "./discuss-to-task-stages.js";

function asResult(partial: Partial<ControlledDiscussToTaskResult>): ControlledDiscussToTaskResult {
  return {
    classification: "explicit_delegation",
    classificationReason: "explicit_team_task",
    attempted: true,
    taskId: null,
    activationKey: null,
    activation: null,
    stages: stagesFromActivation({
      taskEnsured: false,
      boardPublished: false,
      responsibilityAccepted: false,
      planProposed: false,
      planConfirmed: false,
    }),
    statusCode: "formal_task_blocked_flag_off",
    userMessage: FORMAL_TASK_FLAG_OFF_USER_MESSAGE,
    internalReason: "claim_contract_flag_off",
    ...partial,
  };
}

describe("discuss-to-task chat entry receipt (visible + coordinator-bound)", () => {
  it("flag-off: user-visible status and coordinator context stay consistent, no 已派工", () => {
    const result = asResult({});
    const receipt = buildDiscussToTaskChatReceipt(result);
    const visible = formatDiscussToTaskUserVisibleStatus(result);
    expect(visible).toBe(`${FORMAL_TASK_FLAG_OFF_USER_MESSAGE} （${receipt.stagesSummary}）`);
    expect(visible).not.toMatch(/已派工/);
    expect(receipt.coordinatorBindingText).toContain("formal_task_blocked_flag_off");
    expect(receipt.coordinatorBindingText).toContain("禁止另编任务或口头宣称已派工");
    expect(receipt.coordinatorBindingText).toContain(FORMAL_TASK_FLAG_OFF_USER_MESSAGE);
  });

  it("failure / pending / partial each produce durable visible status for chat injection", () => {
    const cases: ControlledDiscussToTaskResult[] = [
      asResult({
        statusCode: "formal_task_blocked",
        userMessage: "正式任务建立受阻，尚未建立正式任务。",
        internalReason: "discuss_to_task_hook_failed",
      }),
      asResult({
        statusCode: "formal_task_needs_confirm",
        userMessage: "任务草案已写入，契约字段待确认。",
        taskId: "task-pending",
        stages: stagesFromActivation({
          taskEnsured: true,
          boardPublished: false,
          responsibilityAccepted: false,
          planProposed: false,
          planConfirmed: false,
        }),
      }),
      asResult({
        statusCode: "formal_task_established_board_pending",
        userMessage: "任务已建立，工作项尚未发布。",
        taskId: "task-partial",
        stages: stagesFromActivation({
          taskEnsured: true,
          boardPublished: false,
          responsibilityAccepted: "unknown",
          planProposed: "unknown",
          planConfirmed: "unknown",
        }),
      }),
    ];
    for (const row of cases) {
      const receipt = buildDiscussToTaskChatReceipt(row);
      expect(receipt.userMessage.length).toBeGreaterThan(0);
      expect(receipt.coordinatorBindingText).toContain(row.statusCode);
      expect(receipt.userMessage).not.toMatch(/已派工/);
      expect(receipt.coordinatorBindingText).toContain("禁止另编任务或口头宣称已派工");
      if (row.taskId) {
        expect(receipt.coordinatorBindingText).toContain(row.taskId);
      }
    }
  });
});
