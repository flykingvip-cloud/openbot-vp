import { getOperationalIdentityRegistrationProfile } from "./registration-profiles.js";
export {
  assessOperationalIdentityCredentialReadiness,
  resolveIdentityStatusFromReadiness,
} from "./credential-readiness.js";
export { probeOperationalIdentityCredential } from "./credential-probe.js";
export {
  refreshOperationalIdentityCredential,
  maybeRefreshOperationalIdentityCredential,
  type RefreshOperationalIdentityCredentialResult,
} from "./credential-refresh.js";
export { upsertEnterpriseOperationalIdentityCredential } from "./credential-upsert.js";
export {
  discoverOperationalIdentityCapabilities,
  type OperationalIdentityCapabilityDiscovery,
} from "./capability-discovery.js";
export type { IdentityConnector } from "./identity-connector.js";
export {
  enrichOperationalIdentityApiView,
  type OperationalIdentityApiView,
} from "./identity-api-envelope.js";
export {
  listOperationalIdentityCapabilityRegistry,
  resolveOperationalIdentityActionRisk,
  enrichOperationalIdentityCapabilities,
  type OperationalIdentityCapabilityRegistryEntry,
  type OperationalIdentityActionRisk,
} from "./provider-capability-registry.js";
export {
  OPERATIONAL_IDENTITY_ERROR,
  resolveOperationalIdentityErrorCode,
  type OperationalIdentityErrorCode,
} from "./provider-connector-errors.js";
export {
  resolveOperationalIdentityConnectionStatus,
  resolveOperationalIdentityHealthStatus,
  type OperationalIdentityConnectionStatus,
  type OperationalIdentityHealthStatus,
} from "./identity-lifecycle.js";
export type { OperationalIdentityCredentialProbeResult } from "./credential-probe.js";
export { getOperationalIdentityRegistrationProfile } from "./registration-profiles.js";
import type {
  EnterpriseIdentityStatus,
  EnterpriseOperationalIdentityProvider,
} from "../enterprise-operational-identity-types.js";
import type {
  EnterpriseConnectorCredentialBinding,
  EnterpriseConnectorCredentialStatus,
} from "../enterprise-seat-assets-store.js";
import type {
  OperationalIdentityProviderCatalogEntry,
  OperationalIdentityStatusHint,
} from "./contract.js";

export type {
  OperationalIdentityActionKind,
  OperationalIdentityActionSpec,
  OperationalIdentityCredentialFieldKind,
  OperationalIdentityCredentialFieldSpec,
  OperationalIdentityCredentialReadinessItem,
  OperationalIdentityProviderAdapter,
  OperationalIdentityProviderCatalogEntry,
  OperationalIdentityProviderRolloutTier,
  OperationalIdentityRegistrationMethod,
  OperationalIdentityRegistrationProfile,
  OperationalIdentityStatusHint,
} from "./contract.js";
import {
  getOperationalIdentityProviderAdapter,
  OPERATIONAL_IDENTITY_PROVIDER_ADAPTERS,
  resolveOperationalIdentityAdapterFromConnectorId,
} from "./adapters.js";

export {
  getOperationalIdentityProviderAdapter,
  tryGetOperationalIdentityProviderAdapter,
  resolveOperationalIdentityProviderPresentation,
  OPERATIONAL_IDENTITY_PROVIDER_ADAPTERS,
  resolveOperationalIdentityAdapterFromConnectorId,
} from "./adapters.js";

export function resolveOperationalIdentityProviderFromConnectorId(
  connectorId: string,
): EnterpriseOperationalIdentityProvider | null {
  return resolveOperationalIdentityAdapterFromConnectorId(connectorId)?.provider ?? null;
}

export function listOperationalIdentityProviderAllowedActions(
  provider: EnterpriseOperationalIdentityProvider,
): string[] {
  const adapter = getOperationalIdentityProviderAdapter(provider);
  return adapter.actions
    .filter((entry) => entry.kind === "operational")
    .map((entry) => entry.action);
}

export function listOperationalIdentityProviderDataSyncActions(
  provider: EnterpriseOperationalIdentityProvider,
): string[] {
  const adapter = getOperationalIdentityProviderAdapter(provider);
  return adapter.actions.filter((entry) => entry.kind === "data_sync").map((entry) => entry.action);
}

export function isOperationalIdentityPolicyAction(provider: string, action: string): boolean {
  return listOperationalIdentityProviderAllowedActions(
    provider as EnterpriseOperationalIdentityProvider,
  ).includes(action);
}

export function resolveUnsupportedOperationalIdentityConnectorMessage(
  connectorId: string,
): string | null {
  const normalized = connectorId.trim().toLowerCase();
  if (!normalized) {
    return "connectorId is required.";
  }
  if (normalized === "wechat") {
    return "个人微信（wechat）不能注册为企业公众号/官方账号运营身份；请使用 wechat-official 凭证。";
  }
  if (normalized === "enterprise-email" || normalized === "gmail" || normalized === "smtp") {
    return "企业邮箱不纳入企业运营身份目录；每位员工的邮箱不同，请在员工端授权中自行绑定个人邮箱。";
  }
  if (normalized === "jira") {
    return "Jira 不纳入企业运营身份目录。";
  }
  if (normalized === "feishu" || normalized === "lark") {
    return "飞书暂不纳入企业运营身份目录；如需 IM 协作能力，请通过 MCP 扩展接入。";
  }
  if (normalized === "wecom") {
    return "企业微信暂不纳入企业运营身份目录；如需 IM 协作能力，请通过 MCP 扩展接入。";
  }
  if (normalized === "dingtalk") {
    return "钉钉暂不纳入企业运营身份目录；如需 IM 协作能力，请通过 MCP 扩展接入。";
  }
  if (resolveOperationalIdentityAdapterFromConnectorId(normalized)) {
    return null;
  }
  return `连接器 ${connectorId} 尚未纳入企业运营身份 Provider 目录。`;
}

export function listOperationalIdentityProviderCatalog(): OperationalIdentityProviderCatalogEntry[] {
  return OPERATIONAL_IDENTITY_PROVIDER_ADAPTERS.map((adapter) => ({
    provider: adapter.provider,
    label: adapter.label,
    category: adapter.category,
    connectorIds: [...adapter.connectorIds],
    rolloutTier: adapter.rolloutTier,
    registrationReady: adapter.registrationReady,
    operationalActions: adapter.actions
      .filter((entry) => entry.kind === "operational")
      .map((entry) => ({ action: entry.action, label: entry.label })),
    dataSyncActions: adapter.actions
      .filter((entry) => entry.kind === "data_sync")
      .map((entry) => ({ action: entry.action, label: entry.label })),
    reauthHint: adapter.reauthHint,
    degradedHint: adapter.degradedHint ?? null,
    registrationProfile: getOperationalIdentityRegistrationProfile(adapter.provider),
  }));
}

export async function listOperationalIdentityProviderCatalogWithRuntime(): Promise<
  OperationalIdentityProviderCatalogEntry[]
> {
  return listOperationalIdentityProviderCatalog();
}

export function resolveOperationalIdentityStatusHint(params: {
  provider: EnterpriseOperationalIdentityProvider;
  status: EnterpriseIdentityStatus;
}): OperationalIdentityStatusHint {
  const adapter = getOperationalIdentityProviderAdapter(params.provider);
  if (params.status === "active") {
    return {
      status: params.status,
      label: "正常",
      tone: "ok",
      detail: `${adapter.label} 凭证有效，可按 Seat 策略执行运营动作。`,
    };
  }
  if (params.status === "reauth_required") {
    return {
      status: params.status,
      label: "需重授权",
      tone: "warn",
      detail: adapter.reauthHint,
    };
  }
  return {
    status: params.status,
    label: "已过期",
    tone: "danger",
    detail: `${adapter.label} 凭证已失效或身份已停用，请重新绑定凭证后再注册。`,
  };
}

export function resolveOperationalIdentityStatusFromCredential(params: {
  credentialStatus: EnterpriseConnectorCredentialStatus;
  expiresAt?: string;
  nowIso: string;
}): EnterpriseIdentityStatus {
  if (params.credentialStatus === "reauthorization_required") {
    return "reauth_required";
  }
  if (params.credentialStatus === "revoked") {
    return "expired";
  }
  if (params.expiresAt && params.expiresAt <= params.nowIso) {
    return "expired";
  }
  return "active";
}

export function probeOperationalIdentityCredentialStatus(params: {
  credential: EnterpriseConnectorCredentialBinding;
  nowIso: string;
}): EnterpriseIdentityStatus {
  return resolveOperationalIdentityStatusFromCredential({
    credentialStatus: params.credential.status,
    nowIso: params.nowIso,
  });
}

export function isSupportedOperationalIdentityConnectorId(connectorId: string): boolean {
  return resolveOperationalIdentityProviderFromConnectorId(connectorId) !== null;
}

/** @deprecated Use getOperationalIdentityProviderAdapter */
export function getOperationalIdentityProviderDefinition(
  provider: EnterpriseOperationalIdentityProvider,
) {
  const adapter = getOperationalIdentityProviderAdapter(provider);
  return {
    provider: adapter.provider,
    label: adapter.label,
    category: adapter.category,
    connectorIds: adapter.connectorIds,
    allowedActions: listOperationalIdentityProviderAllowedActions(provider),
  };
}
