import { describe, expect, it } from "vitest";
import {
  deriveFormalTaskUserStatus,
  FORMAL_TASK_FLAG_OFF_USER_MESSAGE,
  userMessageForFormalTaskStatus,
} from "./discuss-to-task-receipt.js";
import { applyRoundCompleteToStages, stagesFromActivation } from "./discuss-to-task-stages.js";

describe("discuss-to-task-receipt (pure)", () => {
  it("flag-off user message is unified", () => {
    expect(userMessageForFormalTaskStatus("formal_task_blocked_flag_off")).toBe(
      FORMAL_TASK_FLAG_OFF_USER_MESSAGE,
    );
    const s = deriveFormalTaskUserStatus({
      attempted: true,
      blockedReason: "claim_contract_flag_off",
      classification: "explicit_delegation",
    });
    expect(s.userMessage).toBe(FORMAL_TASK_FLAG_OFF_USER_MESSAGE);
    expect(s.userMessage).not.toContain("已派工");
  });

  it("layered stage messages match §5 examples", () => {
    expect(
      deriveFormalTaskUserStatus({
        attempted: false,
        stages: stagesFromActivation({
          taskEnsured: false,
          boardPublished: false,
          divisionSuggestionOnly: true,
        }),
      }).userMessage,
    ).toBe("已生成分工建议，尚未正式派工。");
    expect(
      deriveFormalTaskUserStatus({
        attempted: true,
        classification: "explicit_delegation",
        stages: stagesFromActivation({ taskEnsured: true, boardPublished: false }),
      }).userMessage,
    ).toBe("任务已建立，工作项尚未发布。");
    expect(
      deriveFormalTaskUserStatus({
        attempted: true,
        classification: "explicit_delegation",
        stages: stagesFromActivation({
          taskEnsured: true,
          boardPublished: true,
          responsibilityAccepted: false,
        }),
      }).userMessage,
    ).toBe("工作项已发布，执行者尚未接受。");
    expect(
      deriveFormalTaskUserStatus({
        attempted: true,
        classification: "explicit_delegation",
        stages: stagesFromActivation({
          taskEnsured: true,
          boardPublished: true,
          responsibilityAccepted: true,
          planProposed: true,
          planConfirmed: false,
        }),
      }).userMessage,
    ).toBe("计划待确认。");
  });

  it("ROUND_COMPLETE does not mark task completed", () => {
    const stages = applyRoundCompleteToStages(
      stagesFromActivation({
        taskEnsured: true,
        boardPublished: true,
        planConfirmed: false,
      }),
    );
    const s = deriveFormalTaskUserStatus({
      attempted: true,
      classification: "explicit_delegation",
      stages,
    });
    expect(s.userMessage).toBe("本轮回复已结束，任务尚未完成。");
    expect(s.code).toBe("round_complete_task_incomplete");
  });
});
