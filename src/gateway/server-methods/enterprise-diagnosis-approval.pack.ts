import { ENTERPRISE_DIAGNOSIS_APPROVAL_DECIDE_METHOD } from "../../diagnosis/approval-ledger.js";
import { enterpriseDiagnosisApprovalHandlers } from "./enterprise-diagnosis-approval.js";
import { defineGatewayMethodPack } from "./pack-types.js";

const METHODS = [ENTERPRISE_DIAGNOSIS_APPROVAL_DECIDE_METHOD] as const;

export const enterpriseDiagnosisApprovalPack = defineGatewayMethodPack({
  id: "enterprise-diagnosis-approval",
  methods: METHODS,
  scopes: {
    "operator.approvals": METHODS,
  },
  handlers: enterpriseDiagnosisApprovalHandlers,
});
