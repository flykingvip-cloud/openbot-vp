import type { ConstitutionalLedgerView } from "../read-model/ledger-view.js";

export type ShadowFindingSeverity = "info" | "violation";

export type ShadowFinding = {
  code: string;
  severity: ShadowFindingSeverity;
  message: string;
  subjectRef?: string;
};

export type ShadowConformanceReport = {
  schemaVersion: 1;
  mode: "shadow";
  /** Always false in this knife. Not configurable. */
  enforce: false;
  /** Always false. The evaluator never blocks or rewrites a chat turn. */
  enforced: false;
  liveInvoke: false;
  fabricDefaultOn: false;
  mutated: false;
  findings: ShadowFinding[];
  counts: {
    identities: number;
    contracts: number;
    evidence: number;
    findings: number;
  };
};

export type ShadowEvaluateOptions = {
  /**
   * Accepted only so callers can prove the default stays off.
   * `true` is recorded as an ignored request. It does not enforce.
   */
  enforce?: boolean;
};

function readFlag(value: unknown): boolean {
  return value === true;
}

function isSet(value: unknown): boolean {
  return value !== null && value !== undefined;
}

function finding(
  code: string,
  severity: ShadowFindingSeverity,
  message: string,
  subjectRef?: string,
): ShadowFinding {
  return subjectRef ? { code, severity, message, subjectRef } : { code, severity, message };
}

/**
 * Read-only shadow conformance report.
 * Compares a snapshot of `view` before and after the scan. The scan itself
 * only reads fields. Production chat is not consulted and not modified.
 */
export function evaluateShadowConformance(
  view: ConstitutionalLedgerView,
  options: ShadowEvaluateOptions = {},
): ShadowConformanceReport {
  const before = JSON.stringify(view);
  const findings: ShadowFinding[] = [];

  if (options.enforce === true) {
    findings.push(
      finding(
        "enforce_requested_ignored",
        "info",
        "enforce stays off; this package does not gate production chat",
      ),
    );
  }

  if (readFlag(view.writeThrough)) {
    findings.push(
      finding("write_through_refused", "violation", "ledger view must not write through"),
    );
  }
  if (readFlag(view.liveInvoke)) {
    findings.push(finding("live_invoke_refused", "violation", "live invoke stays off"));
  }

  for (const identity of view.identities) {
    if (identity.kind === "plugin_install" && identity.capabilityAuthorized) {
      findings.push(
        finding(
          "install_treated_as_authorization",
          "violation",
          "plugin install is not capability authorization",
          identity.identityId,
        ),
      );
    }
    if (isSet(identity.selectedPath)) {
      findings.push(
        finding(
          "workflow_treated_as_path",
          "violation",
          "workflow or session route is not a selected Path",
          identity.identityId,
        ),
      );
    }
  }

  for (const contract of view.contracts) {
    if (readFlag(contract.crossDomainWriter)) {
      findings.push(
        finding(
          "cross_domain_writer",
          "violation",
          "constitutional view is not a cross-domain writer",
          contract.contractId,
        ),
      );
    }
  }

  for (const item of view.evidence) {
    if (item.receiptOnly && (item.grade === "proof" || item.proofGrade !== "none")) {
      findings.push(
        finding("receipt_treated_as_proof", "violation", "receipt is not proof", item.evidenceId),
      );
    }
    if (item.grade === "model_text" && item.proofGrade !== "none") {
      findings.push(
        finding(
          "model_text_treated_as_proof",
          "violation",
          "model text is not proof",
          item.evidenceId,
        ),
      );
    }
    if (item.grade === "in_request_trace" && item.proofGrade === "verified") {
      findings.push(
        finding(
          "trace_treated_as_verified_proof",
          "violation",
          "in-request trace is not verified proof",
          item.evidenceId,
        ),
      );
    }
  }

  const after = JSON.stringify(view);
  if (before !== after) {
    throw new Error("shadow evaluator mutated its input view");
  }
  return {
    schemaVersion: 1,
    mode: "shadow",
    enforce: false,
    enforced: false,
    liveInvoke: false,
    fabricDefaultOn: false,
    mutated: false,
    findings,
    counts: {
      identities: view.identities.length,
      contracts: view.contracts.length,
      evidence: view.evidence.length,
      findings: findings.length,
    },
  };
}
