/**
 * E1 WAL design freeze. Pure recovery machine — not a live diagnosis ingest.
 *
 * Recovery is forward-only. Append-only ledger rows are never deleted.
 * Naked proposal registration is not a transaction interface and is not imported here.
 *
 * Ledger: only `proposal.created` is appended. `committed` never writes a ledger
 * event. If that event already exists, recovery advances the receipt only.
 */
import { isForbiddenSurfaceId } from "./surfaces.js";

export const DIAGNOSIS_INGEST_WAL_STATES = [
  "pending",
  "proposal_written",
  "candidate_written",
  "ledger_written",
  "committed",
] as const;
export type DiagnosisIngestWalState = (typeof DIAGNOSIS_INGEST_WAL_STATES)[number];

export const DIAGNOSIS_INGEST_WAL_STEPS = [
  "proposal_written",
  "candidate_written",
  "ledger_written",
  "committed",
] as const;
export type DiagnosisIngestWalStep = (typeof DIAGNOSIS_INGEST_WAL_STEPS)[number];

export const FIRST_PERIOD_DIAGNOSIS_INGEST_SURFACES = [
  "agent.working-dna",
  "capability.skill-installation",
] as const;
export type FirstPeriodDiagnosisIngestSurface =
  (typeof FIRST_PERIOD_DIAGNOSIS_INGEST_SURFACES)[number];
export const FIRST_PERIOD_DIAGNOSIS_INGEST_SURFACE = "agent.working-dna" as const;
export const DIAGNOSIS_INGEST_LEDGER_EVENT_TYPE = "proposal.created" as const;
export const DIAGNOSIS_INGEST_ADMIT_IS_SERVER_RESOLVED_VIEW = true as const;

export const DIAGNOSIS_CANDIDATE_PUBLIC_SUBMIT_FIELDS = [
  "commandId",
  "candidate",
  "trustedContext",
  "grantId",
] as const;

export const DIAGNOSIS_CANDIDATE_PUBLIC_SUBMIT_FORBIDDEN_FIELDS = [
  "grantActive",
  "targetKnown",
  "claimedTenantId",
] as const;

/**
 * Server-resolved admit view. Gateway membership / ownership / grant resolvers
 * populate grantActive, targetKnown, and tenant comparison. The public E1
 * submit DTO must not accept those fields from the client.
 */
export type DiagnosisIngestAdmitInput = {
  commandId: string;
  grantId: string;
  grantActive: boolean;
  trustedTenantId: string;
  claimedTenantId?: string | null;
  surfaceId: string;
  targetKey: string;
  targetKnown: boolean;
  mechanism: string;
  candidateVersion: string;
  contentHash: string;
  reportId?: string;
};

export type DiagnosisIngestWalRecord = {
  commandId: string;
  proposalId: string;
  candidateRef: string;
  surfaceId: string;
  contentHash: string;
  tenantScope: string;
  targetKey: string;
  mechanism: string;
  candidateVersion: string;
  grantId: string;
  state: DiagnosisIngestWalState;
  ledgerEventIds: string[];
};

export type DiagnosisIngestAdmitDenial = {
  ok: false;
  code:
    | "grant_missing"
    | "grant_inactive"
    | "cross_tenant"
    | "unknown_target"
    | "forbidden_surface"
    | "unsupported_surface";
  writes: readonly [];
};

export type DiagnosisIngestAdmitOk = {
  ok: true;
  surfaceId: FirstPeriodDiagnosisIngestSurface;
  dedupKey: string;
};

export function isFirstPeriodDiagnosisIngestSurface(
  surfaceId: string,
): surfaceId is FirstPeriodDiagnosisIngestSurface {
  return (FIRST_PERIOD_DIAGNOSIS_INGEST_SURFACES as readonly string[]).includes(surfaceId);
}

export function diagnosisIngestDedupKey(input: {
  tenantScope: string;
  surfaceId: string;
  targetKey: string;
  mechanism: string;
  candidateVersion: string;
}): string {
  return [
    input.tenantScope,
    input.surfaceId,
    input.targetKey,
    input.mechanism,
    input.candidateVersion,
  ].join("|");
}

export function admitDiagnosisIngest(
  input: DiagnosisIngestAdmitInput,
): DiagnosisIngestAdmitOk | DiagnosisIngestAdmitDenial {
  const deny = (code: DiagnosisIngestAdmitDenial["code"]): DiagnosisIngestAdmitDenial => ({
    ok: false,
    code,
    writes: [],
  });
  if (!input.grantId.trim()) {
    return deny("grant_missing");
  }
  if (!input.grantActive) {
    return deny("grant_inactive");
  }
  if (input.claimedTenantId && input.claimedTenantId !== input.trustedTenantId) {
    return deny("cross_tenant");
  }
  if (!input.targetKnown || !input.targetKey.trim()) {
    return deny("unknown_target");
  }
  if (isForbiddenSurfaceId(input.surfaceId)) {
    return deny("forbidden_surface");
  }
  if (!isFirstPeriodDiagnosisIngestSurface(input.surfaceId)) {
    return deny("unsupported_surface");
  }
  return {
    ok: true,
    surfaceId: input.surfaceId,
    dedupKey: diagnosisIngestDedupKey({
      tenantScope: input.trustedTenantId,
      surfaceId: input.surfaceId,
      targetKey: input.targetKey,
      mechanism: input.mechanism,
      candidateVersion: input.candidateVersion,
    }),
  };
}

export function diagnosisIngestProposalCreatedEventId(commandId: string): string {
  return `led:${commandId}:${DIAGNOSIS_INGEST_LEDGER_EVENT_TYPE}`;
}

export function ledgerActionForWalStep(input: {
  commandId: string;
  step: DiagnosisIngestWalStep;
  existingEventIds: readonly string[];
}): { appendEventIds: string[]; advanceReceiptOnly: boolean } {
  if (input.step !== "ledger_written") {
    return { appendEventIds: [], advanceReceiptOnly: true };
  }
  const eventId = diagnosisIngestProposalCreatedEventId(input.commandId);
  if (input.existingEventIds.includes(eventId)) {
    return { appendEventIds: [], advanceReceiptOnly: true };
  }
  return { appendEventIds: [eventId], advanceReceiptOnly: false };
}

const STEP_AFTER: Record<DiagnosisIngestWalState, DiagnosisIngestWalStep | null> = {
  pending: "proposal_written",
  proposal_written: "candidate_written",
  candidate_written: "ledger_written",
  ledger_written: "committed",
  committed: null,
};

export function nextDiagnosisIngestWalStep(
  state: DiagnosisIngestWalState,
): DiagnosisIngestWalStep | null {
  return STEP_AFTER[state];
}

export function missingDiagnosisIngestWalSteps(
  state: DiagnosisIngestWalState,
): DiagnosisIngestWalStep[] {
  const missing: DiagnosisIngestWalStep[] = [];
  let cursor: DiagnosisIngestWalState = state;
  while (true) {
    const next = nextDiagnosisIngestWalStep(cursor);
    if (!next) {
      return missing;
    }
    missing.push(next);
    cursor = next;
  }
}

export function assertCommandDoesNotRebindCandidate(input: {
  existing: Pick<DiagnosisIngestWalRecord, "commandId" | "contentHash" | "candidateRef">;
  commandId: string;
  contentHash: string;
  candidateRef: string;
}): { ok: true } | { ok: false; code: "command_rebind" } {
  if (input.existing.commandId !== input.commandId) {
    return { ok: true };
  }
  if (
    input.existing.contentHash !== input.contentHash ||
    input.existing.candidateRef !== input.candidateRef
  ) {
    return { ok: false, code: "command_rebind" };
  }
  return { ok: true };
}

export function recoverDiagnosisIngestWal(record: DiagnosisIngestWalRecord): {
  resumeFrom: DiagnosisIngestWalState;
  stepsToApply: DiagnosisIngestWalStep[];
  ledgerAppends: string[];
  deleteLedger: false;
} {
  const stepsToApply = missingDiagnosisIngestWalSteps(record.state);
  const ledgerAppends: string[] = [];
  for (const step of stepsToApply) {
    const action = ledgerActionForWalStep({
      commandId: record.commandId,
      step,
      existingEventIds: [...record.ledgerEventIds, ...ledgerAppends],
    });
    ledgerAppends.push(...action.appendEventIds);
  }
  return {
    resumeFrom: record.state,
    stepsToApply,
    ledgerAppends,
    deleteLedger: false,
  };
}
