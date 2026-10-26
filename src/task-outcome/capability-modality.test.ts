// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  assessTargetModalityAcceptance,
  capabilityModalityFromClaim,
} from "./capability-modality.js";

describe("assessTargetModalityAcceptance", () => {
  it("refuses executor_unwired even when text was returned", () => {
    const modality = capabilityModalityFromClaim({
      planFailureKind: "executor_unwired",
      allowedModality: "chat_model",
      forbiddenSuccessModalities: ["image_generation"],
      textReturnedAllowed: true,
      targetModalityCompleted: false,
      status: "executor_unwired",
      incompleteModalities: ["image_generation"],
      detail: "Executor image_generation is not wired",
    });
    expect(modality.targetModalityCompleted).toBe(false);
    expect(modality.executionStatus).toBe("executor_unwired");
    const assessed = assessTargetModalityAcceptance(modality);
    expect(assessed.targetModalitySucceeded).toBe(false);
    expect(assessed.reason).toBe("executor_unwired");
  });

  it("refuses routing_ok without completion", () => {
    const modality = capabilityModalityFromClaim({
      planFailureKind: "none",
      allowedModality: "chat_model",
      forbiddenSuccessModalities: [],
      textReturnedAllowed: true,
      targetModalityCompleted: false,
      status: "ok",
    });
    expect(modality.executionStatus).toBe("routing_ok");
    expect(assessTargetModalityAcceptance(modality).targetModalitySucceeded).toBe(false);
  });

  it("only passes when targetModalityCompleted is true and not forbidden", () => {
    const modality = capabilityModalityFromClaim({
      planFailureKind: "none",
      allowedModality: "chat_model",
      forbiddenSuccessModalities: [],
      textReturnedAllowed: true,
      targetModalityCompleted: true,
      status: "ok",
    });
    expect(assessTargetModalityAcceptance(modality).targetModalitySucceeded).toBe(true);
  });
});
