/** Shared inference infrastructure. Business task ownership stays outside this boundary. */
export {
  resolveAuxiliaryModelGovernance,
  type AuxiliaryModelPurpose,
  type AuxiliaryModelGovernance,
} from "./auxiliary-model-governance.js";

export { createAuthorizedModelSession, type ModelSessionPorts } from "./authorized-session.js";
export type { InteractionPreparationPorts } from "./authorized-session.js";
export type { ModelInferenceInput, ModelInferenceResult } from "./authorized-session.js";
export { invokeInteractionCompletion } from "./interaction-completion.js";

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
