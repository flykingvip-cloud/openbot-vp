import {
  PLATFORM_DIAGNOSIS_APPROVAL_DECIDE_METHOD,
  createPlatformDiagnosisApprovalHandlers,
} from "./diagnosis-approval.js";
import { defineGatewayMethodPack } from "./pack-types.js";

export const diagnosisApprovalPack = defineGatewayMethodPack({
  id: "diagnosis-approval",
  methods: [PLATFORM_DIAGNOSIS_APPROVAL_DECIDE_METHOD],
  scopes: {
    "operator.approvals": [PLATFORM_DIAGNOSIS_APPROVAL_DECIDE_METHOD],
  },
  handlers: createPlatformDiagnosisApprovalHandlers(),
});
