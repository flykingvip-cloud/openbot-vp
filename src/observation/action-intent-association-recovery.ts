/** Explicit association repair only. This module has no apply, rollback, or verification ports. */
import { createHash } from "node:crypto";
import type { EvolutionControlPlane } from "../gateway/evolution-control/control-plane.js";
import type { TrustedScope } from "../task-outcome/types.js";
import type { createActionIntentStore } from "./action-intent-store.js";
import type { ActionIntent, ControlReceipt, ConfigReadback } from "./action-intent.js";
export type AssociationRecoveryRequest = {
  intentId: string;
  expectedRevision: number;
  originalCommandId: string;
  applicationId: string;
  proposalId: string;
  experimentId: string;
  agentId: string;
  recoveryCommandId: string;
};
export type AssociationRecoveryAuthorization = AssociationRecoveryRequest & {
  authorizationId: string;
  actorRef: string;
  action: "restore_association";
  scope: TrustedScope;
  actualVersion: string;
  actualDiffDigest: string;
  issuedAt: number;
  expiresAt: number;
  revokedAt: number | null;
};
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(canonical);
  }
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .toSorted(([a], [b]) => a.localeCompare(b))
        .map(([k, v]) => [k, canonical(v)]),
    );
  }
  return value;
}
const hash = (value: unknown) =>
  createHash("sha256")
    .update(JSON.stringify(canonical(value)))
    .digest("hex");
export function createAssociationRecoveryService(ports: {
  store: Pick<ReturnType<typeof createActionIntentStore>, "detail" | "commit">;
  plane: Pick<EvolutionControlPlane, "getApplication" | "getProposal">;
  authorize: (
    request: Readonly<AssociationRecoveryRequest>,
  ) => Promise<AssociationRecoveryAuthorization | null>;
  readback: (
    agentId: string,
  ) => Promise<{ actualVersion: string; actualDiffDigest: string; observedAt: number }>;
  now: () => number;
}) {
  return async (request: AssociationRecoveryRequest) => {
    const input: Readonly<AssociationRecoveryRequest> = Object.freeze({
      intentId: request.intentId,
      expectedRevision: request.expectedRevision,
      originalCommandId: request.originalCommandId,
      applicationId: request.applicationId,
      proposalId: request.proposalId,
      experimentId: request.experimentId,
      agentId: request.agentId,
      recoveryCommandId: request.recoveryCommandId,
    });
    const readAuthorization = async () => {
      try {
        return structuredClone(await ports.authorize(structuredClone(input)));
      } catch {
        return null;
      }
    };
    if (
      !Number.isSafeInteger(input.expectedRevision) ||
      input.expectedRevision < 0 ||
      Object.values(input).some((v) => typeof v === "string" && !v.trim()) ||
      input.applicationId !== "app:" + input.originalCommandId
    ) {
      return {
        ok: false as const,
        status: "blocked" as const,
        reason: "invalid_request",
        doNotRetryApply: true as const,
      };
    }
    const approval = await readAuthorization();
    const valid = (a: AssociationRecoveryAuthorization | null) =>
      Boolean(
        a &&
        a.action === "restore_association" &&
        a.authorizationId &&
        a.actorRef &&
        Number.isFinite(a.issuedAt) &&
        Number.isFinite(a.expiresAt) &&
        a.issuedAt <= ports.now() &&
        a.expiresAt > ports.now() &&
        a.revokedAt === null &&
        Object.keys(input).every(
          (k) =>
            a[k as keyof AssociationRecoveryRequest] ===
            input[k as keyof AssociationRecoveryRequest],
        ),
      );
    if (!valid(approval) || !approval) {
      return {
        ok: false as const,
        status: "blocked" as const,
        reason: "recovery_unauthorized",
        doNotRetryApply: true as const,
      };
    }
    const binding = structuredClone(approval);
    const requestDigest = hash(binding);
    const application = ports.plane.getApplication(input.applicationId);
    const blocked = (reason: string) => ({
      ok: false as const,
      status: application ? ("applied_but_unrecorded" as const) : ("blocked" as const),
      reason,
      application: application ? structuredClone(application) : null,
      doNotRetryApply: true as const,
    });
    try {
      const intent = await ports.store.detail(binding.scope, input.intentId);
      if (!intent) {
        return blocked("intent_missing");
      }
      const replay = intent.associationRecovery?.recoveryCommandId === input.recoveryCommandId;
      if (replay && intent.associationRecovery?.requestDigest !== requestDigest) {
        return blocked("recovery_command_rebind");
      }
      if (intent.revision !== input.expectedRevision + (replay ? 1 : 0)) {
        return blocked("revision_conflict");
      }
      const scopeRef =
        binding.scope.kind === "enterprise"
          ? binding.scope.tenantId
          : binding.scope.personalDomainId;
      if (
        intent.target.controlPlane !== "evolution.working-dna" ||
        intent.target.targetType !== "agent" ||
        intent.target.targetId !== input.agentId ||
        intent.target.scopeRef !== scopeRef ||
        intent.target.previewRef !== input.proposalId ||
        !intent.evidence.sampleRefs.length ||
        intent.evidence.sampleRefs.some((r) => r.agentId !== input.agentId) ||
        !intent.approval ||
        intent.authorizedRevision === null ||
        !(replay ? ["effective"] : ["authorized", "accepted", "executing"]).includes(intent.state)
      ) {
        return blocked("intent_binding_mismatch");
      }
      const proposal = ports.plane.getProposal(input.proposalId);
      if (
        !application ||
        application.idempotencyKey !== input.originalCommandId ||
        application.proposalId !== input.proposalId ||
        application.experimentId !== input.experimentId ||
        application.status !== "applied" ||
        !application.appliedToRuntime ||
        (application.scope !== "canary" && application.scope !== "active") ||
        proposal?.target.domain !== "agent" ||
        proposal.target.agentId !== input.agentId ||
        proposal.tenantScope !== scopeRef ||
        application.targetVersionBefore !== intent.target.expectedConfigVersion ||
        application.rollbackRef !== intent.target.rollbackPointRef
      ) {
        return blocked("application_binding_mismatch");
      }
      if (
        binding.actualVersion !== application.targetVersionAfter ||
        binding.actualDiffDigest !== intent.target.diffDigest
      ) {
        return blocked("authorization_target_mismatch");
      }
      const read = await ports.readback(input.agentId);
      if (
        read.actualVersion !== application.targetVersionAfter ||
        read.actualDiffDigest !== intent.target.diffDigest ||
        !Number.isFinite(read.observedAt) ||
        read.observedAt < binding.issuedAt ||
        read.observedAt > ports.now()
      ) {
        return blocked("readback_mismatch");
      }
      const fresh = await readAuthorization();
      if (!valid(fresh) || hash(fresh) !== requestDigest) {
        return blocked("recovery_authorization_changed");
      }
      const latest = await ports.store.detail(binding.scope, input.intentId);
      if (!latest || latest.revision !== intent.revision) {
        return blocked("revision_conflict");
      }
      if (
        hash(ports.plane.getApplication(input.applicationId)) !== hash(application) ||
        hash(ports.plane.getProposal(input.proposalId)) !== hash(proposal)
      ) {
        return blocked("application_binding_changed");
      }
      if (replay) {
        const replayApproval = await readAuthorization();
        if (!valid(replayApproval) || hash(replayApproval) !== requestDigest) {
          return blocked("recovery_authorization_changed");
        }
        if (
          hash(ports.plane.getApplication(input.applicationId)) !== hash(application) ||
          hash(ports.plane.getProposal(input.proposalId)) !== hash(proposal)
        ) {
          return blocked("application_binding_changed");
        }
        return {
          ok: true as const,
          status: "association_restored" as const,
          replayed: true,
          intent,
          application: structuredClone(application),
          doNotRetryApply: true as const,
          executionAuthorityRestored: false as const,
        };
      }
      const now = ports.now();
      if (!Number.isFinite(now) || now < intent.updatedAt) {
        return blocked("invalid_clock");
      }
      const receipt: ControlReceipt = {
        receiptId: input.applicationId + ":recovered",
        commandId: input.originalCommandId,
        idempotencyKey: input.originalCommandId,
        requestDigest:
          intent.command?.requestDigest ??
          hash([
            input.originalCommandId,
            input.applicationId,
            input.proposalId,
            input.experimentId,
            intent.target,
          ]),
        intentRevision: intent.authorizedRevision,
        target: structuredClone(intent.target),
        status: "succeeded",
        at: Date.parse(application.appliedAt ?? ""),
        actualVersion: application.targetVersionAfter,
      };
      if (
        intent.command &&
        (intent.command.commandId !== receipt.commandId ||
          intent.command.idempotencyKey !== receipt.idempotencyKey)
      ) {
        return blocked("original_command_mismatch");
      }
      if (
        !Number.isFinite(receipt.at) ||
        receipt.at > now ||
        receipt.at < intent.approval.issuedAt ||
        receipt.at >= intent.approval.expiresAt ||
        (intent.approval.revokedAt !== null && intent.approval.revokedAt <= receipt.at)
      ) {
        return blocked("original_receipt_time_invalid");
      }
      if (
        intent.receipts.some(
          (r) =>
            r.commandId === input.originalCommandId && r.requestDigest !== receipt.requestDigest,
        )
      ) {
        return blocked("original_command_digest_conflict");
      }
      const readback: ConfigReadback = {
        readbackId: input.recoveryCommandId + ":readback",
        controlPlane: intent.target.controlPlane,
        targetId: input.agentId,
        scopeRef,
        actualVersion: read.actualVersion,
        actualDiffDigest: read.actualDiffDigest,
        observedAt: read.observedAt,
      };
      const restored: ActionIntent = {
        ...structuredClone(intent),
        revision: intent.revision + 1,
        state: "effective",
        command: {
          commandId: receipt.commandId,
          idempotencyKey: receipt.idempotencyKey,
          requestDigest: receipt.requestDigest,
        },
        receipts: [...intent.receipts, receipt],
        readback,
        updatedAt: now,
        associationRecovery: {
          authorizationId: binding.authorizationId,
          actorRef: binding.actorRef,
          action: "restore_association",
          expectedRevision: input.expectedRevision,
          originalCommandId: input.originalCommandId,
          applicationId: input.applicationId,
          proposalId: input.proposalId,
          experimentId: input.experimentId,
          agentId: input.agentId,
          scopeDigest: hash(binding.scope),
          actualVersion: read.actualVersion,
          actualDiffDigest: read.actualDiffDigest,
          recoveredAt: now,
          recoveryCommandId: input.recoveryCommandId,
          requestDigest,
        },
      };
      await ports.store.commit({
        scope: binding.scope,
        intent: restored,
        expectedRevision: input.expectedRevision,
        commandId: input.recoveryCommandId,
        requestDigest,
        precondition: async () => {
          const at = ports.now();
          const current = await readAuthorization();
          // This lock-local gate prevents queued commits from using stale approval.
          // It is not an atomic transaction with an external authorization system.
          return (
            Number.isFinite(at) &&
            valid(current) &&
            hash(current) === requestDigest &&
            hash(ports.plane.getApplication(input.applicationId)) === hash(application) &&
            hash(ports.plane.getProposal(input.proposalId)) === hash(proposal)
          );
        },
      });
      return {
        ok: true as const,
        status: "association_restored" as const,
        replayed: false,
        intent: restored,
        application: structuredClone(application),
        doNotRetryApply: true as const,
        executionAuthorityRestored: false as const,
      };
    } catch (error) {
      return blocked(error instanceof Error ? error.message : "association_commit_failed");
    }
  };
}
