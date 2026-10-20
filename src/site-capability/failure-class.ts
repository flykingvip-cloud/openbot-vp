/**
 * Minimal failure classification. Repair is a suggestion or a new private
 * candidate. This module cannot publish, grant, switch accounts, or edit fixtures.
 */

import {
  copyPlan,
  declarativeArtifactDigest,
  nextPrivateVersion,
  type PrivatePlanDraft,
} from "./draft-store.js";
import { isEmptySuccess, type SiteRunResult } from "./result.js";

export const SAR_FAILURE_CLASSES = [
  "auth",
  "infrastructure",
  "params",
  "policy",
  "risk-control",
  "structure-change",
  "validation-failed",
  "unknown",
] as const;

export type SarFailureClass = (typeof SAR_FAILURE_CLASSES)[number];

export type RepairProposal = {
  action: "none" | "suggestion" | "candidate";
  failureClass: SarFailureClass | null;
  suggestion: string | null;
  candidate: PrivatePlanDraft | null;
  autoPublished: false;
  grantsExpanded: false;
  accountSwitched: false;
  fixtureRelaxed: false;
  codeRewritten: false;
  accountBindingId: string | null;
};

const PARAM_CODES = new Set(["SAR_OP_NOT_IN_SET", "VERSION_REQUIRED", "INVALID_CURSOR"]);

const POLICY_CODES = new Set([
  "POLICY_DENIED",
  "NOT_AUTHORIZED",
  "CROSS_ACCOUNT_REJECTED",
  "CDP_BYPASS_REJECTED",
  "PROFILE_OVERRIDE_REJECTED",
  "HOST_TARGET_REJECTED",
  "HUMAN_TAKEOVER",
  "STALE_GENERATION",
  "SERIAL_CONFLICT",
  "SAR_EVALUATE_REJECTED",
  "BINDING_NOT_FOUND",
]);

const SUGGESTION: Record<SarFailureClass, string> = {
  auth: "Re-authenticate the same account binding. Do not switch accounts or expand grants.",
  infrastructure: "Repair the browser infrastructure. Do not change the adapter.",
  params: "Correct the parameters. Do not retry the same invalid arguments.",
  policy: "Stop. Do not switch browsers to bypass policy.",
  "risk-control": "Stop the automatic loop. Do not rotate accounts.",
  "structure-change":
    "Page structure changed. Keep the original version and evidence. Review a new private candidate.",
  "validation-failed":
    "Validation failed. Keep the current version. Review a new private candidate. Do not publish.",
  unknown: "Result is unknown. Do not retry it as an ordinary failure and do not publish.",
};

/** Null means the run is not a failure, including a legitimate empty success. */
export function classifySiteFailure(result: SiteRunResult): SarFailureClass | null {
  if (result.status === "succeeded") {
    return null;
  }
  const code = result.error?.code ?? "";
  const message = result.error?.message ?? "";
  if (code === "AUTH_REQUIRED" || message === "AUTH_REQUIRED") {
    return "auth";
  }
  if (
    code === "BROWSER_UNAVAILABLE" ||
    message === "BROWSER_UNAVAILABLE" ||
    code === "UPSTREAM_TIMEOUT" ||
    message === "UPSTREAM_TIMEOUT"
  ) {
    return "infrastructure";
  }
  if (
    code === "CAPTCHA" ||
    message === "CAPTCHA" ||
    code === "RATE_LIMITED" ||
    message === "RATE_LIMITED"
  ) {
    return "risk-control";
  }
  if (code === "STRUCTURE_CHANGED" || message === "STRUCTURE_CHANGED") {
    return "structure-change";
  }
  if (code === "VALIDATION_FAILED" || message === "VALIDATION_FAILED") {
    return "validation-failed";
  }
  if (code === "RESULT_UNKNOWN" || message === "RESULT_UNKNOWN" || result.status === "unknown") {
    return "unknown";
  }
  if (PARAM_CODES.has(code)) {
    return "params";
  }
  if (POLICY_CODES.has(code)) {
    return "policy";
  }
  return "unknown";
}

function proposal(input: {
  action: RepairProposal["action"];
  failureClass: SarFailureClass | null;
  suggestion: string | null;
  candidate: PrivatePlanDraft | null;
  accountBindingId: string | null;
}): RepairProposal {
  return {
    ...input,
    autoPublished: false,
    grantsExpanded: false,
    accountSwitched: false,
    fixtureRelaxed: false,
    codeRewritten: false,
  };
}

function revise(source: PrivatePlanDraft, draftId: string, createdAt: string): PrivatePlanDraft {
  const version = nextPrivateVersion(source.version);
  const plan = copyPlan(source.plan);
  return {
    ...source,
    draftId,
    version,
    lifecycle: "private",
    enabled: false,
    published: false,
    manifest: { ...source.manifest, version },
    plan,
    artifactDigest: declarativeArtifactDigest(source.capabilityId, version, plan),
    generationParams: { ...source.generationParams },
    accountBindingIds: [...source.accountBindingIds],
    createdAt,
    revisionOf: source.version,
  };
}

/**
 * Classify one failure and optionally copy a new private candidate.
 * The copy keeps the same plan bytes. Nothing here enables or publishes it.
 */
export function proposeRepair(input: {
  result?: SiteRunResult;
  validationFailed?: boolean;
  sourceDraft?: PrivatePlanDraft | null;
  accountBindingId?: string;
  now: string;
  mintDraftId: () => string;
}): RepairProposal {
  const accountBindingId =
    input.accountBindingId?.trim() || input.sourceDraft?.accountBindingIds[0] || null;
  if (input.result && isEmptySuccess(input.result)) {
    return proposal({
      action: "none",
      failureClass: null,
      suggestion: null,
      candidate: null,
      accountBindingId,
    });
  }
  let failureClass: SarFailureClass | null = null;
  if (input.validationFailed) {
    failureClass = "validation-failed";
  } else if (input.result) {
    failureClass = classifySiteFailure(input.result);
  }
  if (!failureClass) {
    return proposal({
      action: "none",
      failureClass: null,
      suggestion: null,
      candidate: null,
      accountBindingId,
    });
  }
  const needsCandidate =
    failureClass === "structure-change" || failureClass === "validation-failed";
  if (needsCandidate && input.sourceDraft) {
    const candidate = revise(input.sourceDraft, input.mintDraftId(), input.now);
    const rewritten = JSON.stringify(candidate.plan) !== JSON.stringify(input.sourceDraft.plan);
    if (rewritten) {
      throw new Error("repair must not rewrite the declarative plan");
    }
    return proposal({
      action: "candidate",
      failureClass,
      suggestion: SUGGESTION[failureClass],
      candidate,
      accountBindingId,
    });
  }
  return proposal({
    action: "suggestion",
    failureClass,
    suggestion: SUGGESTION[failureClass],
    candidate: null,
    accountBindingId,
  });
}
