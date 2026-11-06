import { beforeEach, expect, it } from "vitest";
import {
  hashArtifact,
  issueValidationReceipt,
  matchRequiredValidators,
  registerTrustedValidator,
  resetValidationStateForTest,
} from "./validation.js";
beforeEach(() => {
  resetValidationStateForTest();
  registerTrustedValidator({ id: "sources", version: "1" });
});
const request = {
  taskId: "task",
  artifactPath: "report",
  artifactHash: hashArtifact("same bytes"),
  requiredValidators: ["sources"],
};
it("uses the latest issued verdict for the exact artifact and registered validator version", () => {
  const input = {
    validatorId: "sources",
    taskId: "task",
    artifactPath: "report",
    artifactBytes: "same bytes",
  };
  issueValidationReceipt({ ...input, result: "passed" });
  issueValidationReceipt({ ...input, result: "failed" });
  expect(matchRequiredValidators(request)[0].status).toBe("failed");
  issueValidationReceipt({ ...input, result: "passed" });
  expect(matchRequiredValidators(request)[0].status).toBe("passed");
});
it("does not let callers mutate an issued verdict into acceptance", () => {
  const receipt = issueValidationReceipt({
    validatorId: "sources",
    taskId: "task",
    artifactPath: "report",
    artifactBytes: "same bytes",
    result: "failed",
  })!;
  expect(() => {
    receipt.result = "passed";
  }).toThrow();
  expect(matchRequiredValidators(request)[0].status).toBe("failed");
});
