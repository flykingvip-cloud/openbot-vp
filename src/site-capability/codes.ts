/**
 * Denial codes for the site-adapter runtime (SAR) controlled boundary.
 * These are server decisions. Callers cannot override them with tool args.
 */

export const SAR_DENIAL_CODE = {
  cdpBypass: "CDP_BYPASS_REJECTED",
  profileOverride: "PROFILE_OVERRIDE_REJECTED",
  hostTarget: "HOST_TARGET_REJECTED",
  crossAccount: "CROSS_ACCOUNT_REJECTED",
  bindingNotFound: "BINDING_NOT_FOUND",
  evaluate: "SAR_EVALUATE_REJECTED",
  opNotInSet: "SAR_OP_NOT_IN_SET",
  humanTakeover: "HUMAN_TAKEOVER",
  staleGeneration: "STALE_GENERATION",
  runNotBound: "RUN_NOT_BOUND",
  cancelRequested: "CANCEL_REQUESTED",
  serialConflict: "SERIAL_CONFLICT",
  policyDenied: "POLICY_DENIED",
  uiFence: "UI_FENCE_REJECTED",
  pageTarget: "PAGE_TARGET_MISMATCH",
  invalidManifest: "INVALID_MANIFEST",
  handleInvalid: "HANDLE_INVALID",
  notBooted: "AUTHORITY_NOT_BOOTED",
  operationFault: "OPERATION_FAULT",
} as const;

export type SarDenialCode = (typeof SAR_DENIAL_CODE)[keyof typeof SAR_DENIAL_CODE];

export type SarDenial = {
  ok: false;
  code: SarDenialCode;
  message: string;
  /** Present on evaluate denials so tests can show the product flag did not widen SAR. */
  productEvaluateEnabled?: boolean;
};

export function sarDeny(
  code: SarDenialCode,
  message: string,
  extra?: { productEvaluateEnabled?: boolean },
): SarDenial {
  return extra ? { ok: false, code, message, ...extra } : { ok: false, code, message };
}
