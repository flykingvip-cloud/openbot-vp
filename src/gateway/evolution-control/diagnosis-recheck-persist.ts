/**
 * Live diagnosis recheck + M1 receipt persist for the control-plane RPC path.
 * Does not promote and does not forge ledger approval.
 */
import {
  evolutionTargetKey,
  type DiagnosisRecheckResult,
  type EvolutionApplication,
  type EvolutionProposal,
  type EvolutionVerification,
} from "@openbot/evolution-core";
import { loadConfig } from "../../config/config.js";
import type { EvolutionControlPlane } from "./control-plane.js";
import {
  persistDiagnosisRecheckReceipt,
  type DiagnosisM1ReceiptRecord,
} from "./diagnosis-m1-status.js";
import {
  createLiveDiagnosisRecheckPort,
  expectationFromControlPlane,
} from "./diagnosis-recheck-observer.js";
import { resolveEvolutionControlRoot } from "./persistent-store.js";

export type PersistLiveDiagnosisRecheckInput = {
  persistDir?: string;
  plane: EvolutionControlPlane;
  commandId: string;
  applicationId: string;
  verificationId?: string;
  receiptId?: string;
  operatorId: string;
  trustedTenantId: string | null;
};

export type PersistLiveDiagnosisRecheckResult = {
  receipt: DiagnosisM1ReceiptRecord;
  result: DiagnosisRecheckResult;
  proposal: EvolutionProposal;
  application: EvolutionApplication;
  verification: EvolutionVerification;
};

export async function persistLiveDiagnosisRecheck(
  input: PersistLiveDiagnosisRecheckInput,
): Promise<PersistLiveDiagnosisRecheckResult> {
  const commandId = input.commandId.trim();
  const applicationId = input.applicationId.trim();
  const operatorId = input.operatorId.trim();
  if (!commandId || !applicationId || !operatorId) {
    throw new Error("commandId, applicationId, and operatorId are required");
  }
  const application = input.plane.getApplication(applicationId);
  if (!application) {
    throw new Error(`application not found: ${applicationId}`);
  }
  const proposal = input.plane.getProposal(application.proposalId);
  if (!proposal) {
    throw new Error(`proposal not found: ${application.proposalId}`);
  }
  if (input.trustedTenantId != null && proposal.tenantScope !== input.trustedTenantId) {
    throw new Error("proposal not found");
  }
  const experimentId = application.experimentId || proposal.experimentId;
  if (!experimentId) {
    throw new Error("experiment binding is missing");
  }
  const verificationId = input.verificationId?.trim() || proposal.verificationId?.trim() || "";
  if (!verificationId) {
    throw new Error("verificationId is required");
  }
  const verification = input.plane.getVerification(verificationId);
  if (!verification) {
    throw new Error(`verification not found: ${verificationId}`);
  }
  if (verification.applicationId !== application.applicationId) {
    throw new Error("verification is not bound to the application");
  }
  const persistDir = resolveEvolutionControlRoot(input.persistDir);
  const port = createLiveDiagnosisRecheckPort({
    cfg: loadConfig(),
    resolveExpectation: (request) => expectationFromControlPlane(input.plane, request),
    readApplication: async (id) => {
      const row = input.plane.getApplication(id);
      if (!row) {
        return null;
      }
      return {
        targetVersionBefore: row.targetVersionBefore,
        targetVersionAfter: row.targetVersionAfter,
        tenantScope: proposal.tenantScope,
        agentId: proposal.target.domain === "agent" ? proposal.target.agentId : null,
      };
    },
  });
  const result = await port.recheck({
    verificationRef: {
      schemaVersion: 1,
      proposalId: proposal.proposalId,
      experimentId,
      applicationId: application.applicationId,
      verificationId,
    },
    target: proposal.target,
    findingRefs: [proposal.candidateRef],
    surfaceId: proposal.surfaceId,
    tenantScope: proposal.tenantScope,
  });
  const receiptId =
    input.receiptId?.trim() || `recheck:${application.applicationId}:${verificationId}`;
  // Must append receipt.created on plane.ledger (same tip as approve/promote).
  // Opening a fresh file ledger here would tip-split vs plane.ledger memory.
  const receipt = persistDiagnosisRecheckReceipt(
    persistDir,
    {
      receiptId,
      tenantId: proposal.tenantScope ?? "",
      target: evolutionTargetKey(proposal.target),
      proposalId: proposal.proposalId,
      experimentId,
      applicationId: application.applicationId,
      verificationId,
      candidateVersion: proposal.candidateRef,
      operatorId,
      commandId,
      result,
    },
    { ledger: input.plane.ledger },
  );
  return { receipt, result, proposal, application, verification };
}
