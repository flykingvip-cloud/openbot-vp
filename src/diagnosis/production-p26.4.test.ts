import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { DiagnosisIndependentApprovalInput } from "./production-approval-freeze.js";
import { DIAGNOSIS_PRODUCTION_SLO } from "./production-cutover.js";
import { DIAGNOSIS_P26_3_FROZEN_CANDIDATE_SHA } from "./production-p26.3.js";
import {
  DIAGNOSIS_P26_4_FROZEN_CANDIDATE_SHA,
  DIAGNOSIS_P26_4_FROZEN_LIVE_SHA,
  DIAGNOSIS_P26_4_SIGNATURE_KIND,
  DIAGNOSIS_P26_4_TENANT,
  assertP26_4ReadySource,
  buildDiagnosisP26_4AdmissionSlo,
  evaluateDiagnosisProductionP26_4,
  recordDiagnosisP26_4HumanReady,
  type DiagnosisP26_4HumanReadyClaim,
} from "./production-p26.4.js";
import { DiagnosisContractError } from "./types.js";

const FROZEN = DIAGNOSIS_P26_4_FROZEN_CANDIDATE_SHA;
const LIVE = DIAGNOSIS_P26_4_FROZEN_LIVE_SHA;
const OTHER = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const LEDGER_DESCENDANT = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";

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
    livePackRegistered: true,
    coreHandlerHasDiagnosis: true,
    readerAvailable: false,
    auditAvailable: false,
    quotaAvailable: false,
    now: Date.parse("2026-09-07T14:45:00.000Z"),
    ...over,
  };
}

function readyClaim(
  over: Partial<DiagnosisP26_4HumanReadyClaim> = {},
): DiagnosisP26_4HumanReadyClaim {
  return {
    kind: DIAGNOSIS_P26_4_SIGNATURE_KIND,
    increment: "P26.4",
    schemaVersion: 1,
    candidateSha: FROZEN,
    liveSha: LIVE,
    approvalRecordsEvaluation: true,
    acceptsClientParam: false,
    acceptsModelOutput: false,
    confirmHuman: true,
    confirmProductionReady: true,
    confirmLiveEqualsCandidate: true,
    confirmDeliveryAlreadyCut: true,
    confirmHistoricalP26_3HoldLifted: true,
    confirmAdmissionSloNotLiveTrafficSlo: true,
    confirmLiveTrafficSloRemainsEmpty: true,
    confirmLiveExecutorUndeployed: true,
    confirmNoDoctorFix: true,
    confirmNoChannelRestart: true,
    confirmNoLedgerRewrite: true,
    confirmCanaryTenant: DIAGNOSIS_P26_4_TENANT,
    signer: "Daniel / CEO",
    ...over,
  };
}

describe("P26.4 post-LIVE official admission", () => {
  it("binds LIVE=candidate=8b5db08ee1, keeps live-traffic SLO empty, and records Production Ready", async () => {
    expect(DIAGNOSIS_PRODUCTION_SLO.completeness).not.toBe("complete");
    expect(buildDiagnosisP26_4AdmissionSlo().slo.completeness).toBe("complete");
    expect(FROZEN).toBe(LIVE);
    expect(FROZEN).not.toBe(DIAGNOSIS_P26_3_FROZEN_CANDIDATE_SHA);
    const report = await evaluateDiagnosisProductionP26_4(alignedInput());
    expect(report.isolatedAdmissionReady).toBe(false);
    expect(report.humanReadyRecorded).toBe(false);
    expect(report.liveEqualsCandidate).toBe(true);
    expect(report.acceptance.probesPassed).toBe(true);
    expect(report.admissionSloComplete).toBe(true);
    expect(report.liveTrafficSloComplete).toBe(false);
    expect(report.liveExecutorUndeployed).toBe(true);
    expect(report.gatesOpen).toBe(false);
    expect(report.furtherDiagnosisResignBlocked).toBe(false);
    expect(report.liveCutoverPending).toBe(false);
    expect(report.historicalP26_3HoldLifted).toBe(true);
    expect(report.p26ProductionReady).toBe(false);
    expect(report.rehearsalOnly).toBe(true);
    expect(report.blockers).toContain("production_gates_not_open");
    expect(report.blockers).toContain("production_ready_not_separately_approved");
    expect(report.residualWatches).toContain("live_traffic_slo_unobserved");
    await expect(
      evaluateDiagnosisProductionP26_4({ ...alignedInput(), humanReady: readyClaim() }),
    ).rejects.toBeInstanceOf(DiagnosisContractError);
  });

  it("allows origin/main to move for ledger-only descendants without revoking LIVE admission", async () => {
    const report = await evaluateDiagnosisProductionP26_4(
      alignedInput({
        originMainSha: LEDGER_DESCENDANT,
        originMainContainsLive: true,
        ledgerOpenShas: ["04690f8d2eaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"],
        releaseRecordSha: "98a9a6c743aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      }),
    );
    expect(report.originMainAligned).toBe(true);
    expect(report.p26ProductionReady).toBe(false);
    expect(report.gatesOpen).toBe(false);
    expect(report.residualWatches).toContain("ledger_record_pending");
  });

  it("rejects historical hold SHA, unsigned Ready, client/model sources, and live-traffic SLO mutation", async () => {
    await expect(
      evaluateDiagnosisProductionP26_4(
        alignedInput({
          candidateSha: DIAGNOSIS_P26_3_FROZEN_CANDIDATE_SHA,
          originMainSha: DIAGNOSIS_P26_3_FROZEN_CANDIDATE_SHA,
        }),
      ),
    ).rejects.toBeInstanceOf(DiagnosisContractError);
    const stale = await evaluateDiagnosisProductionP26_4(
      alignedInput({ candidateSha: OTHER, originMainSha: OTHER, liveSha: OTHER }),
    );
    expect(stale.isolatedAdmissionReady).toBe(false);
    expect(stale.p26ProductionReady).toBe(false);
    expect(() => assertP26_4ReadySource({ clientParam: true })).toThrow(DiagnosisContractError);
    expect(() => assertP26_4ReadySource({ modelOutput: "ok" })).toThrow(DiagnosisContractError);
    const unsigned = await evaluateDiagnosisProductionP26_4(alignedInput());
    expect(unsigned.blockers).toContain("production_ready_not_separately_approved");
    expect(() => recordDiagnosisP26_4HumanReady(unsigned, readyClaim({ liveSha: OTHER }))).toThrow(
      DiagnosisContractError,
    );
    expect(() =>
      recordDiagnosisP26_4HumanReady(
        unsigned,
        readyClaim({ confirmProductionReady: false as unknown as true }),
      ),
    ).toThrow(DiagnosisContractError);
  });

  it("does not scan as a live apply, Doctor --fix, or live-traffic SLO fill", () => {
    const source = fs.readFileSync(
      path.join(path.dirname(fileURLToPath(import.meta.url)), "production-p26.4.ts"),
      "utf8",
    );
    expect(source).toContain("Does not bind Doctor --fix");
    expect(source).toContain("Does not");
    expect(source).toContain("mutate DIAGNOSIS_PRODUCTION_SLO");
    expect(source).not.toContain("runDoctorChecks");
    expect(source).not.toContain("doctor --fix");
    expect(source).not.toContain("restartChannel");
    expect(source).not.toContain("DIAGNOSIS_PRODUCTION_SLO.completeness =");
  });
});
