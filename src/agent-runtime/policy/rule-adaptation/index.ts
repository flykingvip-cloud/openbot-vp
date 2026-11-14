/**
 * P1 public entry for the pure runtime-rule-adaptation validator.
 * Call `validateRuntimeRuleProposal(proposal, hostFacts)` with two independent
 * parameters. Do not treat a `{ proposal, host }` JSON envelope as a product
 * authorization interface; that envelope is a test fixture only.
 */
export { validateRuntimeRuleProposal } from "./validate.js";
export {
  getP1ShadowFieldAdapter,
  isKnownCatalogRuleId,
  listP1ShadowFieldAdapters,
} from "./descriptors.js";
export type { P1ShadowFieldAdapter } from "./descriptors.js";
export type {
  AuthorizationAssessment,
  HostCompatibilityRecord,
  PolicyProposalInput,
  RuleCandidateInput,
  RuntimeRuleAdaptationItemResult,
  RuntimeRuleAdaptationProposal,
  RuntimeRuleAdaptationReason,
  RuntimeRuleAdaptationReasonCode,
  RuntimeRuleAdaptationResultKind,
  RuntimeRuleAdaptationValidationResult,
  TrustedHostFacts,
} from "../../contracts/rule-adaptation.js";

export {
  precheckRuntimeRuleActivation,
  precheckRuntimeRuleRevoke,
  precheckRuntimeRuleRollback,
  precheckRuntimeRuleRead,
  activationAccessScopeVerified,
  hashCanonicalJson,
  deepFreezeActivation,
  activationReason,
  resolveActivationWhitelist,
  whitelistHit,
  boardScopesEqual,
} from "./activation-precheck.js";
export { isSafeIntegerNumber } from "./inspect.js";
