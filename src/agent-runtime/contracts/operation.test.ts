import { expect, it } from "vitest";
import { executionOperationKey, operationIdentityFromIngress } from "./operation.js";
const base = {
  tenantId: "tenant",
  taskId: "task",
  executionId: "execution",
  stepId: "step",
  operationId: "write",
};
it("keeps logical keys stable across attempts and isolates tenants", () => {
  const firstAttempt = { ...base, attemptId: "retry-1" };
  const secondAttempt = { ...base, attemptId: "retry-2" };
  expect(executionOperationKey(firstAttempt)).toBe(executionOperationKey(secondAttempt));
  expect(executionOperationKey(base)).not.toBe(
    executionOperationKey({ ...base, tenantId: "other" }),
  );
});
it("does not collide on tuple delimiter characters", () => {
  expect(executionOperationKey({ ...base, stepId: "a|b", operationId: "c" })).not.toBe(
    executionOperationKey({ ...base, stepId: "a", operationId: "b|c" }),
  );
});
it("rejects ambiguous whitespace identity", () => {
  expect(() => executionOperationKey({ ...base, tenantId: " tenant" })).toThrow("canonical");
});

it.each(["chat", "scheduled", "recovery", "subagent", "fabric"] as const)(
  "requires persisted operation references at %s ingress",
  (ingress) => {
    const input = {
      ingress,
      originalIngress: ingress === "recovery" ? ("chat" as const) : undefined,
      tenantId: "tenant",
      taskId: "task",
      persistedExecutionId: "occurrence",
      persistedStepId: "step",
      persistedOperationId: "write",
    };
    const identity = operationIdentityFromIngress(input);
    expect(identity.executionId).toBe(`${ingress === "recovery" ? "chat" : ingress}:occurrence`);
    expect(() => operationIdentityFromIngress({ ...input, persistedExecutionId: "" })).toThrow(
      "persisted",
    );
  },
);
