import { beforeEach, describe, expect, it } from "vitest";
import {
  buildExecutionPreflight,
  DELIVERY_HOLD_NOTICE,
  evaluateDeliveryEvidence,
  gateAssistantTexts,
  noteConfirmationPassed,
  resetConfirmationGatesForTest,
  resetDeliveryArtifactsForTest,
  resetExecutionTraceForTest,
  resetValidationStateForTest,
} from "./index.js";

const skillWithGate = {
  name: "gated-skill",
  frontmatter: {
    triggers: "run-gated",
    "required-confirmations": "owner-approve,finance-approve",
    "allowed-tools": "read,message",
    "delivery-stage-tools": "message",
  },
};

function preflightFor(taskId = "task-confirm") {
  return buildExecutionPreflight({
    taskId,
    sessionId: "session-confirm",
    message: "please run-gated",
    skills: [skillWithGate],
    policyToolNames: ["read", "message"],
    qualify: () => ({ kind: "short_action", reasons: ["test"] }),
  });
}

describe("confirmation-gate enforcement (P2)", () => {
  beforeEach(() => {
    resetValidationStateForTest();
    resetDeliveryArtifactsForTest();
    resetExecutionTraceForTest();
    resetConfirmationGatesForTest();
  });

  it("blocks completion claims while required confirmations are pending", () => {
    const preflight = preflightFor();
    expect(preflight.requiredConfirmations).toEqual(["owner-approve", "finance-approve"]);
    expect(preflight.intentClass).toBe("multi_stage");
    const evidence = evaluateDeliveryEvidence({ preflight });
    expect(evidence.allowedToDeliver).toBe(false);
    expect(evidence.decisionCode).toBe("delivery_blocked");
    expect(evidence.unresolvedRisks).toEqual([
      "confirmation_gate_pending:owner-approve",
      "confirmation_gate_pending:finance-approve",
    ]);
    expect(gateAssistantTexts(["任务已完成"], evidence)[0]).toBe(DELIVERY_HOLD_NOTICE);
  });

  it("allows completion only after every confirmation id is noted passed", () => {
    const preflight = preflightFor("task-confirm-pass");
    noteConfirmationPassed(preflight.taskId, preflight.attemptNumber, "owner-approve");
    const half = evaluateDeliveryEvidence({ preflight });
    expect(half.allowedToDeliver).toBe(false);
    expect(half.unresolvedRisks).toEqual(["confirmation_gate_pending:finance-approve"]);

    noteConfirmationPassed(preflight.taskId, preflight.attemptNumber, "finance-approve");
    const full = evaluateDeliveryEvidence({ preflight });
    expect(full.allowedToDeliver).toBe(true);
    expect(full.decisionCode).toBe("delivery_allowed");
    expect(gateAssistantTexts(["任务已完成"], full)[0]).toBe("任务已完成");
  });

  it("ignores model text as a confirmation pass", () => {
    const preflight = preflightFor("task-confirm-model");
    const evidence = evaluateDeliveryEvidence({
      preflight,
      modelClaim: "owner-approve finance-approve 用户已确认",
    });
    expect(evidence.allowedToDeliver).toBe(false);
  });
});
