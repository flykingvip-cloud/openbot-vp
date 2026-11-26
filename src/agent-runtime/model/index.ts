/** Shared inference infrastructure. Business task ownership stays outside this boundary. */
export {
  resolveAuxiliaryModelGovernance,
  type AuxiliaryModelPurpose,
  type AuxiliaryModelGovernance,
} from "./auxiliary-model-governance.js";

export {
  createAuthorizedModelSession,
  createCommandModelSession,
  type ModelSessionPorts,
  type CommandModelSessionPorts,
} from "./authorized-session.js";
export type { InteractionPreparationPorts } from "./authorized-session.js";
export type {
  ModelInferenceInput,
  ModelInferenceResult,
  SessionUsageRecordInput,
} from "./authorized-session.js";
export { invokeInteractionCompletion } from "./interaction-completion.js";
export {
  resolveInteractionResourceWaitMs,
  createInteractionResourceBudget,
  formatInteractionFailureReply,
  interactionTimeoutError,
  isInteractionBudgetExhausted,
  isInteractionUserAbort,
  raceVisibleInteraction,
  classifyInteractionFailure,
  DEFAULT_INTERACTION_RESOURCE_WAIT_MS,
  INTERACTION_RESOURCE_WAIT_ENV,
  INTERACTION_BLOCKED_RECEIPT_MS,
  INTERACTION_BLOCKED_RECEIPT_MARGIN_MS,
  INTERACTION_TIMEOUT_TEXT,
  INTERACTION_EMPTY_OUTPUT_TEXT,
  INTERACTION_MODEL_FAILURE_TEXT,
  INTERACTION_QUEUE_TIMEOUT_TEXT,
  INTERACTION_RECORD_UNAVAILABLE_TEXT,
  CHAT_TURN_ERROR_UNCONFIRMED_TEXT,
  type InteractionResourceBudget,
  type InteractionFailureKind,
} from "./interaction-resource-wait.js";

export { createRunAdmissionLease } from "./admission-lease.js";

export {
  acquireAgentCommandCommercialRun,
  releaseAgentCommandCommercialRun,
  type AgentCommandCommercialGateResult,
} from "./command-commercial-gate.js";

export { createCommandAdmissionSession } from "./command-admission-session.js";

export { resolveRunAuthProfileCandidates } from "./auth-profile-candidates.js";

export { createAuthProfileRotation } from "./auth-profile-rotation.js";

export { createCopilotTokenRefresh } from "./copilot-token-refresh.js";

export { prepareEmbeddedModel } from "./prepare-embedded-model.js";

export {
  normalizeToolCallNameForDispatch,
  isToolCallBlockType,
  wrapStreamFnTrimToolCallNames,
} from "./native-tool-stream.js";

export {
  isOllamaCompatProvider,
  resolveOllamaCompatNumCtxEnabled,
  shouldInjectOllamaCompatNumCtx,
  wrapOllamaCompatNumCtx,
} from "./ollama-context-stream.js";
export {
  decodeHtmlEntitiesInObject,
  wrapStreamFnDecodeXaiToolCallArguments,
} from "./xai-arguments-stream.js";

export { applyProviderCredential } from "./apply-provider-credential.js";

export { resolveCliRunCredential } from "./cli-run-credential.js";

export {
  AGENT_COMMAND_MODEL_MODE_ENV,
  resolveAgentCommandConfiguredModelMode,
  resolveAgentCommandActorId,
  resolveAgentCommandModelGovernance,
} from "./command-governance.js";

export { invokeMetadataCompletion } from "./metadata-completion.js";
