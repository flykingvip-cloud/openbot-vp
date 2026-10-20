/**
 * Phase 22 — freeze the independent approval pack for human signing.
 * Consumes P21 isolated preprod evidence and P14 freeze helpers.
 * Does not open gates, register live packs, mint provenance tags,
 * rewrite the release ledger, or switch traffic. Approval never
 * auto-enables a gate. Client params and model output are not approvals.
 */
import {
  buildDiagnosisRoleApprovalPack,
  evaluateDiagnosisLedgerRepair,
  freezeDiagnosisApprovalGates,
  type DiagnosisApprovalRole,
  type DiagnosisFrozenGate,
  type DiagnosisIndependentApprovalInput,
  type DiagnosisLedgerRepairDecision,
  type DiagnosisRoleApprovalPack,
} from "./production-approval-freeze.js";
import { isUnapprovedProductionGateOpen } from "./production-enablement-sequence.js";
import {
  evaluateDiagnosisProductionP21,
  type DiagnosisProductionP21Report,
} from "./production-p21.js";
import { DiagnosisContractError } from "./types.js";

export const DIAGNOSIS_PRODUCTION_P22_INCREMENT = "P22" as const;
export const DIAGNOSIS_PRODUCTION_P22_SCHEMA_VERSION = 1 as const;
export const DIAGNOSIS_P22_APPROVAL_DOES_NOT_OPEN_GATES = true;
export const DIAGNOSIS_P22_SIGNATURE_KIND = "human_independent_approval_record" as const;

export const DIAGNOSIS_P22_REQUIRED_ROLES = [
  "platform_security",
  "enterprise_admin",
  "employee",
  "delivery_ledger_owner",
] as const satisfies readonly DiagnosisApprovalRole[];

export type DiagnosisApprovalSourceClaim = {
  kind?: string;
  clientParam?: unknown;
  modelOutput?: unknown;
};

export type DiagnosisP22SignatureReceipt =
  | "pending_human_approval"
  | "human_independent_approval_recorded";

export type DiagnosisP22SignatureSlot = {
  kind: typeof DIAGNOSIS_P22_SIGNATURE_KIND;
  increment: typeof DIAGNOSIS_PRODUCTION_P22_INCREMENT;
  schemaVersion: 1;
  subject: "gate" | "role";
  subjectId: string;
  requiredApprover: string;
  requiredEvidence: readonly string[];
  acceptsClientParam: false;
  acceptsModelOutput: false;
  signed: boolean;
  signedBy: string | null;
  signedAt: string | null;
  receipt: DiagnosisP22SignatureReceipt;
  approvalDoesNotOpenGate: true;
};

export type DiagnosisP22HumanSubjectClaim = {
  subject: "role" | "gate";
  subjectId: string;
  signer: string;
  signed: true;
  decision: "approve";
  valueAfterApproval?: false;
};

export type DiagnosisP22HumanApprovalClaim = {
  kind: typeof DIAGNOSIS_P22_SIGNATURE_KIND;
  increment: typeof DIAGNOSIS_PRODUCTION_P22_INCREMENT;
  schemaVersion: 1;
  candidateSha: string;
  liveSha: string;
  approvalDoesNotOpenGate: true;
  acceptsClientParam: false;
  acceptsModelOutput: false;
  confirmHuman: true;
  confirmDoesNotOpenGate: true;
  confirmDoesNotStartP23: true;
  subjects: DiagnosisP22HumanSubjectClaim[];
};

export type DiagnosisP22FrozenGate = DiagnosisFrozenGate & {
  signature: DiagnosisP22SignatureSlot;
};

export type DiagnosisP22RoleApprovalPack = DiagnosisRoleApprovalPack & {
  signature: DiagnosisP22SignatureSlot;
};

export type DiagnosisProductionP22Report = {
  increment: typeof DIAGNOSIS_PRODUCTION_P22_INCREMENT;
  schemaVersion: 1;
  rehearsalOnly: true;
  readyForIndependentApproval: boolean;
  approvedForProductionCutover: false;
  gatesOpened: false;
  trafficSwitched: false;
  approvalDoesNotOpenGate: true;
  injection: {
    serverConfigOnly: true;
    clientEnableForbidden: true;
    implicitEnableForbidden: true;
  };
  identityAligned: boolean;
  p20HardConditions: boolean;
  p21HardConditions: boolean;
  repair: DiagnosisLedgerRepairDecision;
  p21: DiagnosisProductionP21Report;
  roleApprovals: DiagnosisP22RoleApprovalPack[];
  gates: DiagnosisP22FrozenGate[];
  signatures: DiagnosisP22SignatureSlot[];
  pendingApprovers: DiagnosisApprovalRole[];
  humanApprovalRecorded: boolean;
  standaloneProductionNote: string;
  recordedAt: string;
};

function fail(code: string, message: string, path = ""): never {
  throw new DiagnosisContractError(code, message, path);
}

const GATE_EVIDENCE: Record<DiagnosisFrozenGate["id"], readonly string[]> = {
  adapters: [
    "p20_identity_aligned",
    "p21_isolated_reader_audit_quota_injected",
    "p21_fault_injection_passed",
    "p21_isolated_slo_complete",
    "independent_platform_security_approval",
  ],
  reportApi: [
    "p20_identity_aligned",
    "adapters_approved_but_not_enabled",
    "live_pack_not_self_registered",
    "p21_isolated_slo_complete",
    "independent_platform_security_approval",
  ],
  daibaiDelivery: [
    "p20_identity_aligned",
    "p5_contract_signed",
    "allowlisted_transport",
    "delegation_guard_bound",
    "p21_isolated_slo_complete",
    "platform_security_and_enterprise_admin_approval",
  ],
  remediationExecution: [
    "p20_identity_aligned",
    "allowlisted_executor",
    "human_approval_for_high_risk",
    "p21_isolated_slo_complete",
    "platform_security_enterprise_admin_and_employee_approval",
  ],
};

function unsignedSlot(input: {
  subject: "gate" | "role";
  subjectId: string;
  requiredApprover: string;
  requiredEvidence: readonly string[];
}): DiagnosisP22SignatureSlot {
  return {
    kind: DIAGNOSIS_P22_SIGNATURE_KIND,
    increment: DIAGNOSIS_PRODUCTION_P22_INCREMENT,
    schemaVersion: DIAGNOSIS_PRODUCTION_P22_SCHEMA_VERSION,
    subject: input.subject,
    subjectId: input.subjectId,
    requiredApprover: input.requiredApprover,
    requiredEvidence: input.requiredEvidence,
    acceptsClientParam: false,
    acceptsModelOutput: false,
    signed: false,
    signedBy: null,
    signedAt: null,
    receipt: "pending_human_approval",
    approvalDoesNotOpenGate: true,
  };
}

export function assertHumanApprovalSource(claim: DiagnosisApprovalSourceClaim): void {
  if (claim.kind === "client_param" || claim.clientParam !== undefined) {
    fail(
      "client_param_approval_forbidden",
      "client parameters are not an independent approval",
      "approval",
    );
  }
  if (claim.kind === "model_output" || claim.modelOutput !== undefined) {
    fail(
      "model_output_approval_forbidden",
      "model output is not an independent approval",
      "approval",
    );
  }
  if (claim.kind !== undefined && claim.kind !== DIAGNOSIS_P22_SIGNATURE_KIND) {
    fail("unknown_approval_source", `unsupported approval source ${claim.kind}`, "approval");
  }
}

export function buildDiagnosisP22RoleApprovalPacks(): DiagnosisP22RoleApprovalPack[] {
  return buildDiagnosisRoleApprovalPack().map((pack) => ({
    ...pack,
    signature: unsignedSlot({
      subject: "role",
      subjectId: pack.role,
      requiredApprover: pack.role,
      requiredEvidence: pack.items,
    }),
  }));
}

export function freezeDiagnosisP22ApprovalGates(): DiagnosisP22FrozenGate[] {
  return freezeDiagnosisApprovalGates().map((gate) => ({
    ...gate,
    signature: unsignedSlot({
      subject: "gate",
      subjectId: gate.name,
      requiredApprover: gate.approver,
      requiredEvidence: GATE_EVIDENCE[gate.id],
    }),
  }));
}

export async function evaluateDiagnosisProductionP22(
  input: DiagnosisIndependentApprovalInput,
): Promise<DiagnosisProductionP22Report> {
  const repair = evaluateDiagnosisLedgerRepair(input);
  const p21 = await evaluateDiagnosisProductionP21(input);
  const roleApprovals = buildDiagnosisP22RoleApprovalPacks();
  const gates = freezeDiagnosisP22ApprovalGates();
  const signatures = [
    ...roleApprovals.map((row) => row.signature),
    ...gates.map((row) => row.signature),
  ];
  const rolesComplete = DIAGNOSIS_P22_REQUIRED_ROLES.every((role) =>
    roleApprovals.some((pack) => pack.role === role && pack.items.length > 0),
  );
  const gatesFrozen =
    gates.length === 4 && gates.every((gate) => !gate.value && gate.approvalDoesNotOpenGate);
  const signaturesValid = signatures.every(
    (slot) =>
      slot.kind === DIAGNOSIS_P22_SIGNATURE_KIND &&
      !slot.acceptsClientParam &&
      !slot.acceptsModelOutput &&
      !slot.signed &&
      slot.signedBy === null &&
      slot.receipt === "pending_human_approval" &&
      slot.approvalDoesNotOpenGate,
  );
  const p20HardConditions = repair.aligned && p21.identityAligned;
  const p21HardConditions =
    p21.dependenciesVerified &&
    p21.faultsPassed &&
    p21.slo.completeness === "complete" &&
    p21.readyForIndependentApproval;
  const readyForIndependentApproval =
    p20HardConditions &&
    p21HardConditions &&
    rolesComplete &&
    gatesFrozen &&
    signaturesValid &&
    !isUnapprovedProductionGateOpen();
  return {
    increment: DIAGNOSIS_PRODUCTION_P22_INCREMENT,
    schemaVersion: DIAGNOSIS_PRODUCTION_P22_SCHEMA_VERSION,
    rehearsalOnly: true,
    readyForIndependentApproval,
    approvedForProductionCutover: false,
    gatesOpened: false,
    trafficSwitched: false,
    approvalDoesNotOpenGate: DIAGNOSIS_P22_APPROVAL_DOES_NOT_OPEN_GATES,
    injection: {
      serverConfigOnly: true,
      clientEnableForbidden: true,
      implicitEnableForbidden: true,
    },
    identityAligned: p20HardConditions,
    p20HardConditions,
    p21HardConditions,
    repair,
    p21,
    roleApprovals,
    gates,
    signatures,
    pendingApprovers: [...DIAGNOSIS_P22_REQUIRED_ROLES],
    humanApprovalRecorded: false,
    standaloneProductionNote:
      "Standalone production-preflight / trunk-convergence remain empty-SLO/fail-closed. P22 Ready uses P21 isolated preprod evidence and must not be treated as live diagnosis traffic or as an opened gate.",
    recordedAt: new Date(input.now ?? Date.parse("2026-09-05T05:30:00.000Z")).toISOString(),
  };
}

function packStatus(report: DiagnosisProductionP22Report): string {
  if (report.humanApprovalRecorded) {
    return "Human approval recorded. Approval ≠ enable";
  }
  return report.readyForIndependentApproval ? "Ready for independent approval" : "No-Go";
}

export function recordDiagnosisP22HumanApproval(
  report: DiagnosisProductionP22Report,
  claim: DiagnosisP22HumanApprovalClaim,
  input: {
    now?: number;
    signedCandidateIsAncestorOfCurrent?: boolean;
    signedLiveIsAncestorOfCurrent?: boolean;
  } = {},
): DiagnosisProductionP22Report {
  assertHumanApprovalSource(claim);
  if (!report.readyForIndependentApproval) {
    fail("pack_not_ready", "P22 pack is not ready for human signature", "approval");
  }
  if (
    !claim.confirmHuman ||
    !claim.confirmDoesNotOpenGate ||
    !claim.confirmDoesNotStartP23 ||
    !claim.approvalDoesNotOpenGate
  ) {
    fail("human_confirm_missing", "human confirmation flags are required", "approval");
  }
  if (claim.acceptsClientParam || claim.acceptsModelOutput) {
    fail("non_human_source", "recorded approval must reject client and model sources", "approval");
  }
  const candidateSha = report.p21.preflight.identities.candidateSha;
  const liveSha = report.repair.liveSha;
  if (normalizeSha(claim.candidateSha) !== normalizeSha(candidateSha)) {
    if (!input.signedCandidateIsAncestorOfCurrent) {
      fail(
        "candidate_mismatch",
        "human signature is bound to a different candidate SHA",
        "approval",
      );
    }
  }
  if (normalizeSha(claim.liveSha) !== normalizeSha(liveSha)) {
    // Official unified-window cutover may move LIVE forward. The signed pack
    // stays a closed-gate record on an ancestor LIVE; it does not re-bind or
    // open enablement.
    if (!input.signedLiveIsAncestorOfCurrent) {
      fail("live_mismatch", "human signature is bound to a different LIVE SHA", "approval");
    }
  }
  const recordedAt = new Date(input.now ?? Date.now()).toISOString();
  const bySubject = new Map(
    claim.subjects.map((row) => [`${row.subject}:${row.subjectId}`, row] as const),
  );
  for (const role of DIAGNOSIS_P22_REQUIRED_ROLES) {
    const row = bySubject.get(`role:${role}`);
    if (!row?.signed || row.decision !== "approve" || !row.signer.trim()) {
      fail("role_signature_missing", `missing human approve for role ${role}`, "approval");
    }
  }
  const signedGates = report.gates.map((gate) => {
    const row = bySubject.get(`gate:${gate.name}`);
    if (!row?.signed || row.decision !== "approve" || !row.signer.trim()) {
      fail("gate_signature_missing", `missing human approve for ${gate.name}`, "approval");
    }
    if (row.valueAfterApproval !== false) {
      fail(
        "approval_opens_gate",
        "human approval must keep value_after_approval=false",
        "approval",
      );
    }
    return {
      ...gate,
      value: false as const,
      auditReceipt: "human_independent_approval_recorded",
      signature: {
        ...gate.signature,
        signed: true,
        signedBy: row.signer.trim(),
        signedAt: recordedAt,
        receipt: "human_independent_approval_recorded" as const,
        approvalDoesNotOpenGate: true as const,
      },
    };
  });
  const signedRoles = report.roleApprovals.map((pack) => {
    const row = bySubject.get(`role:${pack.role}`);
    if (!row) {
      fail("role_signature_missing", `missing human approve for role ${pack.role}`, "approval");
    }
    return {
      ...pack,
      signature: {
        ...pack.signature,
        signed: true,
        signedBy: row.signer.trim(),
        signedAt: recordedAt,
        receipt: "human_independent_approval_recorded" as const,
        approvalDoesNotOpenGate: true as const,
      },
    };
  });
  const signatures = [
    ...signedRoles.map((row) => row.signature),
    ...signedGates.map((row) => row.signature),
  ];
  return {
    ...report,
    approvedForProductionCutover: false,
    gatesOpened: false,
    trafficSwitched: false,
    approvalDoesNotOpenGate: true,
    roleApprovals: signedRoles,
    gates: signedGates,
    signatures,
    pendingApprovers: [],
    humanApprovalRecorded: true,
    recordedAt,
  };
}

function normalizeSha(sha: string | null | undefined): string | null {
  if (!sha) {
    return null;
  }
  const trimmed = sha.trim().toLowerCase();
  return /^[0-9a-f]{40}$/.test(trimmed) ? trimmed : null;
}

export function renderDiagnosisP22ApprovalMarkdown(report: DiagnosisProductionP22Report): string {
  return [
    `# OpenBot Diagnosis P22 Independent Approval Pack`,
    ``,
    `Status: **${packStatus(report)}**.`,
    `P22 ≠ 生产部署。gatesOpened=${String(report.gatesOpened)} approvalDoesNotOpenGate=${String(report.approvalDoesNotOpenGate)} approvedForProductionCutover=${String(report.approvedForProductionCutover)} humanApprovalRecorded=${String(report.humanApprovalRecorded)}.`,
    ``,
    `## Identity and evidence`,
    ``,
    `- P20 hard conditions: ${String(report.p20HardConditions)}`,
    `- P21 hard conditions: ${String(report.p21HardConditions)}`,
    `- LIVE: \`${report.repair.liveSha ?? "unknown"}\` source=${report.repair.liveSource}`,
    `- ledger: \`${report.repair.ledgerOpenSha ?? "unknown"}\` action=${report.repair.ledgerAction}`,
    `- RELEASE_RECORD: \`${report.repair.releaseRecordSha ?? "unknown"}\` action=${report.repair.releaseRecordAction}`,
    `- provenance: \`${report.repair.provenanceTagSha ?? "unknown"}\` action=${report.repair.provenanceAction}`,
    `- aligned: ${String(report.repair.aligned)}`,
    `- P21 isolated deps verified: ${String(report.p21.dependenciesVerified)}`,
    `- P21 faults passed: ${String(report.p21.faultsPassed)}`,
    `- P21 SLO completeness: ${report.p21.slo.completeness}`,
    ...report.repair.blockers.map((row) => `- blocker: ${row}`),
    ...report.repair.evidenceGaps.map((row) => `- evidence gap: ${row}`),
    ``,
    `## Role approvals`,
    ``,
    ...report.roleApprovals.flatMap((pack) => [
      `- ${pack.role} signed=${String(pack.signature.signed)} signer=${pack.signature.signedBy ?? "none"} receipt=${pack.signature.receipt}`,
      ...pack.items.map((item) => `  - ${item}`),
    ]),
    ``,
    `## Gates (approval ≠ enable)`,
    ``,
    `| Gate | value | approver | rollback | signed |`,
    `| --- | --- | --- | --- | --- |`,
    ...report.gates.map(
      (gate) =>
        `| ${gate.name} | ${String(gate.value)} | ${gate.approver} | ${gate.rollback} | ${String(gate.signature.signed)} |`,
    ),
    ``,
    ...report.gates.flatMap((gate) => [
      `- ${gate.name} preconditions: ${gate.preconditions.join(", ")}`,
      `- ${gate.name} audit: ${gate.auditReceipt}`,
      `- ${gate.name} evidence: ${gate.signature.requiredEvidence.join(", ")}`,
    ]),
    ``,
    `## Signature format`,
    ``,
    `- kind: \`${DIAGNOSIS_P22_SIGNATURE_KIND}\``,
    `- acceptsClientParam: false`,
    `- acceptsModelOutput: false`,
    `- pendingApprovers: ${report.pendingApprovers.join(", ")}`,
    ``,
    report.standaloneProductionNote,
    ``,
  ].join("\n");
}

export function renderDiagnosisProductionP22Markdown(report: DiagnosisProductionP22Report): string {
  return [
    `# OpenBot Diagnosis Platform — P22 独立审批包冻结`,
    ``,
    `Date: 2026-09-05`,
    ``,
    `Status: **${packStatus(report)}。**`,
    `P22 ≠ 生产部署。gatesOpened=${String(report.gatesOpened)} approvedForProductionCutover=${String(report.approvedForProductionCutover)} trafficSwitched=${String(report.trafficSwitched)}。`,
    ``,
    renderDiagnosisP22ApprovalMarkdown(report),
    ``,
  ].join("\n");
}

export function assertDiagnosisProductionP22Closed(report: DiagnosisProductionP22Report): void {
  if (
    report.approvedForProductionCutover ||
    report.gatesOpened ||
    report.trafficSwitched ||
    !report.approvalDoesNotOpenGate ||
    report.gates.some((gate) => gate.value) ||
    report.signatures.some((slot) => slot.acceptsClientParam || slot.acceptsModelOutput) ||
    (report.humanApprovalRecorded &&
      (report.pendingApprovers.length > 0 ||
        report.signatures.some((slot) => !slot.signed || !slot.approvalDoesNotOpenGate))) ||
    isUnapprovedProductionGateOpen()
  ) {
    fail("p22_not_closed", "P22 must not open production gates", "p22");
  }
  if (
    report.repair.ledgerMutated ||
    report.repair.releaseRecordMutated ||
    report.repair.provenanceMinted
  ) {
    fail("identity_mutated", "P22 must not rewrite LIVE identities", "repair");
  }
  if (report.p21.slo.completeness !== "complete" && report.readyForIndependentApproval) {
    fail("incomplete_slo_ready", "incomplete P21 SLO must not enter Ready", "slo");
  }
}
