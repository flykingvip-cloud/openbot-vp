import {
  refreshBilibiliAccessToken,
  resolveBilibiliExpiresAtIso,
} from "../enterprise-operational-identity-bilibili-api.js";
import { refreshDouyinAccessToken } from "../enterprise-operational-identity-douyin-api.js";
import type { EnterpriseOperationalIdentityCredentialSecret } from "../enterprise-operational-identity-oauth/credential-secrets-persistence.js";
import { withEnterpriseOperationalIdentityCredentialSecretStoreWriteLock } from "../enterprise-operational-identity-oauth/credential-secrets-persistence.js";
import type { EnterpriseOperationalIdentityProvider } from "../enterprise-operational-identity-types.js";
import { refreshWechatOfficialOperationalAccessToken } from "../enterprise-operational-identity-wechat-official-credential.js";
import { resolveUserOperationalIdentityOAuthAdapterConfig } from "../user-operational-identity-oauth-adapters/index.js";

export type RefreshOperationalIdentityCredentialResult =
  | { ok: true; secret: EnterpriseOperationalIdentityCredentialSecret; refreshed: boolean }
  | { ok: false; code: string; error: string };

export async function refreshOperationalIdentityCredential(params: {
  provider: EnterpriseOperationalIdentityProvider;
  credentialBindingId: string;
  secret: EnterpriseOperationalIdentityCredentialSecret;
  externalAccountId?: string;
  nowIso: string;
}): Promise<RefreshOperationalIdentityCredentialResult> {
  if (params.provider === "wechat-official") {
    try {
      const refreshed = await refreshWechatOfficialOperationalAccessToken({
        secret: params.secret,
        externalAccountId: params.externalAccountId,
        nowIso: params.nowIso,
      });
      if (refreshed.refreshed) {
        await withEnterpriseOperationalIdentityCredentialSecretStoreWriteLock(async (store) => {
          store.secrets[params.credentialBindingId] = refreshed.secret;
          return store;
        });
      }
      return { ok: true, secret: refreshed.secret, refreshed: refreshed.refreshed };
    } catch (error) {
      return {
        ok: false,
        code: "IDENTITY_003",
        error: error instanceof Error ? error.message : "Token refresh failed.",
      };
    }
  }

  if (params.provider === "douyin") {
    const refreshToken = params.secret.refreshToken?.trim();
    if (!refreshToken) {
      return { ok: true, secret: params.secret, refreshed: false };
    }
    const config = resolveUserOperationalIdentityOAuthAdapterConfig({ provider: "douyin" });
    if (!config) {
      return {
        ok: false,
        code: "IDENTITY_003",
        error: "Douyin OAuth client 未配置，无法刷新 token。",
      };
    }
    try {
      const refreshed = await refreshDouyinAccessToken({
        clientKey: config.clientId,
        refreshToken,
      });
      const updated: EnterpriseOperationalIdentityCredentialSecret = {
        ...params.secret,
        accessToken: refreshed.accessToken,
        refreshToken: refreshed.refreshToken ?? refreshToken,
        expiresAt: refreshed.expiresIn
          ? new Date(new Date(params.nowIso).getTime() + refreshed.expiresIn * 1000).toISOString()
          : params.secret.expiresAt,
        updatedAt: params.nowIso,
      };
      await withEnterpriseOperationalIdentityCredentialSecretStoreWriteLock(async (store) => {
        store.secrets[params.credentialBindingId] = updated;
        return store;
      });
      return { ok: true, secret: updated, refreshed: true };
    } catch (error) {
      return {
        ok: false,
        code: "IDENTITY_003",
        error: error instanceof Error ? error.message : "Token refresh failed.",
      };
    }
  }

  if (params.provider === "bilibili") {
    const refreshToken = params.secret.refreshToken?.trim();
    if (!refreshToken) {
      return { ok: true, secret: params.secret, refreshed: false };
    }
    const config = resolveUserOperationalIdentityOAuthAdapterConfig({ provider: "bilibili" });
    if (!config) {
      return {
        ok: false,
        code: "IDENTITY_003",
        error: "Bilibili OAuth client 未配置，无法刷新 token。",
      };
    }
    try {
      const refreshed = await refreshBilibiliAccessToken({
        clientId: config.clientId,
        clientSecret: config.clientSecret,
        refreshToken,
      });
      const updated: EnterpriseOperationalIdentityCredentialSecret = {
        ...params.secret,
        accessToken: refreshed.accessToken,
        refreshToken: refreshed.refreshToken ?? refreshToken,
        expiresAt:
          resolveBilibiliExpiresAtIso(refreshed.expiresIn, params.nowIso) ??
          params.secret.expiresAt,
        updatedAt: params.nowIso,
      };
      await withEnterpriseOperationalIdentityCredentialSecretStoreWriteLock(async (store) => {
        store.secrets[params.credentialBindingId] = updated;
        return store;
      });
      return { ok: true, secret: updated, refreshed: true };
    } catch (error) {
      return {
        ok: false,
        code: "IDENTITY_003",
        error: error instanceof Error ? error.message : "Token refresh failed.",
      };
    }
  }

  const expiresAt = params.secret.expiresAt;
  if (expiresAt && expiresAt > params.nowIso) {
    return { ok: true, secret: params.secret, refreshed: false };
  }
  if (!params.secret.refreshToken?.trim()) {
    return { ok: true, secret: params.secret, refreshed: false };
  }

  return {
    ok: false,
    code: "IDENTITY_003",
    error: `Provider ${params.provider} 的 refreshCredential 尚未实现。`,
  };
}

export async function maybeRefreshOperationalIdentityCredential(params: {
  provider: EnterpriseOperationalIdentityProvider;
  credentialBindingId: string;
  secret: EnterpriseOperationalIdentityCredentialSecret | null;
  externalAccountId?: string;
  nowIso: string;
}): Promise<EnterpriseOperationalIdentityCredentialSecret | null> {
  if (!params.secret) {
    return null;
  }
  const expiresAt = params.secret.expiresAt;
  const shouldRefresh =
    !params.secret.accessToken?.trim() || (expiresAt != null && expiresAt <= params.nowIso);
  if (!shouldRefresh) {
    return params.secret;
  }
  const result = await refreshOperationalIdentityCredential({
    provider: params.provider,
    credentialBindingId: params.credentialBindingId,
    secret: params.secret,
    externalAccountId: params.externalAccountId,
    nowIso: params.nowIso,
  });
  return result.ok ? result.secret : params.secret;
}
