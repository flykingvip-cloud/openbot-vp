import { defineGatewayMethodPack } from "./pack-types.js";
import {
  TASK_OUTCOME_REJECT_RESULT_METHOD,
  taskOutcomeRejectHandlers,
} from "./task-outcome-reject.js";

export const taskOutcomeRejectPack = defineGatewayMethodPack({
  id: "task-outcome-reject",
  methods: [TASK_OUTCOME_REJECT_RESULT_METHOD],
  // Bucket only, so the method stays classified. operator.write and
  // operator.admin do not authorize it; see authorizeTaskOutcomeRejectTransport.
  scopes: {
    "operator.approvals": [TASK_OUTCOME_REJECT_RESULT_METHOD],
  },
  handlers: taskOutcomeRejectHandlers,
});
