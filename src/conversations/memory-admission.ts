/**
 * Memory admission signals (CL-P4-02).
 * Candidate → admit only with explicit / repeated / approved / admin signals.
 * Lifecycle: candidate → admitted → active → superseded | forgotten.
 */
export type MemoryAdmissionSignalKind =
  | "EXPLICIT_REMEMBER"
  | "REPEATED_PREFERENCE"
  | "APPROVED_GROUP_DECISION"
  | "ADMIN_PUBLISH"
  | "TEMPORARY_INSTRUCTION"
  | "UNCONFIRMED_SPECULATION"
  | "EXPIRED_TASK"
  | "TOOL_OUTPUT"
  | "NO_SOURCE";

/** Stable atom lifecycle for product / CogniWeave mapping. */
export type MemoryAtomLifecycleState =
  | "candidate"
  | "admitted"
  | "active"
  | "superseded"
  | "forgotten";

export type MemoryAdmissionCandidate = {
  text: string;
  sourceIdentityIds: string[];
  signals: MemoryAdmissionSignalKind[];
  /** How many distinct scenes/conversations the preference appeared in. */
  repeatSceneCount?: number;
  scopeVisibility: "private" | "shared";
};

export type MemoryAdmissionDecision = {
  admitted: boolean;
  reasonCode: string;
  matchedSignals: MemoryAdmissionSignalKind[];
  suppressedSignals: MemoryAdmissionSignalKind[];
  /** Next lifecycle state when admitted (defaults active after admit). */
  lifecycleState?: MemoryAtomLifecycleState;
};

const POSITIVE = new Set<MemoryAdmissionSignalKind>([
  "EXPLICIT_REMEMBER",
  "REPEATED_PREFERENCE",
  "APPROVED_GROUP_DECISION",
  "ADMIN_PUBLISH",
]);

const SUPPRESS = new Set<MemoryAdmissionSignalKind>([
  "TEMPORARY_INSTRUCTION",
  "UNCONFIRMED_SPECULATION",
  "EXPIRED_TASK",
  "TOOL_OUTPUT",
  "NO_SOURCE",
]);

const EXPLICIT_REMEMBER_RE =
  /\b(please\s+remember|remember\s+that|remember\s+this|记住|请记住|记一下)\b/i;

/**
 * Detect admission signals from raw user text + metadata.
 */
export function detectAdmissionSignals(params: {
  text: string;
  sourceIdentityIds: string[];
  repeatSceneCount?: number;
  isApprovedGroupDecision?: boolean;
  isAdminPublish?: boolean;
  isToolOutput?: boolean;
  isExpiredTask?: boolean;
}): MemoryAdmissionSignalKind[] {
  const signals: MemoryAdmissionSignalKind[] = [];
  if (!params.sourceIdentityIds.length) {
    signals.push("NO_SOURCE");
  }
  if (params.isToolOutput) {
    signals.push("TOOL_OUTPUT");
  }
  if (params.isExpiredTask) {
    signals.push("EXPIRED_TASK");
  }
  if (params.isApprovedGroupDecision) {
    signals.push("APPROVED_GROUP_DECISION");
  }
  if (params.isAdminPublish) {
    signals.push("ADMIN_PUBLISH");
  }
  if (EXPLICIT_REMEMBER_RE.test(params.text)) {
    signals.push("EXPLICIT_REMEMBER");
  }
  if ((params.repeatSceneCount ?? 0) >= 2) {
    signals.push("REPEATED_PREFERENCE");
  }
  // Temporary format-only instructions
  if (
    /\b(just\s+this\s+once|only\s+for\s+now|临时|仅本次)\b/i.test(params.text) &&
    !EXPLICIT_REMEMBER_RE.test(params.text)
  ) {
    signals.push("TEMPORARY_INSTRUCTION");
  }
  if (
    /\b(maybe|perhaps|might|可能|也许|猜测)\b/i.test(params.text) &&
    !EXPLICIT_REMEMBER_RE.test(params.text)
  ) {
    signals.push("UNCONFIRMED_SPECULATION");
  }
  return [...new Set(signals)];
}

/**
 * Evaluate whether a candidate may promote to a stable Memory Atom.
 */
export function evaluateMemoryAdmission(
  candidate: MemoryAdmissionCandidate,
): MemoryAdmissionDecision {
  const matched = candidate.signals.filter((s) => POSITIVE.has(s));
  const suppressed = candidate.signals.filter((s) => SUPPRESS.has(s));

  if (candidate.sourceIdentityIds.length === 0 || candidate.signals.includes("NO_SOURCE")) {
    return {
      admitted: false,
      reasonCode: "NO_SOURCE",
      matchedSignals: matched,
      suppressedSignals: suppressed,
    };
  }
  if (suppressed.includes("TOOL_OUTPUT") && matched.length === 0) {
    return {
      admitted: false,
      reasonCode: "TOOL_OUTPUT_BLOCKED",
      matchedSignals: matched,
      suppressedSignals: suppressed,
    };
  }
  if (suppressed.includes("TEMPORARY_INSTRUCTION") && !matched.includes("EXPLICIT_REMEMBER")) {
    return {
      admitted: false,
      reasonCode: "TEMPORARY_INSTRUCTION",
      matchedSignals: matched,
      suppressedSignals: suppressed,
    };
  }
  if (suppressed.includes("UNCONFIRMED_SPECULATION") && matched.length === 0) {
    return {
      admitted: false,
      reasonCode: "UNCONFIRMED",
      matchedSignals: matched,
      suppressedSignals: suppressed,
    };
  }
  if (suppressed.includes("EXPIRED_TASK") && matched.length === 0) {
    return {
      admitted: false,
      reasonCode: "EXPIRED_TASK",
      matchedSignals: matched,
      suppressedSignals: suppressed,
    };
  }
  if (matched.length === 0) {
    return {
      admitted: false,
      reasonCode: "NO_POSITIVE_SIGNAL",
      matchedSignals: matched,
      suppressedSignals: suppressed,
    };
  }
  // Shared scope must not admit private-only explicit without approved group signal.
  if (
    candidate.scopeVisibility === "shared" &&
    !matched.includes("APPROVED_GROUP_DECISION") &&
    !matched.includes("ADMIN_PUBLISH")
  ) {
    return {
      admitted: false,
      reasonCode: "SHARED_SCOPE_REQUIRES_GROUP_OR_ADMIN",
      matchedSignals: matched,
      suppressedSignals: suppressed,
    };
  }
  return {
    admitted: true,
    reasonCode: "ADMITTED",
    matchedSignals: matched,
    suppressedSignals: suppressed,
    lifecycleState: "admitted",
  };
}

/**
 * Transition helper after admission / conflict / forget.
 * - admitted → active once written to store
 * - supersede: previous active → superseded
 * - forget: any → forgotten (non-retrievable)
 */
export function transitionMemoryLifecycle(params: {
  current: MemoryAtomLifecycleState;
  event: "admit" | "activate" | "supersede" | "forget";
}): MemoryAtomLifecycleState {
  switch (params.event) {
    case "admit":
      return params.current === "candidate" || params.current === "admitted"
        ? "admitted"
        : params.current;
    case "activate":
      return params.current === "admitted" || params.current === "active"
        ? "active"
        : params.current;
    case "supersede":
      return params.current === "active" || params.current === "admitted"
        ? "superseded"
        : params.current;
    case "forget":
      return "forgotten";
    default:
      return params.current;
  }
}

/**
 * Source revocation rules (CL-P4-02):
 * - unique source forgotten → atom must not be retrievable
 * - multi-source: removing one source keeps atom if other live sources remain
 */
export function evaluateSourceRevocation(params: {
  remainingLiveSourceIds: string[];
  revokedSourceId: string;
}): {
  atomRetrievable: boolean;
  reasonCode: string;
  lifecycleState: MemoryAtomLifecycleState;
} {
  const remaining = params.remainingLiveSourceIds.filter(
    (id) => id && id !== params.revokedSourceId,
  );
  if (remaining.length === 0) {
    return {
      atomRetrievable: false,
      reasonCode: "UNIQUE_SOURCE_REVOKED",
      lifecycleState: "forgotten",
    };
  }
  return {
    atomRetrievable: true,
    reasonCode: "MULTI_SOURCE_REMAINS",
    lifecycleState: "active",
  };
}

/** Private atoms must never appear in shared search scope. */
export function isAtomVisibleInScope(params: {
  atomScopeVisibility: "private" | "shared";
  queryScopeVisibility: "private" | "shared";
}): boolean {
  if (params.queryScopeVisibility === "shared") {
    return params.atomScopeVisibility === "shared";
  }
  return true;
}
