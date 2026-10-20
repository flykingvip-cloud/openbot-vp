import type { FailureClass } from "./types.js";

export type ClassifiedFailure = {
  failureClass: FailureClass;
  retryable: boolean;
  retryOwner:
    | "retry_policy"
    | "approval"
    | "skill_contract"
    | "validation"
    | "provider"
    | "user"
    | "none";
  fallbackAllowed: boolean;
};

export class SkillContractViolationError extends Error {
  readonly decisionCode = "skill_contract_violation";
  readonly failureClass: FailureClass = "skill_contract_violation";

  constructor(message: string) {
    super(message);
    this.name = "SkillContractViolationError";
  }
}

function includesAny(text: string, needles: string[]): boolean {
  return needles.some((needle) => text.includes(needle));
}

function stopped(
  failureClass: FailureClass,
  retryOwner: ClassifiedFailure["retryOwner"],
): ClassifiedFailure {
  return { failureClass, retryable: false, retryOwner, fallbackAllowed: false };
}

/**
 * Single classifier. Tool privilege never grows on retry.
 * provider_failover may switch model identity only.
 */
export function classifyExecutionFailure(input: {
  message?: string;
  name?: string;
  decisionCode?: string;
}): ClassifiedFailure {
  const message =
    `${input.name ?? ""} ${input.decisionCode ?? ""} ${input.message ?? ""}`.toLowerCase();
  if (
    input.name === "SkillContractViolationError" ||
    input.decisionCode === "skill_contract_violation" ||
    includesAny(message, ["skill_contract_violation", "forbidden engine", "forbidden final engine"])
  ) {
    return stopped("skill_contract_violation", "skill_contract");
  }
  if (includesAny(message, ["validation_failed", "validator_failed"])) {
    return stopped("validation_failed", "validation");
  }
  if (includesAny(message, ["approval_denied", "approval denied", "user denied", "exec denied"])) {
    return stopped("approval_denied", "none");
  }
  if (
    includesAny(message, [
      "approval_required",
      "approval required",
      "needs approval",
      "exec approval",
      "approval timeout",
      "approval timed out",
    ])
  ) {
    return stopped("approval_required", "approval");
  }
  if (
    includesAny(message, [
      "authorization_denied",
      "tool execution denied",
      "toolauthorizationerror",
      "not authorized",
      "permission denied",
    ])
  ) {
    return stopped("authorization_denied", "none");
  }
  if (
    includesAny(message, [
      "resource_out_of_scope",
      "path escapes workspace",
      "outside workspace",
      "workspace_authorization_failed",
    ])
  ) {
    return stopped("resource_out_of_scope", "user");
  }
  if (includesAny(message, ["compaction", "context overflow"])) {
    return {
      failureClass: "compaction_retry",
      retryable: true,
      retryOwner: "retry_policy",
      fallbackAllowed: false,
    };
  }
  if (includesAny(message, ["rate limit", "rate_limit", "429", "too many requests"])) {
    return {
      failureClass: "rate_limit",
      retryable: true,
      retryOwner: "retry_policy",
      fallbackAllowed: false,
    };
  }
  if (includesAny(message, ["auth_profile_rotation", "profile rotation"])) {
    return {
      failureClass: "provider_failover",
      retryable: false,
      retryOwner: "provider",
      fallbackAllowed: true,
    };
  }
  if (includesAny(message, ["provider_failover", "provider failover", "fallback provider"])) {
    return {
      failureClass: "provider_failover",
      retryable: false,
      retryOwner: "provider",
      fallbackAllowed: true,
    };
  }
  if (
    includesAny(message, [
      "502",
      "503",
      "521",
      "529",
      "econnreset",
      "econnrefused",
      "socket hang up",
      "transient_transport",
      "etimedout",
      "timed out",
      "timeout",
    ])
  ) {
    return {
      failureClass: "transient_transport",
      retryable: true,
      retryOwner: "retry_policy",
      fallbackAllowed: false,
    };
  }
  return stopped("permanent_failure", "none");
}
