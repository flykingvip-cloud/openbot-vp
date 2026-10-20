/**
 * Phase 14 — freeze independent-approval materials after ledger identity review.
 * Records proven LIVE, decides whether provenance/ledger may be repaired, and
 * freezes dependency / SLO / gate approval packs. Does not open gates, mint
 * provenance tags, rewrite delivery SoT files, register live packs, or switch
 * traffic. Approval never auto-enables a gate.
 */
import {
  evaluateDiagnosisProductionAdmission,
  type DiagnosisProductionAdmissionReport,
} from "./production-admission.js";
import { isUnapprovedProductionGateOpen } from "./production-enablement-sequence.js";
import {
  DIAGNOSIS_PRODUCTION_DEPENDENCY_INVENTORY,
  DIAGNOSIS_PRODUCTION_GATE_APPROVAL_MATRIX,
  isDiagnosisObservabilityReady,
  renderDiagnosisObservabilityHealth,
  renderDiagnosisProductionPreflightMarkdown,
  type DiagnosisObservabilityMetric,
  type DiagnosisProductionPreflightInput,
} from "./production-preflight.js";
import { DiagnosisContractError } from "./types.js";

export const DIAGNOSIS_INDEPENDENT_APPROVAL_INCREMENT = "P14" as const;
export const DIAGNOSIS_INDEPENDENT_APPROVAL_SCHEMA_VERSION = 1 as const;
export const DIAGNOSIS_INDEPENDENT_APPROVAL_DOES_NOT_OPEN_GATES = true;

export type DiagnosisLiveSource = "container" | "injected" | "unknown";
export type DiagnosisLedgerRepairAction = "keep" | "blocked";
export type DiagnosisReleaseRecordAction = "keep" | "defer_to_delivery_owner";
export type DiagnosisProvenanceAction = "keep" | "do_not_mint";
export type DiagnosisApprovalRole =
  | "platform_security"
  | "enterprise_admin"
  | "employee"
  | "delivery_ledger_owner";

export type DiagnosisLedgerRepairDecision = {
  liveSha: string | null;
  liveSource: DiagnosisLiveSource;
  ledgerOpenSha: string | null;
  releaseRecordSha: string | null;
  provenanceTagSha: string | null;
  ledgerAction: DiagnosisLedgerRepairAction;
  releaseRecordAction: DiagnosisReleaseRecordAction;
  provenanceAction: DiagnosisProvenanceAction;
  ledgerMutated: false;
  releaseRecordMutated: false;
  provenanceMinted: false;
  evidenceGaps: string[];
  blockers: string[];
  aligned: boolean;
};

export type DiagnosisRoleApprovalPack = {
  role: DiagnosisApprovalRole;
  items: string[];
};

export type DiagnosisFrozenGate = {
  id: keyof typeof DIAGNOSIS_PRODUCTION_GATE_APPROVAL_MATRIX;
  name: string;
  default: false;
  value: false;
  approver: string;
  preconditions: readonly string[];
  auditReceipt: string;
  rollback: string;
  approvalDoesNotOpenGate: true;
  implicitEnableForbidden: true;
  clientParamEnableForbidden: true;
};

export type DiagnosisIndependentApprovalInput = DiagnosisProductionPreflightInput & {
  liveSource?: DiagnosisLiveSource;
  provenancePublishedAtCutover?: boolean;
};

export type DiagnosisIndependentApprovalReport = {
  increment: typeof DIAGNOSIS_INDEPENDENT_APPROVAL_INCREMENT;
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
  repair: DiagnosisLedgerRepairDecision;
  dependencies: typeof DIAGNOSIS_PRODUCTION_DEPENDENCY_INVENTORY;
  roleApprovals: DiagnosisRoleApprovalPack[];
  gates: DiagnosisFrozenGate[];
  observedMetrics: DiagnosisObservabilityMetric[];
  observabilityHealth: ReturnType<typeof renderDiagnosisObservabilityHealth>;
  admission: DiagnosisProductionAdmissionReport;
  pendingApprovers: DiagnosisApprovalRole[];
  recordedAt: string;
};

function fail(code: string, message: string, path = ""): never {
  throw new DiagnosisContractError(code, message, path);
}

function normalizeSha(sha: string | null | undefined): string | null {
  if (!sha) {
    return null;
  }
  const trimmed = sha.trim().toLowerCase();
  return /^[0-9a-f]{40}$/.test(trimmed) ? trimmed : null;
}

function short(sha: string | null): string {
  return sha ? sha.slice(0, 12) : "unknown";
}

export function evaluateDiagnosisLedgerRepair(input: {
  liveSha: string | null;
  liveSource?: DiagnosisLiveSource;
  ledgerOpenShas: readonly string[];
  releaseRecordSha: string | null;
  provenanceTagSha: string | null;
  provenancePublishedAtCutover?: boolean;
}): DiagnosisLedgerRepairDecision {
  const liveSha = normalizeSha(input.liveSha);
  const liveSource = liveSha ? (input.liveSource ?? "injected") : "unknown";
  const open = input.ledgerOpenShas
    .map((sha) => normalizeSha(sha))
    .filter((sha): sha is string => sha !== null);
  const ledgerOpenSha = open.length === 1 ? open[0] : null;
  const releaseRecordSha = normalizeSha(input.releaseRecordSha);
  const provenanceTagSha = normalizeSha(input.provenanceTagSha);
  const publishedAtCutover = input.provenancePublishedAtCutover === true;
  const evidenceGaps: string[] = [];
  const blockers: string[] = [];

  if (!liveSha || liveSource === "unknown") {
    blockers.push("LIVE is unknown; fail closed and do not rewrite identities");
    evidenceGaps.push("running container build-info.json was not proven");
  }
  if (open.length !== 1) {
    blockers.push(`ledger has ${open.length} open rows; exactly one is required`);
  }

  let ledgerAction: DiagnosisLedgerRepairAction = "keep";
  if (liveSha && ledgerOpenSha && liveSha !== ledgerOpenSha) {
    ledgerAction = "blocked";
    blockers.push(
      `LIVE ${short(liveSha)} != ledger ${short(ledgerOpenSha)}; do not rewrite the ledger to hide LIVE`,
    );
  }

  let releaseRecordAction: DiagnosisReleaseRecordAction = "keep";
  if (liveSha && releaseRecordSha && liveSha !== releaseRecordSha) {
    releaseRecordAction = "defer_to_delivery_owner";
    blockers.push(
      `RELEASE_RECORD ${short(releaseRecordSha)} lags LIVE ${short(liveSha)}; diagnosis must not mask LIVE on a feature branch`,
    );
    evidenceGaps.push(
      "delivery_ledger_owner must land Latest cutover on trunk after proving the same LIVE",
    );
  }

  let provenanceAction: DiagnosisProvenanceAction = "keep";
  if (!provenanceTagSha) {
    provenanceAction = "do_not_mint";
    blockers.push(
      `missing provenance/sha-${short(liveSha ?? ledgerOpenSha)}; P14 must not mint it`,
    );
    evidenceGaps.push(
      publishedAtCutover
        ? "provenance tag is missing even though a cutover claimed publication"
        : "cutover pulled GHCR main without a provenance-sha tag; minting now would fabricate publication",
    );
  } else if (liveSha && provenanceTagSha !== liveSha) {
    provenanceAction = "do_not_mint";
    blockers.push(`provenance peeled target ${short(provenanceTagSha)} != LIVE ${short(liveSha)}`);
    evidenceGaps.push("existing provenance peeled target does not identify the running artifact");
  }

  return {
    liveSha,
    liveSource,
    ledgerOpenSha,
    releaseRecordSha,
    provenanceTagSha,
    ledgerAction,
    releaseRecordAction,
    provenanceAction,
    ledgerMutated: false,
    releaseRecordMutated: false,
    provenanceMinted: false,
    evidenceGaps,
    blockers,
    aligned: blockers.length === 0 && evidenceGaps.length === 0,
  };
}

export function freezeDiagnosisApprovalGates(): DiagnosisFrozenGate[] {
  return (
    Object.keys(DIAGNOSIS_PRODUCTION_GATE_APPROVAL_MATRIX) as Array<
      keyof typeof DIAGNOSIS_PRODUCTION_GATE_APPROVAL_MATRIX
    >
  ).map((id) => {
    const row = DIAGNOSIS_PRODUCTION_GATE_APPROVAL_MATRIX[id];
    return {
      id,
      name: row.name,
      default: false,
      value: false,
      approver: row.approver,
      preconditions: row.preconditions,
      auditReceipt: row.auditReceipt,
      rollback: row.rollback,
      approvalDoesNotOpenGate: true,
      implicitEnableForbidden: true,
      clientParamEnableForbidden: true,
    };
  });
}

export function buildDiagnosisRoleApprovalPack(): DiagnosisRoleApprovalPack[] {
  return [
    {
      role: "platform_security",
      items: [
        "approve DIAGNOSIS_PRODUCTION_ADAPTERS_ENABLED after reader/audit/quota injection",
        "approve DIAGNOSIS_REPORT_API_DEPLOYED without self-registering a live pack",
        "co-approve Da Bai delivery allowlist and delegation guard",
        "co-approve remediation executor allowlist",
      ],
    },
    {
      role: "enterprise_admin",
      items: [
        "co-approve DIAGNOSIS_DAIBAI_DELIVERY_ENABLED after P5 contract + allowlist",
        "co-approve DIAGNOSIS_REMEDIATION_EXECUTION_ENABLED for tenant scope",
        "confirm trusted tenant comes only from membership",
      ],
    },
    {
      role: "employee",
      items: [
        "approve high-risk remediation actions that touch the granted principal",
        "confirm personal-scope evidence is not widened by enterprise/platform grants",
      ],
    },
    {
      role: "delivery_ledger_owner",
      items: [
        "update Latest cutover to the proven LIVE without rewriting ledger history",
        "publish provenance only through the normal release path if a future cutover needs it",
        "do not ask Diagnosis to mint provenance/sha-* or hide the running SHA",
      ],
    },
  ];
}

export async function evaluateDiagnosisIndependentApproval(
  input: DiagnosisIndependentApprovalInput,
): Promise<DiagnosisIndependentApprovalReport> {
  const repair = evaluateDiagnosisLedgerRepair(input);
  const admission = await evaluateDiagnosisProductionAdmission(input);
  const sloComplete = admission.slo.completeness === "complete";
  const observabilityHealth = renderDiagnosisObservabilityHealth({
    sloHealthy: sloComplete,
    observedMetrics: admission.observedMetrics,
  });
  if (!sloComplete && observabilityHealth === "healthy") {
    fail("slo_rendered_healthy", "incomplete SLO must not render healthy", "slo");
  }
  const readyForIndependentApproval =
    admission.readyForIndependentApproval &&
    repair.aligned &&
    sloComplete &&
    isDiagnosisObservabilityReady(observabilityHealth);
  return {
    increment: DIAGNOSIS_INDEPENDENT_APPROVAL_INCREMENT,
    schemaVersion: DIAGNOSIS_INDEPENDENT_APPROVAL_SCHEMA_VERSION,
    rehearsalOnly: true,
    readyForIndependentApproval,
    approvedForProductionCutover: false,
    gatesOpened: false,
    trafficSwitched: false,
    approvalDoesNotOpenGate: DIAGNOSIS_INDEPENDENT_APPROVAL_DOES_NOT_OPEN_GATES,
    injection: {
      serverConfigOnly: true,
      clientEnableForbidden: true,
      implicitEnableForbidden: true,
    },
    repair,
    dependencies: DIAGNOSIS_PRODUCTION_DEPENDENCY_INVENTORY,
    roleApprovals: buildDiagnosisRoleApprovalPack(),
    gates: freezeDiagnosisApprovalGates(),
    observedMetrics: admission.observedMetrics,
    observabilityHealth: readyForIndependentApproval ? observabilityHealth : "not_ready",
    admission,
    pendingApprovers: [
      "platform_security",
      "enterprise_admin",
      "employee",
      "delivery_ledger_owner",
    ],
    recordedAt: new Date(input.now ?? Date.parse("2026-09-03T08:00:00.000Z")).toISOString(),
  };
}

export function renderDiagnosisIndependentApprovalMarkdown(
  report: DiagnosisIndependentApprovalReport,
): string {
  return [
    `# OpenBot Diagnosis P14 Independent Approval Freeze`,
    ``,
    `Status: **${report.readyForIndependentApproval ? "Ready for independent approval" : "No-Go"}**.`,
    `P14 ≠ 生产部署。gatesOpened=${String(report.gatesOpened)} approvalDoesNotOpenGate=${String(report.approvalDoesNotOpenGate)}.`,
    ``,
    `## Proven LIVE and ledger repair`,
    ``,
    `- LIVE: \`${report.repair.liveSha ?? "unknown"}\` source=${report.repair.liveSource}`,
    `- ledger: \`${report.repair.ledgerOpenSha ?? "unknown"}\` action=${report.repair.ledgerAction}`,
    `- RELEASE_RECORD: \`${report.repair.releaseRecordSha ?? "unknown"}\` action=${report.repair.releaseRecordAction}`,
    `- provenance: \`${report.repair.provenanceTagSha ?? "unknown"}\` action=${report.repair.provenanceAction}`,
    `- aligned: ${String(report.repair.aligned)}`,
    `- ledgerMutated: ${String(report.repair.ledgerMutated)}`,
    `- releaseRecordMutated: ${String(report.repair.releaseRecordMutated)}`,
    `- provenanceMinted: ${String(report.repair.provenanceMinted)}`,
    ...report.repair.blockers.map((row) => `- blocker: ${row}`),
    ...report.repair.evidenceGaps.map((row) => `- evidence gap: ${row}`),
    ``,
    `## Frozen dependencies`,
    ``,
    ...Object.values(report.dependencies).map(
      (row) =>
        `- ${row.id}: ${row.authorityOfRecord} schema=${row.schema} timeout=${String(row.timeoutMs)}ms ${row.faultBehavior}`,
    ),
    `- injection: serverConfigOnly clientEnableForbidden implicitEnableForbidden`,
    ``,
    `## SLO freeze`,
    ``,
    `- completeness: ${report.admission.slo.completeness}`,
    `- observed: ${report.observedMetrics.join(", ") || "none"}`,
    `- health: ${report.observabilityHealth}`,
    ``,
    `## Role approvals`,
    ``,
    ...report.roleApprovals.flatMap((pack) => [
      `- ${pack.role}`,
      ...pack.items.map((item) => `  - ${item}`),
    ]),
    ``,
    `## Gates (approval ≠ enable)`,
    ``,
    ...report.gates.map(
      (gate) =>
        `- ${gate.name} value=${String(gate.value)} approver=${gate.approver} rollback=${gate.rollback}`,
    ),
    ``,
    renderDiagnosisProductionPreflightMarkdown(report.admission.preflight),
    ``,
  ].join("\n");
}

export function assertDiagnosisIndependentApprovalClosed(
  report: DiagnosisIndependentApprovalReport,
): void {
  if (
    report.approvedForProductionCutover ||
    report.gatesOpened ||
    report.trafficSwitched ||
    !report.approvalDoesNotOpenGate ||
    report.gates.some((gate) => gate.value) ||
    isUnapprovedProductionGateOpen()
  ) {
    fail("approval_not_closed", "P14 must not open production gates", "approval");
  }
  if (
    report.repair.ledgerMutated ||
    report.repair.releaseRecordMutated ||
    report.repair.provenanceMinted
  ) {
    fail("identity_mutated", "P14 must not rewrite LIVE identities", "repair");
  }
  if (
    report.admission.slo.completeness !== "complete" &&
    report.observabilityHealth === "healthy"
  ) {
    fail("slo_rendered_healthy", "incomplete SLO must not render healthy", "slo");
  }
}
