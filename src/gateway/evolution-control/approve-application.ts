/**
 * Append ledger `application.approved` for M1 authorityOk without promoting.
 * Does not transition proposal status and does not call promote.
 */
import type { EvolutionApplication, EvolutionProposal } from "@openbot/evolution-core";
import type { EvolutionControlPlane } from "./control-plane.js";

export type ApproveApplicationInput = {
  commandId: string;
  applicationId: string;
  principalRef: string;
  trustedTenantId: string | null;
};

export type ApproveApplicationResult = {
  application: EvolutionApplication;
  proposal: EvolutionProposal;
  eventId: string;
  alreadyApproved: boolean;
};

export function approveApplicationAuthority(
  plane: EvolutionControlPlane,
  input: ApproveApplicationInput,
): ApproveApplicationResult {
  const commandId = input.commandId.trim();
  const applicationId = input.applicationId.trim();
  const principalRef = input.principalRef.trim();
  if (!commandId || !applicationId || !principalRef) {
    throw new Error("commandId, applicationId, and principalRef are required");
  }
  const application = plane.getApplication(applicationId);
  if (!application) {
    throw new Error(`application not found: ${applicationId}`);
  }
  if (application.status !== "applied") {
    throw new Error(`application is not applied: ${application.status}`);
  }
  const proposal = plane.getProposal(application.proposalId);
  if (!proposal) {
    throw new Error(`proposal not found: ${application.proposalId}`);
  }
  if (input.trustedTenantId != null && proposal.tenantScope !== input.trustedTenantId) {
    throw new Error("proposal not found");
  }
  const eventId = `led:${commandId}:approved`;
  const existing = plane.ledger
    .list({ proposalId: proposal.proposalId })
    .filter(
      (event) =>
        event.type === "application.approved" &&
        event.applicationId === application.applicationId &&
        event.tenantScope === proposal.tenantScope,
    );
  if (existing.length > 0) {
    return {
      application,
      proposal,
      eventId: existing[0]?.eventId ?? eventId,
      alreadyApproved: true,
    };
  }
  plane.ledger.append({
    eventId,
    type: "application.approved",
    timestamp: new Date().toISOString(),
    proposalId: proposal.proposalId,
    target: proposal.target,
    surfaceId: proposal.surfaceId,
    tenantScope: proposal.tenantScope,
    principalRef,
    grantId: proposal.grantId,
    evidenceRefs: proposal.sourceEvidenceRefs,
    experimentId: application.experimentId,
    applicationId: application.applicationId,
  });
  return { application, proposal, eventId, alreadyApproved: false };
}
