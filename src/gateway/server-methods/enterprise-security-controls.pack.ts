import {
  ENTERPRISE_SECURITY_MFA_ENROLL_METHOD,
  ENTERPRISE_SECURITY_SESSIONS_LIST_METHOD,
  ENTERPRISE_SECURITY_SESSIONS_REVOKE_METHOD,
} from "../enterprise-security/controls.js";
import {
  ENTERPRISE_ACCESS_PERMISSIONS_COMMIT_METHOD,
  ENTERPRISE_ACCESS_ROLES_CREATE_METHOD,
  ENTERPRISE_MESH_ASSET_BUDGET_SET_METHOD,
  ENTERPRISE_MESH_ASSET_PAUSE_METHOD,
  ENTERPRISE_SECURITY_AUDIT_EXPORT_METHOD,
  ENTERPRISE_SECURITY_IP_ALLOWLIST_SET_METHOD,
  ENTERPRISE_SECURITY_SESSION_POLICY_SET_METHOD,
} from "../enterprise-security/pending-controls.js";
import { enterprisePendingControlHandlers } from "./enterprise-pending-controls.js";
import { enterpriseSecurityControlHandlers } from "./enterprise-security-controls.js";
import { defineGatewayMethodPack } from "./pack-types.js";

const WRITE_METHODS = [
  ENTERPRISE_SECURITY_MFA_ENROLL_METHOD,
  ENTERPRISE_SECURITY_SESSIONS_REVOKE_METHOD,
  ENTERPRISE_ACCESS_ROLES_CREATE_METHOD,
  ENTERPRISE_ACCESS_PERMISSIONS_COMMIT_METHOD,
  ENTERPRISE_SECURITY_SESSION_POLICY_SET_METHOD,
  ENTERPRISE_SECURITY_IP_ALLOWLIST_SET_METHOD,
  ENTERPRISE_MESH_ASSET_BUDGET_SET_METHOD,
] as const;

const READ_METHODS = [
  ENTERPRISE_SECURITY_SESSIONS_LIST_METHOD,
  ENTERPRISE_SECURITY_AUDIT_EXPORT_METHOD,
] as const;

const APPROVAL_METHODS = [ENTERPRISE_MESH_ASSET_PAUSE_METHOD] as const;

export const enterpriseSecurityControlsPack = defineGatewayMethodPack({
  id: "enterprise-security-controls",
  methods: [...WRITE_METHODS, ...READ_METHODS, ...APPROVAL_METHODS],
  scopes: {
    "operator.write": WRITE_METHODS,
    "operator.read": READ_METHODS,
    "operator.approvals": APPROVAL_METHODS,
  },
  handlers: {
    ...enterpriseSecurityControlHandlers,
    ...enterprisePendingControlHandlers,
  },
});
