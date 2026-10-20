/**
 * Authority recheck: long-term reflux of a Verification against the live
 * domain store. Not a second score system. Ledger replay is the proof of
 * verification; proposal status alone is not.
 *
 * VERIFIED + unchanged SoT → still_open and the original finding must stay open.
 * Capsule / Organization / Runtime are rejected until a contract is registered.
 */
import type { EvolutionVerificationRef } from "./evaluation-refs.js";
import { ledgerEventIsReceiptNotProof } from "./lineage.js";
import type { EvolutionLedgerEvent, EvolutionProposal } from "./types.js";

export const AUTHORITY_RECHECK_OUTCOMES = [
  "resolved",
  "still_open",
  "regressed",
  "inconclusive",
  "blocked",
] as const;
export type AuthorityRecheckOutcome = (typeof AUTHORITY_RECHECK_OUTCOMES)[number];

export const AUTHORITY_RECHECK_DOMAIN_READERS = [
  "working-style-store",
  "skill-lifecycle-store",
] as const;
export type AuthorityRecheckDomainReaderKind = (typeof AUTHORITY_RECHECK_DOMAIN_READERS)[number];

export type AuthorityRecheckContract = {
  surfaceId: string;
  domainReaderKind: AuthorityRecheckDomainReaderKind;
  sourceOfTruth: string;
};

export const PHASE1_AUTHORITY_RECHECK_REGISTRY: Readonly<Record<string, AuthorityRecheckContract>> =
  {
    "agent.working-dna": {
      surfaceId: "agent.working-dna",
      domainReaderKind: "working-style-store",
      sourceOfTruth: "src/gateway/agent-growth/working-style-store.ts",
    },
    "capability.skill-installation": {
      surfaceId: "capability.skill-installation",
      domainReaderKind: "skill-lifecycle-store",
      sourceOfTruth: "src/gateway/skill-lifecycle-store.ts",
    },
  };

export type AuthorityRecheckObservation = {
  status: "ok" | "missing" | "unreadable";
  observedVersion: string | null;
};

export type AuthorityRecheckDecision = {
  outcome: AuthorityRecheckOutcome;
  reasonCode: string;
  mayCloseFinding: boolean;
  surfaceId: string;
  domainReaderKind?: AuthorityRecheckDomainReaderKind;
  verificationRef?: EvolutionVerificationRef;
};

export function resolveAuthorityRecheckContract(
  surfaceId: string,
): { ok: true; contract: AuthorityRecheckContract } | { ok: false; code: "unsupported_surface" } {
  const contract = PHASE1_AUTHORITY_RECHECK_REGISTRY[surfaceId];
  if (!contract) {
    return { ok: false, code: "unsupported_surface" };
  }
  return { ok: true, contract };
}

export function ledgerHasVerificationProof(events: readonly EvolutionLedgerEvent[]): boolean {
  return events.some((event) => event.type === "verification.completed");
}

export function ledgerHasOnlyReceipts(events: readonly EvolutionLedgerEvent[]): boolean {
  return (
    events.length > 0 &&
    events.every((event) => ledgerEventIsReceiptNotProof(event.type)) &&
    !ledgerHasVerificationProof(events)
  );
}

export function decideAuthorityRecheck(input: {
  surfaceId: string;
  proposalStatus: EvolutionProposal["status"];
  events: readonly EvolutionLedgerEvent[];
  expectedVersion: string;
  baselineVersion: string;
  observation: AuthorityRecheckObservation;
  verificationRef?: EvolutionVerificationRef;
}): AuthorityRecheckDecision {
  const resolved = resolveAuthorityRecheckContract(input.surfaceId);
  if (!resolved.ok) {
    return {
      outcome: "blocked",
      reasonCode: "unsupported_surface",
      mayCloseFinding: false,
      surfaceId: input.surfaceId,
    };
  }
  const base = {
    surfaceId: input.surfaceId,
    domainReaderKind: resolved.contract.domainReaderKind,
    ...(input.verificationRef ? { verificationRef: input.verificationRef } : {}),
  };
  if (input.observation.status !== "ok" || !input.observation.observedVersion?.trim()) {
    return {
      ...base,
      outcome: "inconclusive",
      reasonCode: input.observation.status === "missing" ? "sot_missing" : "sot_unreadable",
      mayCloseFinding: false,
    };
  }
  const claimedVerified =
    input.proposalStatus === "VERIFIED" || input.proposalStatus === "PROMOTED";
  const proven = ledgerHasVerificationProof(input.events);
  if (claimedVerified && !proven) {
    return {
      ...base,
      outcome: "still_open",
      reasonCode: "forged_verified",
      mayCloseFinding: false,
    };
  }
  const observed = input.observation.observedVersion;
  if (observed === input.baselineVersion) {
    return {
      ...base,
      outcome: "still_open",
      reasonCode: "sot_unchanged",
      mayCloseFinding: false,
    };
  }
  if (observed !== input.expectedVersion) {
    return {
      ...base,
      outcome: "regressed",
      reasonCode: "sot_diverged",
      mayCloseFinding: false,
    };
  }
  if (!proven) {
    return {
      ...base,
      outcome: "inconclusive",
      reasonCode: "ledger_unproven",
      mayCloseFinding: false,
    };
  }
  return {
    ...base,
    outcome: "resolved",
    reasonCode: "sot_confirmed",
    mayCloseFinding: true,
  };
}
