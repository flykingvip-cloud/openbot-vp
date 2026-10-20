/**
 * Gateway binding for authority recheck. Reuses the independent domain
 * reader already used by external-effect verification. Does not create a
 * second ledger or score.
 */
import {
  assertEvolutionVerificationRef,
  decideAuthorityRecheck,
  resolveAuthorityRecheckContract,
  type AuthorityRecheckDecision,
  type AuthorityRecheckObservation,
  type EvolutionApplication,
  type EvolutionLedgerEvent,
  type EvolutionProposal,
  type ExternalEffectDomainReader,
} from "@openbot/evolution-core";
import type { SkillCandidate } from "./adapters/skill.js";

export type AuthorityRecheckInput = {
  proposal: EvolutionProposal;
  application?: EvolutionApplication;
  events: readonly EvolutionLedgerEvent[];
  readDomain: ExternalEffectDomainReader;
  skillAgentId?: string;
};

export async function recheckAuthorityFromLedger(
  input: AuthorityRecheckInput,
): Promise<AuthorityRecheckDecision> {
  const resolved = resolveAuthorityRecheckContract(input.proposal.surfaceId);
  if (!resolved.ok) {
    return decideAuthorityRecheck({
      surfaceId: input.proposal.surfaceId,
      proposalStatus: input.proposal.status,
      events: input.events,
      expectedVersion: input.application?.targetVersionAfter ?? "",
      baselineVersion: input.application?.targetVersionBefore ?? "",
      observation: { status: "unreadable", observedVersion: null },
    });
  }
  if (!input.application) {
    return decideAuthorityRecheck({
      surfaceId: input.proposal.surfaceId,
      proposalStatus: input.proposal.status,
      events: input.events,
      expectedVersion: "",
      baselineVersion: "",
      observation: { status: "missing", observedVersion: null },
    });
  }
  const observation = await readAuthorityObservation(
    input.proposal,
    resolved.contract.domainReaderKind,
    input.readDomain,
    input.skillAgentId,
  );
  const verificationRef =
    input.proposal.experimentId && input.proposal.applicationId && input.proposal.verificationId
      ? assertEvolutionVerificationRef({
          schemaVersion: 1,
          proposalId: input.proposal.proposalId,
          experimentId: input.proposal.experimentId,
          applicationId: input.proposal.applicationId,
          verificationId: input.proposal.verificationId,
          ...(input.application.rollbackRef ? { rollbackRef: input.application.rollbackRef } : {}),
        })
      : undefined;
  return decideAuthorityRecheck({
    surfaceId: input.proposal.surfaceId,
    proposalStatus: input.proposal.status,
    events: input.events,
    expectedVersion: input.application.targetVersionAfter,
    baselineVersion: input.application.targetVersionBefore,
    observation,
    ...(verificationRef ? { verificationRef } : {}),
  });
}

async function readAuthorityObservation(
  proposal: EvolutionProposal,
  readerKind: "working-style-store" | "skill-lifecycle-store",
  readDomain: ExternalEffectDomainReader,
  skillAgentId?: string,
): Promise<AuthorityRecheckObservation> {
  if (readerKind === "working-style-store") {
    if (proposal.target.domain !== "agent" || !readDomain.readWorkingStyle) {
      return { status: "unreadable", observedVersion: null };
    }
    const snapshot = await readDomain.readWorkingStyle(proposal.target.agentId);
    if (snapshot.status !== "ok") {
      return { status: snapshot.status, observedVersion: null };
    }
    return { status: "ok", observedVersion: snapshot.version };
  }
  if (proposal.target.domain !== "capability" || !readDomain.readSkillInstallation) {
    return { status: "unreadable", observedVersion: null };
  }
  const agentId = skillAgentId?.trim();
  if (!agentId) {
    return { status: "unreadable", observedVersion: null };
  }
  const snapshot = await readDomain.readSkillInstallation({
    agentId,
    skillId: proposal.target.skillId,
  });
  if (snapshot.status !== "ok") {
    return { status: snapshot.status, observedVersion: null };
  }
  return { status: "ok", observedVersion: snapshot.skillVersion };
}

export function skillAgentIdFromCandidate(payload: unknown): string | undefined {
  if (!payload || typeof payload !== "object") {
    return undefined;
  }
  const agentId = (payload as SkillCandidate).agentId;
  return typeof agentId === "string" && agentId.trim() ? agentId : undefined;
}
