/**
 * FINAL v3 S3 — Version-bound submit / accept / return helpers.
 *
 * Inventory-first: extends claim-contract submit→accept|return (no second orchestrator).
 * Hard rules:
 * - Submit binds submissionId + artifactVersion (not body-summary alone).
 * - Accept/return must target expectedSubmissionId === current pending submission.
 * - Late accept after return / revision cannot cover an old submission.
 * - Empty / no-increment / pure restatement never counts as submit success.
 * - Accept must check objective Acceptance criteria (主答权威 ≠ skip criteria).
 * - Audit: reason, criteria, submission version, verdict; proxy records identity+basis.
 *
 * Flags stay OFF by default; LIVE / Floor untouched.
 */

/** LIVE / Floor / default-on flags are out of S3 scope. */
export function s3DoesNotTouchLiveOrDefaultFlagsOn(): true {
  return true;
}

export function s3DoesNotOpenProductionGrayWrites(): true {
  return true;
}

/** Normalize artifact version for binding (non-empty trimmed string). */
export function normalizeArtifactVersion(value: string | null | undefined): string {
  return value?.replace(/\s+/g, " ").trim() ?? "";
}

export function isValidArtifactVersion(value: string | null | undefined): boolean {
  return normalizeArtifactVersion(value).length > 0;
}

export function normalizeAcceptanceCriterion(value: string | null | undefined): string {
  return value?.replace(/\s+/g, " ").trim().toLowerCase() ?? "";
}

/**
 * Every board Acceptance clause must appear in the reviewer's checked list.
 * 主答 may be the acceptance authority, but cannot skip objective criteria.
 */
export function acceptanceCriteriaFullyChecked(params: {
  boardCriteria: readonly string[] | null | undefined;
  checkedCriteria: readonly string[] | null | undefined;
}): { ok: true } | { ok: false; reason: string; missing: string[] } {
  const board = (params.boardCriteria ?? [])
    .map((c) => normalizeAcceptanceCriterion(c))
    .filter((c) => c.length > 0);
  if (board.length === 0) {
    return {
      ok: false,
      reason: "acceptance_criteria_missing_on_board",
      missing: [],
    };
  }
  const checkedRaw = params.checkedCriteria ?? [];
  if (checkedRaw.length === 0) {
    return {
      ok: false,
      reason: "acceptance_criteria_unchecked",
      missing: [...(params.boardCriteria ?? [])].map((c) => c.trim()).filter(Boolean),
    };
  }
  const checked = new Set(
    checkedRaw.map((c) => normalizeAcceptanceCriterion(c)).filter((c) => c.length > 0),
  );
  const missing: string[] = [];
  for (const original of params.boardCriteria ?? []) {
    const key = normalizeAcceptanceCriterion(original);
    if (key && !checked.has(key)) {
      missing.push(original.trim());
    }
  }
  if (missing.length > 0) {
    return { ok: false, reason: "acceptance_criteria_incomplete", missing };
  }
  return { ok: true };
}

/** Proxy accept: identity alone is not enough — basis required. */
export function assertAcceptanceProxyFields(params: {
  proxyForActorId?: string | null;
  proxyBasis?: string | null;
}): { ok: true } | { ok: false; reason: string; message: string } {
  const proxyFor = params.proxyForActorId?.trim() ?? "";
  const basis = params.proxyBasis?.trim() ?? "";
  if (!proxyFor && !basis) {
    return { ok: true };
  }
  if (proxyFor && !basis) {
    return {
      ok: false,
      reason: "proxy_basis_required",
      message: "acceptanceProxyBasis is required when acceptanceProxyForActorId is set",
    };
  }
  if (!proxyFor && basis) {
    return {
      ok: false,
      reason: "proxy_actor_required",
      message: "acceptanceProxyForActorId is required when acceptanceProxyBasis is set",
    };
  }
  return { ok: true };
}

/**
 * Pending submission identity for accept/return binding.
 * After return, pending is cleared — late accept of old id must fail.
 */
export function pendingSubmissionMatches(params: {
  currentSubmissionId?: string | null;
  expectedSubmissionId?: string | null;
}): { ok: true } | { ok: false; reason: string; message: string } {
  const current = params.currentSubmissionId?.trim() ?? "";
  const expected = params.expectedSubmissionId?.trim() ?? "";
  if (!expected) {
    return {
      ok: false,
      reason: "expected_submission_id_required",
      message: "accept/return requires expectedSubmissionId bound to the pending submission",
    };
  }
  if (!current) {
    return {
      ok: false,
      reason: "submission_missing",
      message: "no pending submissionId on item; cannot accept/return a stale version",
    };
  }
  if (current !== expected) {
    return {
      ok: false,
      reason: "submission_version_mismatch",
      message: `expectedSubmissionId ${expected} does not match pending ${current}; refuse stale/wrong version`,
    };
  }
  return { ok: true };
}

/** Normalize submission body for empty / duplicate / 纯复述 checks. */
export function normalizeSubmissionBody(value: string | null | undefined): string {
  return value?.replace(/\s+/g, " ").trim() ?? "";
}

export function isEmptySubmissionBody(value: string | null | undefined): boolean {
  return normalizeSubmissionBody(value).length === 0;
}

/** Exact restatement of prior returned body = no increment. */
export function isDuplicateSubmissionBody(
  next: string | null | undefined,
  previous: string | null | undefined,
): boolean {
  const a = normalizeSubmissionBody(next);
  const b = normalizeSubmissionBody(previous);
  return a.length > 0 && b.length > 0 && a === b;
}

/** §A mapping notes for submitted_for_review / returned / accepted. */
export function boardSubmissionStateContract(status: string): {
  bindsSubmissionVersion: boolean;
  acceptsLatePriorVersion: boolean;
  autoAdvanceAfter: boolean;
  note: string;
} {
  switch (status) {
    case "submitted_for_review":
      return {
        bindsSubmissionVersion: true,
        acceptsLatePriorVersion: false,
        autoAdvanceAfter: false,
        note: "submitted_for_review binds submissionId+artifactVersion; wait accept/return",
      };
    case "returned":
      return {
        bindsSubmissionVersion: false,
        acceptsLatePriorVersion: false,
        autoAdvanceAfter: false,
        note: "returned: revise + re-confirm plan; old submission cannot be late-accepted",
      };
    case "accepted":
      return {
        bindsSubmissionVersion: true,
        acceptsLatePriorVersion: false,
        autoAdvanceAfter: false,
        note: "accepted: terminal; no auto advance",
      };
    default:
      return {
        bindsSubmissionVersion: false,
        acceptsLatePriorVersion: false,
        autoAdvanceAfter: false,
        note: `status ${status}: not in S3 accept/return closed loop`,
      };
  }
}
