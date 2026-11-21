import { expect, it } from "vitest";
import { buildEmbeddedRunBaseParams } from "./embedded-parameters.js";
it("rejects a canonical operation identity from another tenant before projecting tools", () => {
  const input = {
    run: {
      executionIdentity: { enterpriseId: "trusted-tenant" },
      deliveryToolSideEffect: {
        taskId: "task",
        stepId: "step",
        boardItemId: "item",
        ledgerDir: "/tmp/test-ledger",
        operationIdentity: {
          tenantId: "other-tenant",
          taskId: "task",
          stepId: "step",
          executionId: "execution",
          operationId: "write",
        },
      },
    },
    provider: "test",
    model: "test",
    runId: "attempt",
    authProfile: {},
  } as unknown as Parameters<typeof buildEmbeddedRunBaseParams>[0];
  expect(() => buildEmbeddedRunBaseParams(input)).toThrow("trusted embedded execution admission");
});
