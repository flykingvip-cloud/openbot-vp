/** Compatibility facade: the single validation registry lives in runtime delivery. */
export {
  resetValidationStateForTest,
  isTrustedValidatorRegistered,
  recordExecutionDecision,
  readExecutionDecisionCount,
  registerTrustedValidator,
  hashArtifact,
  issueValidationReceipt,
  matchRequiredValidators,
  readLatestValidationReceipt,
  findValidReceipt,
  findStaleReceipt,
  type ValidatorMatchStatus,
  type ValidatorMatch,
} from "../../agent-runtime/delivery/acceptance/index.js";
