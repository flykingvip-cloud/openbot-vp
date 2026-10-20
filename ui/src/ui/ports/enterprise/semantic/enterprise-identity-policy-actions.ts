import type { EnterprisePortReadModel } from "./enterprise-read-model.ts";

export type IdentityPolicyActionOption = {
  action: string;
  label: string;
};

export type IdentityPolicyUnavailableAction = IdentityPolicyActionOption & {
  reason: string;
};

export type IdentityPolicyActionCatalog = {
  identities: Array<{ identityId: string; provider: string }>;
  providerCatalog: Array<{
    provider: string;
    operationalActions: IdentityPolicyActionOption[];
  }>;
};

export function buildIdentityPolicyActionCatalog(
  readModel: EnterprisePortReadModel,
): IdentityPolicyActionCatalog {
  return {
    identities: readModel.identitySummaries.map((entry) => ({
      identityId: entry.identityId,
      provider: entry.provider,
    })),
    providerCatalog: readModel.identityProviderCatalog.map((entry) => ({
      provider: entry.provider,
      operationalActions: entry.operationalActions ?? [],
    })),
  };
}

export function listVerifiedOperationalActionsForIdentity(
  catalog: IdentityPolicyActionCatalog,
  identityId: string,
): IdentityPolicyActionOption[] {
  const identity = catalog.identities.find((entry) => entry.identityId === identityId);
  if (!identity) {
    return [];
  }
  const providerEntry = catalog.providerCatalog.find(
    (entry) => entry.provider === identity.provider,
  );
  return providerEntry?.operationalActions ?? [];
}

function filterPolicyActionsAgainstCatalog(params: {
  catalog: IdentityPolicyActionCatalog;
  identityId: string;
  actions: string[];
}): string[] {
  const trimmed = params.actions.filter((action) => action.trim().length > 0);
  const identity = params.catalog.identities.find(
    (entry) => entry.identityId === params.identityId,
  );
  if (!identity) {
    return trimmed;
  }
  const providerEntry = params.catalog.providerCatalog.find(
    (entry) => entry.provider === identity.provider,
  );
  const allowed = new Set((providerEntry?.operationalActions ?? []).map((entry) => entry.action));
  if (allowed.size === 0) {
    return trimmed;
  }
  return trimmed.filter((action) => allowed.has(action));
}

function resolveIdentitySummary(
  readModel: EnterprisePortReadModel,
  identityId: string,
): EnterprisePortReadModel["identitySummaries"][number] | undefined {
  const normalized = identityId.trim();
  if (!normalized) {
    return undefined;
  }
  return readModel.identitySummaries.find((entry) => entry.identityId === normalized);
}

function resolveOperationalActions(
  readModel: EnterprisePortReadModel,
  provider: string,
): IdentityPolicyActionOption[] {
  const catalogEntry = readModel.identityProviderCatalog.find(
    (entry) => entry.provider === provider,
  );
  return catalogEntry?.operationalActions ?? [];
}

export function resolveIdentityPolicyActionGroups(params: {
  readModel: EnterprisePortReadModel;
  identityId: string;
  provider: string;
}): {
  verifiedActions: IdentityPolicyActionOption[];
  unavailableActions: IdentityPolicyUnavailableAction[];
} {
  const operationalActions = resolveOperationalActions(params.readModel, params.provider);
  const identity = resolveIdentitySummary(params.readModel, params.identityId);
  const verifiedSet = new Set(identity?.capabilities ?? []);
  const missingSet = new Set(identity?.capabilityMissing ?? []);
  const hasDiscovery = verifiedSet.size > 0 || missingSet.size > 0;

  if (!hasDiscovery) {
    return {
      verifiedActions: operationalActions,
      unavailableActions: [],
    };
  }

  const verifiedActions = operationalActions.filter((entry) => verifiedSet.has(entry.action));
  const unavailableActions = operationalActions
    .filter((entry) => !verifiedSet.has(entry.action))
    .map((entry) => ({
      ...entry,
      reason: missingSet.has(entry.action)
        ? "测试连接后未发现该能力。若需使用，请确认公众号已开通对应权限并重新测试连接。"
        : "尚未验证该能力，请先测试连接。",
    }));

  return { verifiedActions, unavailableActions };
}

export function filterPolicyActionsToVerified(params: {
  readModel?: EnterprisePortReadModel;
  catalog?: IdentityPolicyActionCatalog;
  identityId: string;
  actions: string[];
}): string[] {
  if (params.catalog && !params.readModel) {
    return filterPolicyActionsAgainstCatalog({
      catalog: params.catalog,
      identityId: params.identityId,
      actions: params.actions,
    });
  }
  const readModel = params.readModel;
  if (!readModel) {
    return params.actions.filter((action) => action.trim().length > 0);
  }
  const identity = resolveIdentitySummary(readModel, params.identityId);
  const verified = identity?.capabilities;
  if (!verified?.length) {
    return params.actions;
  }
  const verifiedSet = new Set(verified);
  return params.actions.filter((action) => verifiedSet.has(action));
}

export function suggestVerifiedPolicyActions(params: {
  readModel: EnterprisePortReadModel;
  identityId: string;
  provider: string;
}): string[] {
  const { verifiedActions } = resolveIdentityPolicyActionGroups(params);
  if (verifiedActions.length > 0) {
    return verifiedActions.map((entry) => entry.action);
  }
  const operationalActions = resolveOperationalActions(params.readModel, params.provider);
  const identity = resolveIdentitySummary(params.readModel, params.identityId);
  const missingSet = new Set(identity?.capabilityMissing ?? []);
  return operationalActions
    .filter((entry) => !missingSet.has(entry.action))
    .map((entry) => entry.action);
}

export function formatIdentityPolicyCapabilityError(params: {
  error?: string;
  code?: string;
  actionLabels?: Map<string, string>;
}): string | null {
  if (params.code !== "ENTERPRISE_IDENTITY_CAPABILITY_NOT_DISCOVERED") {
    const message = params.error?.trim() ?? "";
    const match = message.match(/Action (\S+) is not among verified capabilities/);
    if (!match) {
      return null;
    }
    const action = match[1];
    const label = params.actionLabels?.get(action) ?? action;
    if (action === "broadcast_article") {
      return `「${label}」需要公众号具备群发权限。当前测试连接未验证通过该能力，请取消勾选或在「安全状态」中重新测试连接后再保存。`;
    }
    return `「${label}」尚未通过连接验证，无法写入策略。请取消该动作，或先测试连接确认能力可用后再保存。`;
  }
  const message = params.error?.trim() ?? "";
  const match = message.match(/Action (\S+) is not among verified capabilities/);
  const action = match?.[1] ?? "";
  const label = (action && params.actionLabels?.get(action)) || action || "该动作";
  if (action === "broadcast_article") {
    return `「${label}」需要公众号具备群发权限。当前测试连接未验证通过该能力，请取消勾选或在「安全状态」中重新测试连接后再保存。`;
  }
  return `「${label}」尚未通过连接验证，无法写入策略。请取消该动作，或先测试连接确认能力可用后再保存。`;
}
