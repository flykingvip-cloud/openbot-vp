import type {
  EnterpriseIdentity,
  EnterpriseIdentityStatus,
} from "../enterprise-operational-identity-types.js";

/** 连接器生命周期（规范 v1.0）；由持久化字段推导，不单独落库。 */
export type OperationalIdentityConnectionStatus =
  | "created"
  | "configuring"
  | "connected"
  | "active"
  | "reauth_required"
  | "token_expired"
  | "disabled";

export type OperationalIdentityHealthStatus = "active" | "warning" | "failed";

export function resolveOperationalIdentityConnectionStatus(params: {
  identity: EnterpriseIdentity;
  hasEnabledPolicy: boolean;
  nowIso: string;
}): OperationalIdentityConnectionStatus {
  const { identity, hasEnabledPolicy, nowIso } = params;
  if (identity.revokedAt) {
    return "disabled";
  }
  if (identity.status === "expired") {
    return "token_expired";
  }
  if (identity.status === "reauth_required") {
    return "reauth_required";
  }
  if (identity.expiresAt && identity.expiresAt <= nowIso) {
    return "token_expired";
  }
  if (identity.lastVerifiedAt && identity.status === "active") {
    return hasEnabledPolicy ? "active" : "connected";
  }
  if (identity.credentialBindingId?.trim()) {
    return "configuring";
  }
  return "created";
}

export function resolveOperationalIdentityHealthStatus(params: {
  identity: EnterpriseIdentity;
  connectionStatus: OperationalIdentityConnectionStatus;
}): OperationalIdentityHealthStatus {
  const { identity, connectionStatus } = params;
  if (
    connectionStatus === "disabled" ||
    connectionStatus === "token_expired" ||
    connectionStatus === "reauth_required"
  ) {
    return "failed";
  }
  if (
    identity.capabilityMissing &&
    identity.capabilityMissing.length > 0 &&
    identity.capabilities &&
    identity.capabilities.length > 0
  ) {
    return "warning";
  }
  if (identity.status === "active" && (identity.capabilities?.length ?? 0) > 0) {
    return "active";
  }
  if (identity.lastVerifiedAt && identity.status === "active") {
    return identity.capabilities?.length ? "active" : "warning";
  }
  return "warning";
}

export function resolveOperationalIdentityUiStatusLabel(
  connectionStatus: OperationalIdentityConnectionStatus,
): string {
  switch (connectionStatus) {
    case "active":
      return "正常";
    case "connected":
      return "已连接";
    case "configuring":
      return "配置中";
    case "created":
      return "待配置";
    case "reauth_required":
      return "需重新授权";
    case "token_expired":
      return "凭证已过期";
    case "disabled":
      return "已停用";
    default:
      return "未知";
  }
}

export function mapLegacyIdentityStatusToHealth(
  status: EnterpriseIdentityStatus,
): OperationalIdentityHealthStatus {
  if (status === "active") {
    return "active";
  }
  return "failed";
}
