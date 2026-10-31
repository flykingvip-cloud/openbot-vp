/**
 * TEAM-REAL F1–F3 gateway method pack (review A: ensure session is write-scoped).
 */
import { collaborationTaskActivationHandlers } from "./collaboration-task-activation.js";
import { defineGatewayMethodPack } from "./pack-types.js";

const READ_METHODS = [
  "collaboration.task.readTeamDeliverable",
  "collaboration.task.checkDispatchReadiness",
] as const;
const WRITE_METHODS = [
  "collaboration.task.activate",
  "collaboration.task.discussToTask",
  "collaboration.task.confirmPlanFromChat",
  "collaboration.task.submitTeamDeliverable",
  "collaboration.task.ensureMemberSession",
] as const;
const METHODS = [...READ_METHODS, ...WRITE_METHODS] as const;

export const collaborationTaskActivationPack = defineGatewayMethodPack({
  id: "collaboration-task-activation",
  methods: METHODS,
  scopes: {
    "operator.read": READ_METHODS,
    "operator.write": WRITE_METHODS,
  },
  handlers: collaborationTaskActivationHandlers,
});
