/**
 * Maps a SAR failure class and a gateway denial onto five display classes.
 * Outcomes outside those five stay unset so they are not relabeled.
 */

import { classifySiteFailure, type SarFailureClass } from "../../site-capability/failure-class.js";
import type { SiteRunResult, SiteRunStatus } from "../../site-capability/result.js";
import type { InvocationDenialReason, SarFailureDisplayClass } from "./types.js";

export const SAR_FAILURE_DISPLAY_LABEL: Record<SarFailureDisplayClass, string> = {
  login: "登录",
  infrastructure: "基础设施",
  policy_denied: "策略拒绝",
  structure_change: "结构变化",
  business_validation: "业务验证失败",
};

const FROM_SAR: Partial<Record<SarFailureClass, SarFailureDisplayClass>> = {
  auth: "login",
  infrastructure: "infrastructure",
  policy: "policy_denied",
  "structure-change": "structure_change",
  "validation-failed": "business_validation",
};

const LOGIN_DENIALS = new Set<InvocationDenialReason>([
  "CREDENTIAL_REAUTH_REQUIRED",
  "SOURCE_CREDENTIAL_MISSING",
]);

const INFRASTRUCTURE_DENIALS = new Set<InvocationDenialReason>(["HANDLER_TIMEOUT"]);

const POLICY_DENIALS = new Set<InvocationDenialReason>([
  "NO_SEAT_CONTEXT",
  "NO_ACTION_GRANT",
  "ACTION_FROZEN",
  "ACTION_NOT_REGISTERED",
  "SCOPE_DENIED",
  "SCOPE_CONTEXT_MISSING",
  "APPROVAL_REQUIRED",
  "APPROVAL_EXPIRED",
  "APPROVAL_INVALIDATED",
  "UNTRUSTED_CLIENT_CONTEXT",
  "UNTRUSTED_EXECUTION_CONTEXT",
  "SOURCE_NOT_FOUND",
  "SOURCE_ACCOUNT_AMBIGUOUS",
  "SAR_BINDING_MISSING",
  "SAR_BINDING_PRIVATE",
  "SAR_HANDLER_MISSING",
  "SAR_VERIFICATION_MISSING",
  "SAR_SCOPE_UNSUPPORTED",
  "SAR_WRITE_FORBIDDEN",
]);

export type SarFailureDisplay = {
  class: SarFailureDisplayClass;
  label: string;
  failureClass: SarFailureClass | null;
};

function sarClassFromCode(
  errorCode: string | undefined,
  status: SiteRunStatus | undefined,
): SarFailureClass | null {
  if (!errorCode && status !== "unknown" && status !== "failed") {
    return null;
  }
  const result: SiteRunResult = {
    runId: "display",
    capabilityId: "display",
    version: "display",
    status: status === "unknown" ? "unknown" : "failed",
    verification: "failed",
    data: null,
    completeness: "complete",
    evidenceRef: "display",
    durationMs: 0,
    repair: "none",
    ...(errorCode
      ? {
          error: {
            code: errorCode,
            message: errorCode,
            retry: status === "unknown" ? "not_ordinary" : "none",
            ordinaryFailure: status !== "unknown",
          },
        }
      : {}),
  };
  return classifySiteFailure(result);
}

function fromDenial(
  denialReason: InvocationDenialReason | undefined,
): SarFailureDisplayClass | null {
  if (!denialReason) {
    return null;
  }
  if (LOGIN_DENIALS.has(denialReason)) {
    return "login";
  }
  if (INFRASTRUCTURE_DENIALS.has(denialReason)) {
    return "infrastructure";
  }
  if (POLICY_DENIALS.has(denialReason)) {
    return "policy_denied";
  }
  return null;
}

/**
 * SAR class wins when it is one of the five. A halt is not a failure class.
 * `params`, `risk-control`, and `unknown` stay unset.
 */
export function resolveSarFailureDisplay(input: {
  status?: SiteRunStatus;
  errorCode?: string;
  denialReason?: InvocationDenialReason;
}): SarFailureDisplay | null {
  if (input.denialReason === "SAR_EXECUTION_HALTED") {
    return null;
  }
  if (input.status === "succeeded" && !input.errorCode) {
    return null;
  }
  const failureClass = sarClassFromCode(input.errorCode, input.status);
  const fromRun = failureClass ? FROM_SAR[failureClass] : undefined;
  const displayClass = fromRun ?? fromDenial(input.denialReason);
  if (!displayClass) {
    return null;
  }
  return {
    class: displayClass,
    label: SAR_FAILURE_DISPLAY_LABEL[displayClass],
    failureClass: fromRun ? (failureClass ?? null) : null,
  };
}
