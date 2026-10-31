/**
 * Layered user-visible status for controlled discuss→task.
 * Never invent "已派工" from oral text or suggestedClaimantIds alone.
 */

export const FORMAL_TASK_FLAG_OFF_USER_MESSAGE = "当前组未启用正式任务能力，尚未建立正式任务。";

export type StageTriState = boolean | "unknown";

export type FormalTaskStageSnapshot = {
  taskEstablished: StageTriState;
  boardPublished: StageTriState;
  responsibilityAccepted: StageTriState;
  planProposed: StageTriState;
  planConfirmed: StageTriState;
  roundComplete?: boolean;
  divisionSuggestionOnly?: boolean;
};

export type FormalTaskUserStatusCode =
  | "discussion_only"
  | "needs_clarification"
  | "division_suggestion_only"
  | "formal_task_blocked_flag_off"
  | "formal_task_blocked_auth"
  | "formal_task_blocked"
  | "formal_task_needs_confirm"
  | "formal_task_established_board_pending"
  | "formal_task_board_published_awaiting_claim"
  | "formal_task_awaiting_plan"
  | "plan_pending_confirm"
  | "plan_confirmed"
  | "round_complete_task_incomplete"
  | "contract_conflict"
  | "not_attempted";

export function userMessageForFormalTaskStatus(code: FormalTaskUserStatusCode): string {
  switch (code) {
    case "discussion_only":
      return "本轮为协作讨论，尚未建立正式任务。";
    case "needs_clarification":
      return "委托意图尚不明确或缺少验收条件，请补充后再建立正式任务。";
    case "division_suggestion_only":
      return "已生成分工建议，尚未正式派工。";
    case "formal_task_blocked_flag_off":
      return FORMAL_TASK_FLAG_OFF_USER_MESSAGE;
    case "formal_task_blocked_auth":
      return "无权在该组建立正式任务。";
    case "formal_task_blocked":
      return "正式任务建立受阻，尚未建立正式任务。";
    case "formal_task_needs_confirm":
      return "任务草案已写入，契约字段待确认。";
    case "formal_task_established_board_pending":
      return "任务已建立，工作项尚未发布。";
    case "formal_task_board_published_awaiting_claim":
      return "工作项已发布，执行者尚未接受。";
    case "formal_task_awaiting_plan":
      return "任务与工作项已就绪，计划尚未提出。";
    case "plan_pending_confirm":
      return "计划待确认。";
    case "plan_confirmed":
      return "计划已确认。";
    case "round_complete_task_incomplete":
      return "本轮回复已结束，任务尚未完成。";
    case "contract_conflict":
      return "与既有任务契约冲突，未创建第二任务。";
    case "not_attempted":
      return "尚未尝试建立正式任务。";
    default:
      return "正式任务状态未知。";
  }
}

export function deriveFormalTaskUserStatus(params: {
  classification?: "discussion" | "needs_clarification" | "explicit_delegation";
  attempted: boolean;
  blockedReason?: string;
  stages?: FormalTaskStageSnapshot;
  activationStatus?: string;
}): { code: FormalTaskUserStatusCode; userMessage: string } {
  if (params.classification === "discussion") {
    return {
      code: "discussion_only",
      userMessage: userMessageForFormalTaskStatus("discussion_only"),
    };
  }
  if (params.classification === "needs_clarification") {
    return {
      code: "needs_clarification",
      userMessage: userMessageForFormalTaskStatus("needs_clarification"),
    };
  }
  if (!params.attempted) {
    if (params.stages?.divisionSuggestionOnly) {
      return {
        code: "division_suggestion_only",
        userMessage: userMessageForFormalTaskStatus("division_suggestion_only"),
      };
    }
    return {
      code: "not_attempted",
      userMessage: userMessageForFormalTaskStatus("not_attempted"),
    };
  }
  const reason = params.blockedReason ?? "";
  if (reason === "claim_contract_flag_off") {
    return {
      code: "formal_task_blocked_flag_off",
      userMessage: userMessageForFormalTaskStatus("formal_task_blocked_flag_off"),
    };
  }
  if (reason === "activation_contract_conflict" || reason === "discuss_to_task_contract_conflict") {
    return {
      code: "contract_conflict",
      userMessage: userMessageForFormalTaskStatus("contract_conflict"),
    };
  }
  if (/auth|permission|locator|tenant|member|actor_not|not_a_member|cross_tenant/i.test(reason)) {
    return {
      code: "formal_task_blocked_auth",
      userMessage: userMessageForFormalTaskStatus("formal_task_blocked_auth"),
    };
  }
  const stages = params.stages;
  if (params.activationStatus === "needs_confirm") {
    return {
      code: "formal_task_needs_confirm",
      userMessage: userMessageForFormalTaskStatus("formal_task_needs_confirm"),
    };
  }
  // ROUND_COMPLETE is a reply-boundary fact — never implies task completion.
  if (stages?.roundComplete && stages.taskEstablished === true && stages.planConfirmed !== true) {
    return {
      code: "round_complete_task_incomplete",
      userMessage: userMessageForFormalTaskStatus("round_complete_task_incomplete"),
    };
  }
  if (stages?.planConfirmed === true) {
    return {
      code: "plan_confirmed",
      userMessage: userMessageForFormalTaskStatus("plan_confirmed"),
    };
  }
  if (stages?.planProposed === true && stages.planConfirmed !== true) {
    return {
      code: "plan_pending_confirm",
      userMessage: userMessageForFormalTaskStatus("plan_pending_confirm"),
    };
  }
  if (stages?.boardPublished === true && stages.responsibilityAccepted !== true) {
    return {
      code: "formal_task_board_published_awaiting_claim",
      userMessage: userMessageForFormalTaskStatus("formal_task_board_published_awaiting_claim"),
    };
  }
  if (
    stages?.boardPublished === true &&
    stages.responsibilityAccepted === true &&
    stages.planProposed !== true
  ) {
    return {
      code: "formal_task_awaiting_plan",
      userMessage: userMessageForFormalTaskStatus("formal_task_awaiting_plan"),
    };
  }
  if (stages?.taskEstablished === true && stages.boardPublished !== true) {
    return {
      code: "formal_task_established_board_pending",
      userMessage: userMessageForFormalTaskStatus("formal_task_established_board_pending"),
    };
  }
  if (params.activationStatus === "blocked" || reason) {
    return {
      code: "formal_task_blocked",
      userMessage: userMessageForFormalTaskStatus("formal_task_blocked"),
    };
  }
  if (stages?.taskEstablished === true) {
    return {
      code: "formal_task_established_board_pending",
      userMessage: userMessageForFormalTaskStatus("formal_task_established_board_pending"),
    };
  }
  return {
    code: "not_attempted",
    userMessage: userMessageForFormalTaskStatus("not_attempted"),
  };
}
