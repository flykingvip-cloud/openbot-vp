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
