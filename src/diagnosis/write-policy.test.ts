import { describe, expect, it, vi } from "vitest";
import { createDiagnoseConversationInject } from "./diagnose-daibai-inbox-live.js";
import { deliverDiagnoseReportToConversation } from "./diagnose-daibai-inbox.js";
import { confirmDiagnoseEvolutionPrescription } from "./diagnose-evolution-prescription.js";
import { parseDiagnoseRequest } from "./diagnose-policy.js";
import { DIAGNOSIS_SELF_EVOLUTION_CONFIRM_ENABLED } from "./diagnose-professional-protocol.js";
import { createMemoryInterventionCaseStore } from "./intervention-case-store.js";
import { attachInterventionDaibaiCanary } from "./intervention-daibai-canary.js";
import {
  DIAGNOSIS_DAIBAI_DELIVERY_ENABLED,
  resolveProductionDaibaiTransport,
} from "./production-cutover.js";
import { DIAGNOSIS_WRITE_POLICY, resolveDiagnosisWritePolicy } from "./write-policy.js";

describe("diagnosis writes default closed", () => {
  it("requires exact master approval and independent capability approval", () => {
    expect(resolveDiagnosisWritePolicy({})).toEqual({
      selfEvolutionConfirm: false,
      conversationDelivery: false,
      daibaiDelivery: false,
    });
    expect(DIAGNOSIS_WRITE_POLICY).toEqual(resolveDiagnosisWritePolicy({}));
    expect(DIAGNOSIS_SELF_EVOLUTION_CONFIRM_ENABLED).toBe(false);
    expect(DIAGNOSIS_DAIBAI_DELIVERY_ENABLED).toBe(false);
    for (const value of [undefined, "", "false", "1", "TRUE"]) {
      expect(
        resolveDiagnosisWritePolicy({
          OPENBOT_DIAGNOSIS_WRITES_ENABLED: value,
          OPENBOT_DIAGNOSIS_SELF_EVOLUTION_CONFIRM_ENABLED: "true",
        }).selfEvolutionConfirm,
      ).toBe(false);
    }
    expect(
      resolveDiagnosisWritePolicy({
        OPENBOT_DIAGNOSIS_WRITES_ENABLED: "true",
        OPENBOT_DIAGNOSIS_DAIBAI_DELIVERY_ENABLED: "true",
      }),
    ).toEqual({ selfEvolutionConfirm: false, conversationDelivery: false, daibaiDelivery: true });
  });
  it("refuses self-evolution before reading a prescription or calling cron.add", async () => {
    const add = vi.fn();
    const loadRecord = vi.fn();
    const saveRecord = vi.fn();
    const result = await confirmDiagnoseEvolutionPrescription({
      prescriptionId: "rx-local",
      tenantId: "tenant-local",
      professionalReportId: "report-local",
      callerUserId: "owner-local",
      cron: { add, list: vi.fn(async () => []) },
      loadRecord,
      saveRecord,
    });
    expect(result).toEqual({ ok: false, reason: "confirm_not_enabled" });
    expect(add).not.toHaveBeenCalled();
    expect(loadRecord).not.toHaveBeenCalled();
    expect(saveRecord).not.toHaveBeenCalled();
  });
  it("refuses Path A even with a route, tenant, requester and report", async () => {
    const send = vi.fn(async () => "accepted" as const);
    const request = parseDiagnoseRequest({ deliverTo: { enterpriseAdmin: true, owners: false } });
    const result = await deliverDiagnoseReportToConversation({
      request,
      reportText: "local report",
      tenantId: "tenant-local",
      requesterUserId: "owner-local",
      send,
    });
    expect(result.delivered).toBe(false);
    expect(result.reason).toBe("daibai_delivery_gate_closed");
    expect(send).not.toHaveBeenCalled();
    const inject = vi.fn();
    const ensureSession = vi.fn();
    const lowLevel = createDiagnoseConversationInject({ inject, ensureSession });
    expect(
      await lowLevel({
        sessionKey: "agent:main:employee:owner-local",
        userId: "owner-local",
        tenantId: "tenant-local",
        text: "report",
        route: "employee",
      }),
    ).toBe("unavailable");
    expect(inject).not.toHaveBeenCalled();
    expect(ensureSession).not.toHaveBeenCalled();
  });
  it("refuses Path B despite allowlisting", async () => {
    const send = vi.fn(async () => "accepted" as const);
    const transport = resolveProductionDaibaiTransport({ allowlisted: true, send });
    expect(
      await transport.deliver({
        schemaVersion: 1,
        signalId: "local-signal",
        kind: "scheduled",
        tenantId: "001",
        route: "enterprise",
        reasonCode: "local",
        completion: "CONFIRMED",
        findingCount: 0,
        evidenceCount: 0,
        observedAt: "2026-11-23T00:00:00Z",
        expiresAt: "2026-11-24T00:00:00Z",
      }),
    ).toBe("unavailable");
    expect(send).not.toHaveBeenCalled();
  });
  it("records default Path B canary denial without an enabled override", async () => {
    const row = await attachInterventionDaibaiCanary({
      store: createMemoryInterventionCaseStore(),
      case: {
        schemaVersion: 1,
        caseId: "ic:local-default-gate",
        tenantId: "001",
        status: "dispatched",
        actionKind: "identity",
        title: "Local canary",
        actor: "owner",
        source: { actionId: "local-action", growthAgentId: "local-agent", growthGroupId: null },
        target: {
          kind: "agent_1to1",
          agentId: "local-agent",
          sessionKey: "agent:local-agent:main",
        },
        stewardReceiptText: "local receipt",
        createdAt: "2026-11-23T00:00:00Z",
        updatedAt: "2026-11-23T00:00:00Z",
      },
    });
    expect(row.daibaiReceipt).toMatchObject({ status: "skipped", skipReason: "gate_closed" });
  });
});
