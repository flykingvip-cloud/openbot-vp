import { describe, expect, it } from "vitest";
import { coreGatewayHandlers } from "../gateway/server-methods.js";
import { GATEWAY_METHOD_PACKS } from "../gateway/server-methods/packs/registry.js";
import { createConversationLiveChatOutbound } from "./conversation-live.js";
import { createConversationDiagnosisMachine } from "./conversation-run.js";
import {
  createLiveDaibaiTransport,
  formatDiagnosisDaibaiUserVisibleDelivery,
} from "./daibai-delivery-live.js";
import {
  createDiagnosisDaibaiDeliveryQueue,
  redactDiagnosisDaibaiDelivery,
} from "./daibai-delivery.js";
import { DIAGNOSIS_ADMISSION_TENANT } from "./production-admission.js";
import type { DiagnosisIndependentApprovalInput } from "./production-approval-freeze.js";
import {
  DIAGNOSIS_CANARY_POLICY,
  DIAGNOSIS_DAIBAI_DELIVERY_ENABLED,
  DIAGNOSIS_P24_5_CANARY_TENANT,
  DIAGNOSIS_REMEDIATION_EXECUTION_ENABLED,
  bindConversationDiagnosisToLiveChat,
  clearProductionDaibaiLiveSendForTests,
  resolveProductionDaibaiTransport,
} from "./production-cutover.js";
import { isApprovedEnablementPrefixOpen } from "./production-enablement-sequence.js";
import { isOnlyDaibaiProductionGateOpen } from "./production-gate-contract.js";
import {
  DIAGNOSIS_P24_5_FROZEN_CANDIDATE_SHA,
  DIAGNOSIS_P24_5_FROZEN_LIVE_SHA,
  DIAGNOSIS_P24_5_SIGNATURE_KIND,
  assertP24_5EnablementSource,
  evaluateDiagnosisProductionP24_5,
  recordDiagnosisP24_5HumanEnablement,
  type DiagnosisP24_5HumanEnablementClaim,
} from "./production-p24.5.js";
import { DIAGNOSIS_REPORT_API_DEPLOYED } from "./report-query-deploy.js";
import { DIAGNOSIS_PRODUCTION_ADAPTERS_ENABLED } from "./report-query-production-adapters.js";
import type { DiagnosticSignal } from "./signal.js";
import { DiagnosisContractError, isDiagnosisContractError } from "./types.js";
import type { DiagnosticPrincipal, DiagnosticTarget, TrustedTenantContext } from "./types.js";

function expectCode(fn: () => unknown, code: string): void {
  try {
    fn();
    expect.unreachable("expected DiagnosisContractError");
  } catch (err) {
    expect(isDiagnosisContractError(err)).toBe(true);
    if (isDiagnosisContractError(err)) {
      expect(err.code).toBe(code);
    }
  }
}

const FROZEN = DIAGNOSIS_P24_5_FROZEN_CANDIDATE_SHA;
const LIVE = DIAGNOSIS_P24_5_FROZEN_LIVE_SHA;
const OTHER = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

function alignedInput(
  over: Partial<DiagnosisIndependentApprovalInput> = {},
): DiagnosisIndependentApprovalInput {
  return {
    candidateSha: FROZEN,
    originMainSha: FROZEN,
    liveSha: LIVE,
    liveSource: "container",
    releaseRecordSha: LIVE,
    ledgerOpenShas: [LIVE],
    provenanceTagSha: LIVE,
    originMainIsAncestorOfCandidate: true,
    liveIsAncestorOfCandidate: true,
    originMainContainsLive: true,
    livePackRegistered: false,
    coreHandlerHasDiagnosis: false,
    readerAvailable: false,
    auditAvailable: false,
    quotaAvailable: false,
    now: Date.parse("2026-09-05T15:00:00.000Z"),
    ...over,
  };
}

function enablementClaim(
  over: Partial<DiagnosisP24_5HumanEnablementClaim> = {},
): DiagnosisP24_5HumanEnablementClaim {
  return {
    kind: DIAGNOSIS_P24_5_SIGNATURE_KIND,
    increment: "P24.5",
    schemaVersion: 1,
    candidateSha: FROZEN,
    liveSha: LIVE,
    liveConversationBound: true,
    approvalOpensOnlyDaibaiGate: true,
    acceptsClientParam: false,
    acceptsModelOutput: false,
    confirmHuman: true,
    confirmOnlyDaibaiGate: true,
    confirmCanaryTenant: DIAGNOSIS_ADMISSION_TENANT,
    signer: "Daniel / CEO",
    subjects: [
      {
        subject: "gate",
        subjectId: "DIAGNOSIS_DAIBAI_DELIVERY_ENABLED",
        signer: "Daniel / CEO",
        signed: true,
        decision: "approve",
        valueAfterApproval: true,
      },
      {
        subject: "gate",
        subjectId: "DIAGNOSIS_PRODUCTION_ADAPTERS_ENABLED",
        signer: "Daniel / CEO",
        signed: true,
        decision: "approve",
        valueAfterApproval: false,
      },
      {
        subject: "gate",
        subjectId: "DIAGNOSIS_REPORT_API_DEPLOYED",
        signer: "Daniel / CEO",
        signed: true,
        decision: "approve",
        valueAfterApproval: false,
      },
      {
        subject: "gate",
        subjectId: "DIAGNOSIS_REMEDIATION_EXECUTION_ENABLED",
        signer: "Daniel / CEO",
        signed: true,
        decision: "approve",
        valueAfterApproval: false,
      },
      {
        subject: "live_conversation",
        subjectId: "live_conversation_bound",
        signer: "Daniel / CEO",
        signed: true,
        decision: "approve",
        bound: true,
      },
    ],
    ...over,
  };
}

function principal(id: string, tenantId: string | null): DiagnosticPrincipal {
  return { schemaVersion: 1, principalId: id, kind: "user", tenantId };
}

function target(tenantId = DIAGNOSIS_P24_5_CANARY_TENANT): DiagnosticTarget {
  return {
    schemaVersion: 1,
    targetType: "session",
    targetId: "session-a",
    tenantId,
    authority: "session_store",
    scope: { sessionKeyHash: "sha256:session-a" },
  };
}

function signal(over: Partial<DiagnosticSignal> = {}): DiagnosticSignal {
  return {
    schemaVersion: 1,
    signalId: "sig:p24-5:live",
    kind: "event",
    tenantId: DIAGNOSIS_P24_5_CANARY_TENANT,
    fingerprint: "p24-5-live",
    status: "open",
    target: target(),
    evidenceIds: [],
    findingIds: [],
    completion: "INCONCLUSIVE",
    reasonCode: "p24_5_live",
    occurrenceCount: 1,
    retryCount: 0,
    observedAt: "2026-09-05T15:00:00.000Z",
    lastSeenAt: "2026-09-05T15:00:00.000Z",
    expiresAt: "2026-09-05T16:00:00.000Z",
    ...over,
  };
}

describe("P24.5 enablement pack", () => {
  it("Path B: Da Bai open with adapters/report API; remediation stays closed", () => {
    expect(isOnlyDaibaiProductionGateOpen()).toBe(false);
    expect(isApprovedEnablementPrefixOpen()).toBe(false);
    expect(DIAGNOSIS_DAIBAI_DELIVERY_ENABLED).toBe(true);
    expect(DIAGNOSIS_PRODUCTION_ADAPTERS_ENABLED).toBe(true);
    expect(DIAGNOSIS_REPORT_API_DEPLOYED).toBe(true);
    expect(DIAGNOSIS_REMEDIATION_EXECUTION_ENABLED).toBe(false);
    expect(DIAGNOSIS_CANARY_POLICY.firstStage).toBe("internal_single_tenant");
    expect(DIAGNOSIS_CANARY_POLICY.started).toBe(true);
    expect(GATEWAY_METHOD_PACKS.find((pack) => pack.id === "diagnosis-reports")).toBeDefined();
    expect(coreGatewayHandlers["diagnosis.reports.query"]).toBeDefined();
  });

  it("records Daniel/CEO enablement only on an exact candidate and LIVE match", () => {
    const unsigned = evaluateDiagnosisProductionP24_5(alignedInput());
    expect(unsigned.exactIdentityMatch).toBe(true);
    expect(unsigned.humanEnablementRecorded).toBe(false);
    expect(unsigned.readyForEnablementSigning).toBe(true); // Path B: DAIBAI compile-time open
    expect(unsigned.onlyDaibaiGateOpen).toBe(false);
    const signed = evaluateDiagnosisProductionP24_5({
      ...alignedInput(),
      humanEnablement: enablementClaim(),
    });
    expect(signed.readyForEnablementSigning).toBe(true);
    expect(signed.humanEnablementRecorded).toBe(true);
    expect(signed.daibaiGateEnabled).toBe(true);
  });

  it("rejects ancestor reuse and client/model approval sources", () => {
    expect(() =>
      evaluateDiagnosisProductionP24_5({
        ...alignedInput({ candidateSha: OTHER, originMainSha: OTHER }),
        humanEnablement: enablementClaim({ candidateSha: OTHER }),
      }),
    ).toThrow(DiagnosisContractError);
    expect(() => assertP24_5EnablementSource({ clientParam: true })).toThrow(
      DiagnosisContractError,
    );
    expect(() => assertP24_5EnablementSource({ modelOutput: "ok" })).toThrow(
      DiagnosisContractError,
    );
    const unsigned = evaluateDiagnosisProductionP24_5(alignedInput());
    expect(() =>
      recordDiagnosisP24_5HumanEnablement(unsigned, enablementClaim({ liveSha: OTHER })),
    ).toThrow(DiagnosisContractError);
    expect(() =>
      recordDiagnosisP24_5HumanEnablement(
        unsigned,
        enablementClaim({
          subjects: enablementClaim().subjects.map((row) =>
            row.subject === "gate" && row.subjectId === "DIAGNOSIS_REPORT_API_DEPLOYED"
              ? { ...row, valueAfterApproval: true }
              : row,
          ),
        }),
      ),
    ).toThrow(DiagnosisContractError);
  });
});

describe("P24.5 live Da Bai transport and conversation bind", () => {
  it("delivers a redacted projection through the single chat.send write point", async () => {
    const sent: string[] = [];
    const transport = createLiveDaibaiTransport({
      sessionKey: "diagnosis:canary:daibai",
      send: async ({ text }) => {
        sent.push(text);
        return "accepted";
      },
    });
    const projection = redactDiagnosisDaibaiDelivery(signal(), "employee");
    expect(await transport.deliver(projection)).toBe("accepted");
    expect(sent[0]).toContain("【诊断提醒】");
    expect(sent[0]).not.toContain("sha256:session-a");
    expect(JSON.stringify(projection)).not.toContain("sessionKeyHash");
    expect(await transport.deliver({ ...projection, tenantId: "tenant-fixture-b" })).toBe(
      "unavailable",
    );
    expect(formatDiagnosisDaibaiUserVisibleDelivery(projection)).not.toMatch(/sandbox|批准码/);
  });

  it("reuses the P24 receipt contract and rejects a missing live send registration", async () => {
    const gateClosed = resolveProductionDaibaiTransport({ enabled: false });
    expect(await gateClosed.deliver({} as never)).toBe("unavailable");
    const queue = createDiagnosisDaibaiDeliveryQueue({
      now: () => Date.parse("2026-09-05T15:00:00.000Z"),
      transport: resolveProductionDaibaiTransport({
        enabled: true,
        send: async () => "accepted",
      }),
    });
    const first = await queue.enqueue(signal(), { sessionDomain: "employee" });
    const second = await queue.enqueue(signal(), { sessionDomain: "employee" });
    expect(first.status).toBe("accepted");
    expect(second.deliveryId).toBe(first.deliveryId);
    expectCode(
      () =>
        resolveProductionDaibaiTransport({
          enabled: true,
          allowlisted: false,
        }),
      "daibai_transport_not_allowlisted",
    );
    // Path B: bootstrap may register a live send; clear so unregistered path stays testable.
    clearProductionDaibaiLiveSendForTests();
    expectCode(
      () => resolveProductionDaibaiTransport({ enabled: true }),
      "daibai_live_transport_unregistered",
    );
  });

  it("binds conversation inbound/outbound to the same user-visible channel", async () => {
    const outbound = createConversationLiveChatOutbound({
      sessionKey: "diagnosis:canary:daibai",
      tenantId: DIAGNOSIS_P24_5_CANARY_TENANT,
      send: async ({ text }) => (text.includes("沙箱") ? "unavailable" : "accepted"),
    });
    expect(await outbound.publish("请确认是否继续收集证据")).toBe("accepted");
    expect(outbound.messages[0]).toContain("请确认是否继续收集证据");
    await expect(outbound.publish("请输入批准码")).rejects.toThrow(DiagnosisContractError);
    expectCode(() => bindConversationDiagnosisToLiveChat(), "live_chat_binding_required");
    const bound = bindConversationDiagnosisToLiveChat({
      sessionKey: "diagnosis:canary:daibai",
      tenantId: DIAGNOSIS_P24_5_CANARY_TENANT,
      send: async () => "accepted",
    });
    expect(bound).toBeTruthy();
    const trusted: TrustedTenantContext = { tenantId: DIAGNOSIS_P24_5_CANARY_TENANT };
    const machine = createConversationDiagnosisMachine({
      now: () => Date.parse("2026-09-05T15:00:00.000Z"),
      liveChat: outbound,
    });
    const started = machine.dispatch({
      commandId: "p24-5-start",
      command: "start",
      signal: signal(),
      principal: principal("user-a", DIAGNOSIS_P24_5_CANARY_TENANT),
      trusted,
    });
    expect(started.state).toBe("TRIAGING");
  });
});
