/** Read-only recovery inspection. Never applies configuration or restores execution authority. */
import type { EvolutionControlPlane } from "../gateway/evolution-control/control-plane.js";
import type { TrustedScope } from "../task-outcome/types.js";
import type { createActionIntentStore } from "./action-intent-store.js";
export async function inspectActionIntentRecovery(
  input: {
    scope: TrustedScope;
    intentId: string;
    commandId: string;
    proposalId: string;
    experimentId: string;
    agentId: string;
  },
  ports: {
    store: Pick<ReturnType<typeof createActionIntentStore>, "detail">;
    plane: Pick<EvolutionControlPlane, "getApplication" | "getProposal">;
    authorize: () => Promise<boolean>;
    readback: () => Promise<{ actualVersion: string; actualDiffDigest: string }>;
  },
) {
  if (!(await ports.authorize())) {
    return { ok: false as const, reason: "unauthorized" };
  }
  const intent = await ports.store.detail(input.scope, input.intentId);
  if (!intent) {
    return { ok: false as const, reason: "intent_missing" };
  }
  const scopeRef =
    input.scope.kind === "enterprise" ? input.scope.tenantId : input.scope.personalDomainId;
  if (
    intent.target.targetId !== input.agentId ||
    intent.target.scopeRef !== scopeRef ||
    intent.target.controlPlane !== "evolution.working-dna" ||
    !intent.evidence.sampleRefs.length ||
    intent.evidence.sampleRefs.some((r) => r.agentId !== input.agentId)
  ) {
    return { ok: false as const, reason: "intent_binding_mismatch" };
  }
  const application = ports.plane.getApplication("app:" + input.commandId);
  const proposal = ports.plane.getProposal(input.proposalId);
  if (!application) {
    return {
      ok: true as const,
      status: "application_missing" as const,
      automaticApply: false as const,
    };
  }
  if (
    application.idempotencyKey !== input.commandId ||
    application.proposalId !== input.proposalId ||
    application.experimentId !== input.experimentId ||
    proposal?.target.domain !== "agent" ||
    proposal.target.agentId !== input.agentId ||
    proposal.tenantScope !== scopeRef
  ) {
    return { ok: false as const, reason: "application_binding_mismatch" };
  }
  const readback = await ports.readback();
  if (!(await ports.authorize())) {
    return { ok: false as const, reason: "unauthorized" };
  }
  const matches =
    application.status === "applied" &&
    application.appliedToRuntime &&
    application.scope !== "shadow" &&
    application.targetVersionAfter === readback.actualVersion &&
    intent.target.diffDigest === readback.actualDiffDigest;
  return {
    ok: true as const,
    status: intent.receipts.some((r) => r.commandId === input.commandId && r.status === "succeeded")
      ? ("association_present" as const)
      : ("applied_but_unrecorded" as const),
    application: structuredClone(application),
    readback,
    readbackMatches: matches,
    automaticApply: false as const,
    automaticAssociation: false as const,
    executionAuthorityRestored: false as const,
    doNotRetryApply: true as const,
    reasons: [
      "explicit_trusted_reauthorization_required",
      ...(!matches ? ["readback_mismatch_or_non_runtime_application"] : []),
    ],
  };
}
