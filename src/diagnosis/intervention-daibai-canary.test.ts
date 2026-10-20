import { describe, expect, it } from "vitest";
import { createMemoryInterventionCaseStore } from "./intervention-case-store.js";
import { newInterventionCaseId, type InterventionCase } from "./intervention-case.js";
import {
  attachInterventionDaibaiCanary,
  interventionDaibaiGatesDefaultClosed,
} from "./intervention-daibai-canary.js";
import {
  DIAGNOSIS_P24_5_CANARY_TENANT,
  DIAGNOSIS_P24_5_LIVE_SESSION_KEY,
} from "./production-cutover.js";

function dispatched(): InterventionCase {
  return {
    schemaVersion: 1,
    caseId: newInterventionCaseId("canary"),
    tenantId: DIAGNOSIS_P24_5_CANARY_TENANT,
    status: "dispatched",
    actionKind: "identity",
    title: "补身份字段",
    actor: "owner",
    source: { actionId: "act:identity:bot-1", growthAgentId: "bot-1", growthGroupId: null },
    target: { kind: "agent_1to1", agentId: "bot-1", sessionKey: "agent:bot-1:main" },
    stewardReceiptText: "已交接",
    createdAt: "2026-10-14T00:00:00.000Z",
    updatedAt: "2026-10-14T00:00:00.000Z",
  };
}

describe("intervention daibai canary", () => {
  it("deliveryEnabled=false → receipted with gate_closed skip; REMEDIATION stays false", async () => {
    const store = createMemoryInterventionCaseStore();
    const row = await attachInterventionDaibaiCanary({
      case: dispatched(),
      store,
      deliveryEnabled: false,
    });
    expect(row.status).toBe("receipted");
    expect(row.daibaiReceipt).toMatchObject({
      status: "skipped",
      skipReason: "gate_closed",
      sessionKey: DIAGNOSIS_P24_5_LIVE_SESSION_KEY,
    });
    expect(interventionDaibaiGatesDefaultClosed().daibaiDeliveryEnabled).toBe(true);
    expect(interventionDaibaiGatesDefaultClosed().remediationExecutionEnabled).toBe(false);
  });
});
