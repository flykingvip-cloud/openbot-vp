import type { ShadowRunRequest } from "../../contracts/rule-adaptation-shadow.js";
import type { ConfirmedContextWindowDecision } from "../../model/rule-adaptation/index.js";
import {
  activateApprovedRuntimeRuleProposal,
  type ActivationHostDependencies,
} from "./activate.js";
/** Pre-execution orchestration. Reuses the agent, validator and existing locked CAS. */
import {
  runOfficialShadowRuleAdaptation,
  type OfficialShadowHostBinding,
} from "./official-shadow.js";

export async function decideDynamicContextWindow(input: {
  decisionId: string;
  originalTokens: number;
  request: ShadowRunRequest;
  host: OfficialShadowHostBinding;
  /** Independent trusted authorization, never generated from the model proposal. */
  activationBinding: unknown;
  activation: ActivationHostDependencies;
}): Promise<ConfirmedContextWindowDecision> {
  input.request.signal?.throwIfAborted();
  const result = await runOfficialShadowRuleAdaptation(input.request, input.host);
  input.request.signal?.throwIfAborted();
  if (
    result.outcomeCode !== "shadow_recorded" ||
    result.validation?.resultKind !== "shadow_accepted" ||
    !result.controlUnchanged
  ) {
    throw new Error("Dynamic context decision did not pass validation");
  }
  const committed = activateApprovedRuntimeRuleProposal(
    result.proposal,
    input.activationBinding,
    input.activation,
  );
  if (
    committed.resultKind !== "activated" ||
    !committed.snapshot ||
    committed.authorizationAssessment !== "host_authorized"
  ) {
    throw new Error("Dynamic context decision authorization or CAS rejected");
  }
  const snapshot = committed.snapshot;
  const item = snapshot.items.find(
    (entry) =>
      entry.ruleId === "model.context_window.guard" &&
      entry.field === "agents.defaults.contextTokens",
  );
  if (!item || typeof item.parameter !== "number" || snapshot.status !== "effective") {
    throw new Error("Committed context decision has no effective context parameter");
  }
  return Object.freeze({
    domain: "context_window",
    ruleId: "model.context_window.guard",
    decisionId: input.decisionId,
    originalTokens: input.originalTokens,
    effectiveTokens: item.parameter,
    sourceVersion: snapshot.catalogVersion,
    policyHash: snapshot.policyHash,
  });
}
