/**
 * Official diagnosis production enablement order.
 * Approval-bar order: adapters → report API → Da Bai → remediation.
 * P24.5 opened Da Bai first as a product exception; later increments
 * reopen remaining gates in threshold order. Client params and model
 * output are never approval.
 */
import {
  DIAGNOSIS_DAIBAI_DELIVERY_ENABLED,
  DIAGNOSIS_PRODUCTION_GATES,
  DIAGNOSIS_REMEDIATION_EXECUTION_ENABLED,
} from "./production-cutover.js";
import { DIAGNOSIS_REPORT_API_DEPLOYED } from "./report-query-deploy.js";
import { DIAGNOSIS_PRODUCTION_ADAPTERS_ENABLED } from "./report-query-production-adapters.js";
import { DiagnosisContractError } from "./types.js";

export const DIAGNOSIS_ENABLEMENT_SEQUENCE_INCREMENT = "P24.8" as const;

export const DIAGNOSIS_ENABLEMENT_STEPS = [
  {
    id: "adapters",
    gate: "DIAGNOSIS_PRODUCTION_ADAPTERS_ENABLED",
    approver: "platform_security",
    predecessors: [] as const,
    increment: "P24.6",
    productFirstKnife: false,
  },
  {
    id: "reportApi",
    gate: "DIAGNOSIS_REPORT_API_DEPLOYED",
    approver: "platform_security",
    predecessors: ["adapters"] as const,
    increment: "P24.7",
    productFirstKnife: false,
  },
  {
    id: "daibaiDelivery",
    gate: "DIAGNOSIS_DAIBAI_DELIVERY_ENABLED",
    approver: "platform_security+enterprise_admin",
    predecessors: [] as const,
    increment: "P24.5",
    productFirstKnife: true,
  },
  {
    id: "remediationExecution",
    gate: "DIAGNOSIS_REMEDIATION_EXECUTION_ENABLED",
    approver: "platform_security+enterprise_admin+employee",
    predecessors: ["adapters", "reportApi", "daibaiDelivery"] as const,
    increment: "P24.8",
    productFirstKnife: false,
  },
] as const;

export type DiagnosisEnablementStepId = (typeof DIAGNOSIS_ENABLEMENT_STEPS)[number]["id"];

/** Gates Daniel/CEO has authorized open through the current increment. */
export const DIAGNOSIS_APPROVED_OPEN_GATE_NAMES = [
  "DIAGNOSIS_DAIBAI_DELIVERY_ENABLED",
  "DIAGNOSIS_PRODUCTION_ADAPTERS_ENABLED",
  "DIAGNOSIS_REPORT_API_DEPLOYED",
  "DIAGNOSIS_REMEDIATION_EXECUTION_ENABLED",
] as const;

export type DiagnosisApprovedOpenGateName = (typeof DIAGNOSIS_APPROVED_OPEN_GATE_NAMES)[number];

const LIVE_GATE_BY_ID: Record<DiagnosisEnablementStepId, boolean> = {
  adapters: DIAGNOSIS_PRODUCTION_ADAPTERS_ENABLED,
  reportApi: DIAGNOSIS_REPORT_API_DEPLOYED,
  daibaiDelivery: DIAGNOSIS_DAIBAI_DELIVERY_ENABLED,
  remediationExecution: DIAGNOSIS_REMEDIATION_EXECUTION_ENABLED,
};

export function approvedOpenGateNameSet(): ReadonlySet<string> {
  return new Set<string>(DIAGNOSIS_APPROVED_OPEN_GATE_NAMES);
}

export function isUnapprovedProductionGateOpen(): boolean {
  const approved = approvedOpenGateNameSet();
  return Object.values(DIAGNOSIS_PRODUCTION_GATES).some(
    (gate) => gate.value && !approved.has(gate.name),
  );
}

export function isApprovedEnablementPrefixOpen(): boolean {
  if (isUnapprovedProductionGateOpen()) {
    return false;
  }
  const byName = new Map(
    Object.values(DIAGNOSIS_PRODUCTION_GATES).map((gate) => [gate.name, gate]),
  );
  return DIAGNOSIS_APPROVED_OPEN_GATE_NAMES.every((name) => byName.get(name)?.value === true);
}

export function nextEnablementStep(): DiagnosisEnablementStepId | null {
  if (!DIAGNOSIS_PRODUCTION_ADAPTERS_ENABLED) {
    return "adapters";
  }
  if (!DIAGNOSIS_REPORT_API_DEPLOYED) {
    return "reportApi";
  }
  if (!DIAGNOSIS_DAIBAI_DELIVERY_ENABLED) {
    return "daibaiDelivery";
  }
  if (!DIAGNOSIS_REMEDIATION_EXECUTION_ENABLED) {
    return "remediationExecution";
  }
  return null;
}

export function assertEnablementPredecessorsSatisfied(path = "sequence"): void {
  for (const step of DIAGNOSIS_ENABLEMENT_STEPS) {
    if (!LIVE_GATE_BY_ID[step.id] || step.productFirstKnife) {
      continue;
    }
    for (const predecessor of step.predecessors) {
      if (!LIVE_GATE_BY_ID[predecessor]) {
        throw new DiagnosisContractError(
          "enablement_predecessor_missing",
          `${step.gate} requires ${predecessor} before it may open`,
          path,
        );
      }
    }
  }
}

export function assertNoUnapprovedProductionGateOpen(path = "gates"): void {
  if (isUnapprovedProductionGateOpen()) {
    throw new DiagnosisContractError(
      "unapproved_gate_open",
      "a diagnosis production gate is open outside the approved enablement prefix",
      path,
    );
  }
}

/** Open gates must be subset of the approved prefix; partial open is allowed (O1.1 read-only). */
export function assertApprovedEnablementPrefix(path = "gates"): void {
  assertEnablementPredecessorsSatisfied(path);
  assertNoUnapprovedProductionGateOpen(path);
}

export function assertEnablementSourceNotClientOrModel(claim: {
  clientParam?: unknown;
  modelOutput?: unknown;
}): void {
  if (claim.clientParam !== undefined) {
    throw new DiagnosisContractError(
      "client_param_enablement_forbidden",
      "client parameters are not enablement approval",
      "claim",
    );
  }
  if (claim.modelOutput !== undefined) {
    throw new DiagnosisContractError(
      "model_output_enablement_forbidden",
      "model output is not enablement approval",
      "claim",
    );
  }
}
