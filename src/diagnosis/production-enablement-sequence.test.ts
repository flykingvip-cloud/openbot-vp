import { vi } from "vitest";
import { describe, expect, it } from "vitest";
import { GATEWAY_METHOD_PACKS } from "../gateway/server-methods/packs/registry.js";
import {
  DIAGNOSIS_DAIBAI_DELIVERY_ENABLED,
  DIAGNOSIS_REMEDIATION_EXECUTION_ENABLED,
} from "./production-cutover.js";
import {
  DIAGNOSIS_APPROVED_OPEN_GATE_NAMES,
  DIAGNOSIS_ENABLEMENT_STEPS,
  assertEnablementSourceNotClientOrModel,
  assertApprovedEnablementPrefix,
  isApprovedEnablementPrefixOpen,
  isUnapprovedProductionGateOpen,
  nextEnablementStep,
} from "./production-enablement-sequence.js";
import { DIAGNOSIS_REPORT_API_DEPLOYED } from "./report-query-deploy.js";
import { DIAGNOSIS_PRODUCTION_ADAPTERS_ENABLED } from "./report-query-production-adapters.js";
import { DiagnosisContractError } from "./types.js";

describe("diagnosis enablement sequence", () => {
  it("keeps official approval-bar order and the P24.8 prefix", () => {
    expect(DIAGNOSIS_ENABLEMENT_STEPS.map((step) => step.id)).toEqual([
      "adapters",
      "reportApi",
      "daibaiDelivery",
      "remediationExecution",
    ]);
    expect(DIAGNOSIS_ENABLEMENT_STEPS.map((step) => step.approver)).toEqual([
      "platform_security",
      "platform_security",
      "platform_security+enterprise_admin",
      "platform_security+enterprise_admin+employee",
    ]);
    expect(DIAGNOSIS_APPROVED_OPEN_GATE_NAMES).toEqual([
      "DIAGNOSIS_DAIBAI_DELIVERY_ENABLED",
      "DIAGNOSIS_PRODUCTION_ADAPTERS_ENABLED",
      "DIAGNOSIS_REPORT_API_DEPLOYED",
      "DIAGNOSIS_REMEDIATION_EXECUTION_ENABLED",
    ]);
    expect(DIAGNOSIS_DAIBAI_DELIVERY_ENABLED).toBe(true);
    expect(DIAGNOSIS_PRODUCTION_ADAPTERS_ENABLED).toBe(true);
    expect(DIAGNOSIS_REPORT_API_DEPLOYED).toBe(true);
    expect(DIAGNOSIS_REMEDIATION_EXECUTION_ENABLED).toBe(false);
    expect(isUnapprovedProductionGateOpen()).toBe(false);
    expect(isApprovedEnablementPrefixOpen()).toBe(false);
    expect(nextEnablementStep()).toBe("remediationExecution");
    expect(() => assertApprovedEnablementPrefix()).not.toThrow();
    expect(GATEWAY_METHOD_PACKS.find((pack) => pack.id === "diagnosis-reports")).toBeDefined();
  });

  it("rejects client params and model output as approval", () => {
    expect(() => assertEnablementSourceNotClientOrModel({ clientParam: true })).toThrow(
      DiagnosisContractError,
    );
    expect(() => assertEnablementSourceNotClientOrModel({ modelOutput: "ok" })).toThrow(
      DiagnosisContractError,
    );
  });
});

// These historical cutover / functional rehearsals explicitly opt into writes
// against injected local ports. Default-closed behavior is covered separately
// in write-policy.test.ts; this is not production enablement.
vi.mock("./write-policy.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./write-policy.js")>();
  return {
    ...actual,
    DIAGNOSIS_WRITE_POLICY: {
      selfEvolutionConfirm: true,
      conversationDelivery: true,
      daibaiDelivery: true,
    },
  };
});
