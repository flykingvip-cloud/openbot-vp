import { beforeEach, expect, it } from "vitest";
import * as delivery from "../../agent-runtime/delivery/acceptance/index.js";
import * as legacy from "./validation.js";

beforeEach(() => delivery.resetValidationStateForTest());

it("keeps compatibility callers and delivery on the same registry implementation", () => {
  for (const name of Object.keys(legacy) as Array<keyof typeof legacy>) {
    expect(legacy[name], name).toBe(delivery[name]);
  }
  legacy.registerTrustedValidator({ id: "schema", version: "1" });
  const receipt = delivery.issueValidationReceipt({
    validatorId: "schema",
    taskId: "task-a",
    artifactPath: "report.json",
    artifactBytes: "{}",
    result: "passed",
  });
  expect(legacy.readLatestValidationReceipt("task-a")).toBe(receipt);
  legacy.recordExecutionDecision("delivery_blocked");
  expect(delivery.readExecutionDecisionCount("delivery_blocked")).toBe(1);
  legacy.resetValidationStateForTest();
  expect(delivery.readLatestValidationReceipt("task-a")).toBeUndefined();
  expect(delivery.isTrustedValidatorRegistered("schema")).toBe(false);
  expect(delivery.readExecutionDecisionCount("delivery_blocked")).toBe(0);
});

it("matches every predeclared requirement instead of treating available receipts as the required set", () => {
  for (const id of ["schema", "sources"]) {
    delivery.registerTrustedValidator({ id, version: "1" });
  }
  legacy.issueValidationReceipt({
    validatorId: "schema",
    taskId: "task-a",
    artifactPath: "report.json",
    artifactBytes: "{}",
    result: "passed",
  });
  const request = {
    taskId: "task-a",
    artifactPath: "report.json",
    artifactHash: legacy.hashArtifact("{}"),
    requiredValidators: ["schema", "sources"],
  };
  expect(delivery.matchRequiredValidators(request).map((match) => match.status)).toEqual([
    "passed",
    "missing",
  ]);
  expect(legacy.findValidReceipt(request)).toBeUndefined();
});

it("cannot reuse another task, changed content, or an obsolete validator version", () => {
  delivery.registerTrustedValidator({ id: "schema", version: "1" });
  legacy.issueValidationReceipt({
    validatorId: "schema",
    taskId: "task-a",
    artifactPath: "report.json",
    artifactBytes: "{}",
    result: "passed",
  });
  const request = {
    taskId: "task-a",
    artifactPath: "report.json",
    artifactHash: delivery.hashArtifact("{}"),
    requiredValidators: ["schema"],
  };
  expect(delivery.matchRequiredValidators({ ...request, taskId: "task-b" })[0].status).toBe(
    "missing",
  );
  expect(
    delivery.matchRequiredValidators({ ...request, artifactPath: "other.json" })[0].status,
  ).toBe("missing");
  expect(
    delivery.matchRequiredValidators({
      ...request,
      artifactHash: delivery.hashArtifact('{"updated":true}'),
    })[0].status,
  ).toBe("stale");
  delivery.registerTrustedValidator({ id: "schema", version: "2" });
  expect(legacy.matchRequiredValidators(request)[0].status).toBe("version_mismatch");
  expect(delivery.findValidReceipt(request)).toBeUndefined();
});
