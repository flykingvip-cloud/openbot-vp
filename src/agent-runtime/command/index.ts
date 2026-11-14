/** Explicit command facade. Entrances inject effects; this module only exposes contracts and use cases. */
export { stopTaskAtGateway } from "./gateway-task-stop.js";
export type { GatewayTaskStopPorts } from "./gateway-task-stop.js";
export {
  queryCurrentTaskStatus,
  isProgressStatusQuery,
  formatTaskBoardProgressReply,
  stripInboundStampForDialogue,
} from "./task-status.js";

export {
  shouldUseCollaborationRuntimeAssembly,
  isCollaborationGroupRuntimeSession,
  resolveCollaborationGroupIdForRun,
} from "./scenarios/collaboration-entry.js";
export type { CollaborationSessionScope } from "./scenarios/collaboration-entry.js";

export { interpretInteraction, type InteractionInferencePort } from "./interpret-interaction.js";

export { runPreparedInteraction } from "./prepared-interaction.js";
export {
  admitExecutionRequest,
  type ExecutionAdmissionInput,
  type ExecutionAdmissionResult,
  type ExecutionAdmissionPorts,
} from "./execution-admission.js";
export {
  routeInteraction,
  interactionAdmissionFact,
  type RoutedInteraction,
} from "./route-interaction.js";
export { runAuthorizedInteraction } from "./authorized-interaction.js";
export { formatTaskProposalReply } from "./task-proposal-reply.js";
export { isHumanInteractionIngress } from "./ingress-kind.js";

export { bindExecutionAdmissionPorts } from "./execution-admission.js";

export { openCommandOutcomeEntry } from "./command-outcome-entry.js";

export {
  runGovernedInteraction,
  runGovernedUnderstanding,
  governedShadowHostBoundary,
} from "./governed-interaction.js";
export type {
  GovernedInteractionResult,
  GovernedInteractionWithShadow,
  GovernedShadowHostInjection,
} from "./governed-interaction.js";
export {
  EMPLOYEE_ADVICE_METHOD,
  EMPLOYEE_ADVICE_CANCEL_METHOD,
  runEmployeeRuleAdaptationAdvice,
  sanitizeEmployeeAdviceClientInput,
  buildEmployeeAdviceView,
  resolveTrustedEffectiveContextTokens,
  readOfficialEmployeeAdviceTaskBoard,
} from "./rule-adaptation/employee-advice.js";
export type {
  EmployeeAdviceView,
  EmployeeAdviceClientFields,
  TrustedEmployeeAdviceHost,
  TrustedEmployeeAdviceFacts,
} from "./rule-adaptation/employee-advice.js";
export {
  createInteractionSourceBoundary,
  formatRestrictedInteractionNotice,
} from "./interaction-sources.js";

export {
  acceptedArtifactDeliveryDirs,
  issuanceFactsFromBoard,
  requestAcceptedArtifactDelivery,
  requestGroupFinalDelivery,
  revokeAcceptedArtifactDelivery,
  resolveChannelAccountOutboundScopeFacts,
} from "./accepted-artifact-delivery.js";
export type {
  AcceptedArtifactDeliveryDirs,
  AcceptedArtifactDeliveryView,
  GroupFinalOverallAcceptanceFacts,
} from "./accepted-artifact-delivery.js";

export {
  admittedTaskQueryContinuation,
  type AdmittedTaskQueryContinuation,
} from "./admitted-task-query-continuation.js";
export { hostBoundTaskTarget } from "./host-task-target.js";
export {
  createOfficialDeepSeekShadowCompletion,
  resolveOfficialDeepSeekCredential,
} from "./rule-adaptation/official-deepseek-complete.js";
export type { OfficialDeepSeekCredential } from "./rule-adaptation/official-deepseek-complete.js";
