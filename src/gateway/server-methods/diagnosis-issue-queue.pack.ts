/**
 * M2 issue queue gateway pack. Confirm stays on diagnosis.self-evolution.confirm
 * and remains closed by default. This pack lists Issues and refuses Findings
 * as the ops queue.
 */
import {
  DIAGNOSIS_ISSUE_QUEUE_METHODS,
  DIAGNOSIS_ISSUES_ADVANCE_METHOD,
  DIAGNOSIS_ISSUES_LIST_METHOD,
  createDiagnosisIssueQueueHandlers,
} from "../../diagnosis/diagnosis-issue-gateway.js";
import { defineGatewayMethodPack } from "./pack-types.js";

export const diagnosisIssueQueuePack = defineGatewayMethodPack({
  id: "diagnosis-issue-queue",
  methods: DIAGNOSIS_ISSUE_QUEUE_METHODS,
  scopes: {
    "operator.read": [DIAGNOSIS_ISSUES_LIST_METHOD],
    "operator.approvals": [DIAGNOSIS_ISSUES_ADVANCE_METHOD],
  },
  handlers: createDiagnosisIssueQueueHandlers(),
});
