import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { coreGatewayHandlers } from "../gateway/server-methods.js";
import { GATEWAY_METHOD_PACKS } from "../gateway/server-methods/packs/registry.js";
import type { DiagnosisIndependentApprovalInput } from "./production-approval-freeze.js";
import {
  DIAGNOSIS_DAIBAI_DELIVERY_ENABLED,
  DIAGNOSIS_REMEDIATION_EXECUTION_ENABLED,
} from "./production-cutover.js";
import {
  DIAGNOSIS_P22_REQUIRED_ROLES,
  DIAGNOSIS_P22_SIGNATURE_KIND,
  DIAGNOSIS_PRODUCTION_P22_INCREMENT,
  assertDiagnosisProductionP22Closed,
  assertHumanApprovalSource,
  buildDiagnosisP22RoleApprovalPacks,
  evaluateDiagnosisProductionP22,
  freezeDiagnosisP22ApprovalGates,
  recordDiagnosisP22HumanApproval,
  renderDiagnosisP22ApprovalMarkdown,
  renderDiagnosisProductionP22Markdown,
  type DiagnosisP22HumanApprovalClaim,
} from "./production-p22.js";
import { DIAGNOSIS_P5_CONTRACT_SIGNED } from "./production-preflight.js";
import { DIAGNOSIS_REPORT_API_DEPLOYED } from "./report-query-deploy.js";
import { DIAGNOSIS_PRODUCTION_ADAPTERS_ENABLED } from "./report-query-production-adapters.js";
import { DiagnosisContractError } from "./types.js";

const SHA_A = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const SHA_B = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
const here = path.dirname(fileURLToPath(import.meta.url));

function alignedInput(
  over: Partial<DiagnosisIndependentApprovalInput> = {},
): DiagnosisIndependentApprovalInput {
  return {
    candidateSha: SHA_A,
    originMainSha: SHA_A,
    liveSha: SHA_A,
    liveSource: "container",
    releaseRecordSha: SHA_A,
    ledgerOpenShas: [SHA_A],
    provenanceTagSha: SHA_A,
    originMainIsAncestorOfCandidate: true,
    liveIsAncestorOfCandidate: true,
    originMainContainsLive: true,
    livePackRegistered: false,
    coreHandlerHasDiagnosis: false,
    readerAvailable: false,
    auditAvailable: false,
    quotaAvailable: false,
    now: Date.parse("2026-09-05T05:30:00.000Z"),
    ...over,
  };
}

describe("P22 role and gate freeze", () => {
  it("lists approval items for the four required roles", () => {
    const packs = buildDiagnosisP22RoleApprovalPacks();
    expect(packs.map((row) => row.role)).toEqual([...DIAGNOSIS_P22_REQUIRED_ROLES]);
    for (const pack of packs) {
      expect(pack.items.length).toBeGreaterThan(0);
      expect(pack.signature.kind).toBe(DIAGNOSIS_P22_SIGNATURE_KIND);
      expect(pack.signature.signed).toBe(false);
      expect(pack.signature.acceptsClientParam).toBe(false);
      expect(pack.signature.acceptsModelOutput).toBe(false);
      expect(pack.signature.approvalDoesNotOpenGate).toBe(true);
    }
  });

  it("freezes four gates with preconditions, approver, audit, and rollback", () => {
    const gates = freezeDiagnosisP22ApprovalGates();
    expect(gates.map((row) => row.name)).toEqual([
      "DIAGNOSIS_PRODUCTION_ADAPTERS_ENABLED",
      "DIAGNOSIS_REPORT_API_DEPLOYED",
      "DIAGNOSIS_DAIBAI_DELIVERY_ENABLED",
      "DIAGNOSIS_REMEDIATION_EXECUTION_ENABLED",
    ]);
    for (const gate of gates) {
      expect(gate.value).toBe(false);
      expect(gate.approver.length).toBeGreaterThan(0);
      expect(gate.preconditions.length).toBeGreaterThan(0);
      expect(gate.auditReceipt).toBe("pending_human_approval");
      expect(gate.rollback.length).toBeGreaterThan(0);
      expect(gate.approvalDoesNotOpenGate).toBe(true);
      expect(gate.signature.signed).toBe(false);
      expect(gate.signature.requiredEvidence.length).toBeGreaterThan(0);
    }
  });
});

describe("P22 signature format", () => {
  it("rejects client parameters and model output as approval", () => {
    expect(() => assertHumanApprovalSource({})).not.toThrow();
    expect(() => assertHumanApprovalSource({ kind: DIAGNOSIS_P22_SIGNATURE_KIND })).not.toThrow();
    expect(() => assertHumanApprovalSource({ kind: "client_param" })).toThrow(
      DiagnosisContractError,
    );
    expect(() => assertHumanApprovalSource({ clientParam: "enable=1" })).toThrow(
      DiagnosisContractError,
    );
    expect(() => assertHumanApprovalSource({ kind: "model_output" })).toThrow(
      DiagnosisContractError,
    );
    expect(() => assertHumanApprovalSource({ modelOutput: "approve" })).toThrow(
      DiagnosisContractError,
    );
  });
});

describe("P22 independent approval pack", () => {
  it("is immediate No-Go when identity diverges", async () => {
    const report = await evaluateDiagnosisProductionP22(
      alignedInput({
        liveSha: SHA_A,
        ledgerOpenShas: [SHA_B],
        releaseRecordSha: SHA_A,
        provenanceTagSha: SHA_A,
      }),
    );
    expect(report.readyForIndependentApproval).toBe(false);
    expect(report.p20HardConditions).toBe(false);
    expect(report.approvedForProductionCutover).toBe(false);
    expect(report.gatesOpened).toBe(false);
    expect(() => assertDiagnosisProductionP22Closed(report)).not.toThrow();
    expect(renderDiagnosisProductionP22Markdown(report)).toContain("No-Go");
  });

  it("becomes Ready only when P20 and P21 hard conditions hold, without opening gates", async () => {
    const report = await evaluateDiagnosisProductionP22(alignedInput());
    expect(report.increment).toBe(DIAGNOSIS_PRODUCTION_P22_INCREMENT);
    expect(report.readyForIndependentApproval).toBe(true);
    expect(report.p20HardConditions).toBe(true);
    expect(report.p21HardConditions).toBe(true);
    expect(report.p21.readyForIndependentApproval).toBe(true);
    expect(report.p21.slo.completeness).toBe("complete");
    expect(report.humanApprovalRecorded).toBe(false);
    expect(report.pendingApprovers).toEqual([...DIAGNOSIS_P22_REQUIRED_ROLES]);
    expect(report.signatures).toHaveLength(8);
    expect(report.signatures.every((slot) => !slot.signed)).toBe(true);
    expect(report.approvedForProductionCutover).toBe(false);
    expect(report.gatesOpened).toBe(false);
    expect(report.trafficSwitched).toBe(false);
    expect(report.approvalDoesNotOpenGate).toBe(true);
    expect(report.gates.every((gate) => !gate.value)).toBe(true);
    expect(renderDiagnosisP22ApprovalMarkdown(report)).toContain("Ready for independent approval");
    expect(renderDiagnosisP22ApprovalMarkdown(report)).toContain("approval ≠ enable");
    expect(() => assertDiagnosisProductionP22Closed(report)).not.toThrow();
  });

  it("does not scan as a live enablement or ledger rewrite", () => {
    const source = fs.readFileSync(path.join(here, "production-p22.ts"), "utf8");
    expect(source).toContain("Approval never");
    expect(source).toContain("auto-enables a gate");
    expect(source).not.toContain("DIAGNOSIS_REPORT_API_DEPLOYED = true");
    expect(source).not.toContain("GATEWAY_METHOD_PACKS.push");
    expect(source).not.toContain("user.daibai.ask");
    expect(source).not.toContain("--fix");
    expect(source).not.toContain("releases.jsonl");
    expect(source).not.toContain("RELEASE_RECORD.md");
    expect(GATEWAY_METHOD_PACKS.find((pack) => pack.id === "diagnosis-reports")).toBeDefined();
    expect(coreGatewayHandlers["diagnosis.reports.query"]).toBeDefined();
    expect(DIAGNOSIS_REPORT_API_DEPLOYED).toBe(true);
    expect(DIAGNOSIS_PRODUCTION_ADAPTERS_ENABLED).toBe(true);
    expect(DIAGNOSIS_DAIBAI_DELIVERY_ENABLED).toBe(true);
    expect(DIAGNOSIS_REMEDIATION_EXECUTION_ENABLED).toBe(false);
    expect(DIAGNOSIS_P5_CONTRACT_SIGNED).toBe(true);
  });
});

function humanClaim(
  over: Partial<DiagnosisP22HumanApprovalClaim> = {},
): DiagnosisP22HumanApprovalClaim {
  const signer = "Daniel / CEO";
  return {
    kind: DIAGNOSIS_P22_SIGNATURE_KIND,
    increment: "P22",
    schemaVersion: 1,
    candidateSha: SHA_A,
    liveSha: SHA_A,
    approvalDoesNotOpenGate: true,
    acceptsClientParam: false,
    acceptsModelOutput: false,
    confirmHuman: true,
    confirmDoesNotOpenGate: true,
    confirmDoesNotStartP23: true,
    subjects: [
      ...DIAGNOSIS_P22_REQUIRED_ROLES.map((role) => ({
        subject: "role" as const,
        subjectId: role,
        signer,
        signed: true as const,
        decision: "approve" as const,
      })),
      ...freezeDiagnosisP22ApprovalGates().map((gate) => ({
        subject: "gate" as const,
        subjectId: gate.name,
        signer,
        signed: true as const,
        decision: "approve" as const,
        valueAfterApproval: false as const,
      })),
    ],
    ...over,
  };
}

describe("P22 human approval recording", () => {
  it("records a complete human pack without opening gates", async () => {
    const recorded = recordDiagnosisP22HumanApproval(
      await evaluateDiagnosisProductionP22(alignedInput()),
      humanClaim(),
      { now: Date.parse("2026-09-05T06:05:00.000Z") },
    );
    expect(recorded.humanApprovalRecorded).toBe(true);
    expect(recorded.pendingApprovers).toEqual([]);
    expect(recorded.signatures).toHaveLength(8);
    expect(
      recorded.signatures.every((slot) => slot.signed && slot.signedBy === "Daniel / CEO"),
    ).toBe(true);
    expect(recorded.gates.every((gate) => !gate.value && gate.approvalDoesNotOpenGate)).toBe(true);
    expect(recorded.approvedForProductionCutover).toBe(false);
    expect(recorded.gatesOpened).toBe(false);
    expect(renderDiagnosisP22ApprovalMarkdown(recorded)).toContain("Human approval recorded");
    expect(() => assertDiagnosisProductionP22Closed(recorded)).not.toThrow();
  });

  it("rejects a signature bound to a different LIVE or candidate", async () => {
    const ready = await evaluateDiagnosisProductionP22(alignedInput());
    expect(() => recordDiagnosisP22HumanApproval(ready, humanClaim({ liveSha: SHA_B }))).toThrow(
      DiagnosisContractError,
    );
    expect(() =>
      recordDiagnosisP22HumanApproval(ready, humanClaim({ candidateSha: SHA_B })),
    ).toThrow(DiagnosisContractError);
  });

  it("rejects a claim that would open a gate", async () => {
    const ready = await evaluateDiagnosisProductionP22(alignedInput());
    const claim = humanClaim();
    const opened = claim.subjects.map((row) =>
      row.subjectId === "DIAGNOSIS_REPORT_API_DEPLOYED"
        ? { ...row, valueAfterApproval: undefined }
        : row,
    );
    expect(() => recordDiagnosisP22HumanApproval(ready, { ...claim, subjects: opened })).toThrow(
      DiagnosisContractError,
    );
  });

  it("carries a recorded signature when the signed candidate is an ancestor", async () => {
    const ready = await evaluateDiagnosisProductionP22(
      alignedInput({
        candidateSha: SHA_B,
        originMainSha: SHA_B,
      }),
    );
    expect(ready.readyForIndependentApproval).toBe(true);
    expect(() => recordDiagnosisP22HumanApproval(ready, humanClaim())).toThrow(
      DiagnosisContractError,
    );
    const recorded = recordDiagnosisP22HumanApproval(ready, humanClaim(), {
      signedCandidateIsAncestorOfCurrent: true,
    });
    expect(recorded.humanApprovalRecorded).toBe(true);
    expect(recorded.gates.every((gate) => !gate.value)).toBe(true);
  });

  it("carries a recorded signature when the signed LIVE is an ancestor", async () => {
    const ready = await evaluateDiagnosisProductionP22(alignedInput());
    expect(ready.readyForIndependentApproval).toBe(true);
    expect(() => recordDiagnosisP22HumanApproval(ready, humanClaim({ liveSha: SHA_B }))).toThrow(
      DiagnosisContractError,
    );
    const recorded = recordDiagnosisP22HumanApproval(ready, humanClaim({ liveSha: SHA_B }), {
      signedLiveIsAncestorOfCurrent: true,
    });
    expect(recorded.humanApprovalRecorded).toBe(true);
    expect(recorded.gates.every((gate) => !gate.value)).toBe(true);
  });

  it("rejects model output, client params, and a missing role", async () => {
    const ready = await evaluateDiagnosisProductionP22(alignedInput());
    expect(() =>
      recordDiagnosisP22HumanApproval(ready, {
        ...humanClaim(),
        kind: "model_output" as DiagnosisP22HumanApprovalClaim["kind"],
      }),
    ).toThrow(DiagnosisContractError);
    expect(() =>
      recordDiagnosisP22HumanApproval(ready, {
        ...humanClaim(),
        acceptsClientParam: true as unknown as false,
      }),
    ).toThrow(DiagnosisContractError);
    const missingEmployee = humanClaim().subjects.filter((row) => row.subjectId !== "employee");
    expect(() =>
      recordDiagnosisP22HumanApproval(ready, { ...humanClaim(), subjects: missingEmployee }),
    ).toThrow(DiagnosisContractError);
  });
});
