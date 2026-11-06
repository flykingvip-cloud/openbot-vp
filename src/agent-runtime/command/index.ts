/** Explicit command facade. Entrances inject effects; this module only exposes contracts and use cases. */
export { amendActiveTask } from "./amend-active-task.js";
export type { ActiveTaskAmendmentPorts, ActiveTaskAmendmentResult } from "./amend-active-task.js";
export { controlCurrentTask } from "./current-task-control.js";
export type { CurrentTaskControlPorts } from "./current-task-control.js";
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

export { handleInteraction, type InteractionPorts } from "./interaction.js";

export {
  resolveDialogueIntent,
  formatTaskQueryReply,
  type DialogueIntent,
} from "./dialogue-intent.js";

export { interpretInteraction, type InteractionInferencePort } from "./interpret-interaction.js";

export { runPreparedInteraction } from "./prepared-interaction.js";
export {
  admitExecutionRequest,
  type ExecutionAdmissionInput,
  type ExecutionAdmissionResult,
  type ExecutionAdmissionPorts,
} from "./execution-admission.js";
export { routeInteraction, type RoutedInteraction } from "./route-interaction.js";
export { runAuthorizedInteraction } from "./authorized-interaction.js";
export { formatTaskProposalReply } from "./task-proposal-reply.js";
export { isHumanInteractionIngress } from "./ingress-kind.js";

export { bindExecutionAdmissionPorts } from "./execution-admission.js";
