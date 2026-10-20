import type { EnterpriseOperationalIdentityCredentialSecret } from "./enterprise-operational-identity-oauth/credential-secrets-persistence.js";
import { refreshWechatAuthorizerAccessToken } from "./enterprise-operational-identity-oauth/wechat-component.js";
import {
  fetchWechatOfficialAccountBasicInfo,
  fetchWechatOfficialClientCredentialToken,
} from "./enterprise-operational-identity-wechat-official-api.js";

export type WechatOfficialAuthMode = "authorizer" | "client_credential";

export function resolveWechatOfficialAuthMode(
  secret: EnterpriseOperationalIdentityCredentialSecret,
): WechatOfficialAuthMode {
  if (secret.metadata?.authMode === "client_credential") {
    return "client_credential";
  }
  if (secret.refreshToken?.trim()) {
    return "authorizer";
  }
  if (secret.metadata?.appSecret?.trim()) {
    return "client_credential";
  }
  // AppID-only manual bind matches employee personal settings: AppID + AppSecret.
  if (secret.metadata?.appId?.trim() || secret.externalAccountId?.trim()) {
    return "client_credential";
  }
  return "authorizer";
}

export function resolveWechatOfficialAppId(params: {
  secret: EnterpriseOperationalIdentityCredentialSecret;
  externalAccountId?: string;
}): string {
  return (
    params.externalAccountId?.trim() ||
    params.secret.externalAccountId?.trim() ||
    params.secret.metadata?.appId?.trim() ||
    ""
  );
}

function resolveWechatOfficialExpiresAtIso(expiresIn: number, nowIso: string): string {
  return new Date(new Date(nowIso).getTime() + expiresIn * 1000).toISOString();
}

export async function finalizeWechatOfficialManualCredentialSecret(params: {
  secret: EnterpriseOperationalIdentityCredentialSecret;
  appId: string;
  appSecret: string;
  nowIso: string;
}): Promise<EnterpriseOperationalIdentityCredentialSecret> {
  const appId = params.appId.trim();
  const appSecret = params.appSecret.trim();
  if (!appId || !appSecret) {
    throw new Error("AppID 与 AppSecret 均为必填。");
  }
  const token = await fetchWechatOfficialClientCredentialToken({ appId, appSecret });
  return {
    ...params.secret,
    externalAccountId: appId,
    accessToken: token.accessToken,
    expiresAt: resolveWechatOfficialExpiresAtIso(token.expiresIn, params.nowIso),
    updatedAt: params.nowIso,
    metadata: {
      ...params.secret.metadata,
      authMode: "client_credential",
      appId,
      appSecret,
    },
  };
}

export async function refreshWechatOfficialOperationalAccessToken(params: {
  secret: EnterpriseOperationalIdentityCredentialSecret;
  externalAccountId?: string;
  nowIso: string;
  forceRefresh?: boolean;
}): Promise<{ secret: EnterpriseOperationalIdentityCredentialSecret; refreshed: boolean }> {
  const mode = resolveWechatOfficialAuthMode(params.secret);
  const appId = resolveWechatOfficialAppId(params);
  const expiresAt = params.secret.expiresAt;
  const accessToken = params.secret.accessToken?.trim();
  // client_credential tokens must come from getStableAccessToken. A locally
  // cached gettoken value is often invalidated by a later gettoken and then
  // fails with 40001 "access_token is invalid or not latest".
  if (
    !params.forceRefresh &&
    mode !== "client_credential" &&
    accessToken &&
    expiresAt &&
    expiresAt > params.nowIso &&
    new Date(expiresAt).getTime() - new Date(params.nowIso).getTime() > 5 * 60 * 1000
  ) {
    return { secret: params.secret, refreshed: false };
  }

  if (mode === "client_credential") {
    const appSecret = params.secret.metadata?.appSecret?.trim();
    if (!appId || !appSecret) {
      throw new Error("缺少 AppID 或 AppSecret；请重新保存公众号凭证。");
    }
    const token = await fetchWechatOfficialClientCredentialToken({
      appId,
      appSecret,
      forceRefresh: params.forceRefresh,
    });
    return {
      refreshed: true,
      secret: {
        ...params.secret,
        externalAccountId: appId,
        accessToken: token.accessToken,
        expiresAt: resolveWechatOfficialExpiresAtIso(token.expiresIn, params.nowIso),
        updatedAt: params.nowIso,
        metadata: {
          ...params.secret.metadata,
          authMode: "client_credential",
          appId,
          appSecret,
        },
      },
    };
  }

  const refreshToken = params.secret.refreshToken?.trim();
  if (!appId || !refreshToken) {
    throw new Error("缺少 authorizer_appid 或 refresh_token；请重新 OAuth 授权。");
  }
  const refreshed = await refreshWechatAuthorizerAccessToken({
    authorizerAppId: appId,
    authorizerRefreshToken: refreshToken,
  });
  return {
    refreshed: true,
    secret: {
      ...params.secret,
      externalAccountId: appId,
      accessToken: refreshed.authorizerAccessToken,
      refreshToken: refreshed.authorizerRefreshToken ?? refreshToken,
      expiresAt: refreshed.expiresIn
        ? resolveWechatOfficialExpiresAtIso(refreshed.expiresIn, params.nowIso)
        : params.secret.expiresAt,
      updatedAt: params.nowIso,
    },
  };
}

export async function probeWechatOfficialCredential(params: {
  secret: EnterpriseOperationalIdentityCredentialSecret;
  externalAccountId?: string;
}): Promise<{ appId: string; tokenOk: boolean; detail?: string }> {
  const appId = resolveWechatOfficialAppId(params);
  if (!appId) {
    return { appId: "", tokenOk: false, detail: "尚未绑定公众号 AppID。" };
  }
  const mode = resolveWechatOfficialAuthMode(params.secret);
  try {
    if (mode === "client_credential") {
      const appSecret = params.secret.metadata?.appSecret?.trim();
      if (!appSecret) {
        return { appId, tokenOk: false, detail: "缺少 AppSecret。" };
      }
      await fetchWechatOfficialClientCredentialToken({ appId, appSecret });
      return { appId, tokenOk: true };
    }
    const accessToken = params.secret.accessToken?.trim();
    if (!accessToken) {
      return { appId, tokenOk: false, detail: "缺少 authorizer access_token。" };
    }
    const profile = await fetchWechatOfficialAccountBasicInfo({ accessToken });
    if (!profile.ok) {
      return { appId, tokenOk: false, detail: profile.error };
    }
    return { appId, tokenOk: true };
  } catch (error) {
    return {
      appId,
      tokenOk: false,
      detail: error instanceof Error ? error.message : "Token 验证失败。",
    };
  }
}
