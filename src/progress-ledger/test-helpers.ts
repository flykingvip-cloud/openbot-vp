import type {
  ExecutionEvent,
  ExecutionEventPayload,
  ExecutionEventType,
  ProgressEvidence,
} from "./types.js";

const TOOL_EVIDENCE: ProgressEvidence = {
  type: "tool_result",
  atMs: 1,
  source: "calculator",
  recordCount: 1284,
  verification: "passed",
};

const VALIDATION_EVIDENCE: ProgressEvidence = {
  type: "validation_result",
  atMs: 2,
  source: "bonus-policy",
  ruleVersion: "v3.2",
  verification: "passed",
};

export function toolEvidence(atMs = 1): ProgressEvidence {
  return { ...TOOL_EVIDENCE, atMs };
}

export function validationEvidence(atMs = 2): ProgressEvidence {
  return { ...VALIDATION_EVIDENCE, atMs };
}

export function receiptEvidence(atMs = 3): ProgressEvidence {
  return {
    type: "external_receipt",
    atMs,
    source: "email_send",
    receiptId: "provider_message_id=msg_1",
    recipient: "finance@example.com",
    verification: "passed",
  };
}

let seq = 0;

export function ev(
  type: ExecutionEventType,
  overrides: Partial<ExecutionEvent> & { payload?: ExecutionEventPayload } = {},
): ExecutionEvent {
  seq += 1;
  return {
    id: overrides.id ?? `evt_${seq}`,
    atMs: overrides.atMs ?? seq * 1000,
    type,
    taskId: overrides.taskId ?? "task_q2",
    planVersion: overrides.planVersion ?? 1,
    payload: overrides.payload ?? {},
    actor: overrides.actor ?? "runtime",
    ...(overrides.stepId ? { stepId: overrides.stepId } : {}),
    ...(overrides.acceptanceId ? { acceptanceId: overrides.acceptanceId } : {}),
  };
}

export function seedPlan(options?: { extraAcceptance?: boolean }): ExecutionEvent[] {
  return [
    ev("PLAN_SEEDED", {
      atMs: 1_000,
      payload: {
        goal: "Q2 竞品价格巡检",
        acceptance: [
          { id: "A1", text: "已拉取竞品价格", satisfiedByStepIds: ["E1"] },
          { id: "A2", text: "已计算内部价差", satisfiedByStepIds: ["E2"] },
          { id: "A3", text: "已确认价差口径", satisfiedByStepIds: ["E3"] },
          { id: "A4", text: "已生成异常 SKU", satisfiedByStepIds: ["E4"] },
          ...(options?.extraAcceptance
            ? [{ id: "A5", text: "已投递市场组", satisfiedByStepIds: ["E5"] }]
            : []),
        ],
        steps: [
          { id: "E1", title: "拉取竞品价格", acceptanceIds: ["A1"] },
          { id: "E2", title: "计算内部价差", acceptanceIds: ["A2"] },
          { id: "E3", title: "确认价差口径", acceptanceIds: ["A3"] },
          { id: "E4", title: "生成异常 SKU", acceptanceIds: ["A4"] },
        ],
      },
    }),
  ];
}

export function completeStep(stepId: string, acceptanceId: string, atMs: number): ExecutionEvent[] {
  return [
    ev("STEP_STARTED", { stepId, atMs }),
    ev("TOOL_SUCCEEDED", { stepId, atMs: atMs + 1, payload: { evidence: toolEvidence(atMs + 1) } }),
    ev("VALIDATION_PASSED", {
      stepId,
      atMs: atMs + 2,
      actor: "validator",
      payload: { evidence: validationEvidence(atMs + 2) },
    }),
    ev("STEP_COMPLETED", { stepId, atMs: atMs + 3, payload: { evidence: toolEvidence(atMs + 3) } }),
    ev("ACCEPTANCE_MET", {
      acceptanceId,
      atMs: atMs + 4,
      payload: { evidence: receiptEvidence(atMs + 4) },
    }),
  ];
}
