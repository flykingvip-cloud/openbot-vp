import {
  resolveBilibiliOpenClientConfig,
  verifyBilibiliAccessToken,
} from "../enterprise-operational-identity-bilibili-api.js";
import { verifyDouyinAccessToken } from "../enterprise-operational-identity-douyin-api.js";
import type { EnterpriseOperationalIdentityCredentialSecret } from "../enterprise-operational-identity-oauth/credential-secrets-persistence.js";
import { probeTencentMeetingCredential } from "../enterprise-operational-identity-tencent-meeting-credential.js";
import type { EnterpriseOperationalIdentityProvider } from "../enterprise-operational-identity-types.js";
import { probeWechatOfficialCredential } from "../enterprise-operational-identity-wechat-official-credential.js";
import { verifyWeiboAccessToken } from "../enterprise-operational-identity-weibo-api.js";

export type OperationalIdentityCredentialProbeResult = {
  ok: boolean;
  detail?: string;
};

export async function probeOperationalIdentityCredential(params: {
  provider: EnterpriseOperationalIdentityProvider;
  secret: EnterpriseOperationalIdentityCredentialSecret | null;
  externalAccountId?: string;
}): Promise<Record<string, OperationalIdentityCredentialProbeResult>> {
  const results: Record<string, OperationalIdentityCredentialProbeResult> = {};
  if (!params.secret) {
    return results;
  }

  if (params.provider === "wechat-official") {
    const probed = await probeWechatOfficialCredential({
      secret: params.secret,
      externalAccountId: params.externalAccountId,
    });
    results.appId = probed.appId
      ? { ok: true }
      : { ok: false, detail: probed.detail ?? "尚未绑定公众号 AppID。" };
    results.client_credential = probed.tokenOk
      ? { ok: true }
      : { ok: false, detail: probed.detail ?? "AppID / AppSecret 校验未通过。" };
    return results;
  }

  if (params.provider === "weibo") {
    const accessToken = params.secret.accessToken?.trim();
    if (!accessToken) {
      results.oauth_token = { ok: false, detail: "OAuth token 缺失。" };
      return results;
    }
    try {
      const verified = await verifyWeiboAccessToken({ accessToken });
      results.oauth_token = { ok: true };
      results.weibo_uid = verified.uid ? { ok: true } : { ok: false, detail: "缺少 uid。" };
    } catch (error) {
      results.oauth_token = {
        ok: false,
        detail: error instanceof Error ? error.message : "OAuth token 无效。",
      };
    }
    return results;
  }

  if (params.provider === "douyin") {
    const accessToken = params.secret.accessToken?.trim();
    const openId =
      params.externalAccountId?.trim() || params.secret.externalAccountId?.trim() || "";
    if (!accessToken) {
      results.oauth_token = { ok: false, detail: "OAuth token 缺失。" };
      return results;
    }
    if (!openId) {
      results.oauth_token = { ok: false, detail: "缺少 open_id。" };
      return results;
    }
    try {
      const verified = await verifyDouyinAccessToken({ accessToken, openId });
      results.oauth_token = { ok: true };
      results.douyin_open_id = verified.openId
        ? { ok: true }
        : { ok: false, detail: "缺少 open_id。" };
    } catch (error) {
      results.oauth_token = {
        ok: false,
        detail: error instanceof Error ? error.message : "OAuth token 无效。",
      };
    }
    return results;
  }

  if (params.provider === "bilibili") {
    const accessToken = params.secret.accessToken?.trim();
    const client = resolveBilibiliOpenClientConfig();
    if (!accessToken) {
      results.oauth_token = { ok: false, detail: "OAuth token 缺失。" };
      return results;
    }
    if (!client) {
      results.oauth_token = { ok: false, detail: "Bilibili OAuth client 未配置。" };
      return results;
    }
    try {
      await verifyBilibiliAccessToken({ accessToken, clientId: client.clientId });
      results.oauth_token = { ok: true };
    } catch (error) {
      results.oauth_token = {
        ok: false,
        detail: error instanceof Error ? error.message : "OAuth token 无效。",
      };
    }
    return results;
  }

  if (params.provider === "github-org") {
    const token =
      params.secret.accessToken?.trim() ||
      params.secret.metadata?.personalAccessToken?.trim() ||
      "";
    const installationId = params.secret.metadata?.installationId?.trim() || "";
    if (!token && !installationId) {
      results.github_auth = {
        ok: false,
        detail: "请配置 GitHub App Installation ID 或 fine-grained PAT。",
      };
      return results;
    }
    results.github_auth = { ok: true };
    return results;
  }

  if (params.provider === "tencent-meeting") {
    const probed = await probeTencentMeetingCredential({
      secret: params.secret,
      externalAccountId: params.externalAccountId,
    });
    results.auth_ok = probed.signatureOk
      ? { ok: true }
      : { ok: false, detail: probed.detail ?? "腾讯会议鉴权失败。" };
    if (probed.userId) {
      results.operator_userid = { ok: true };
    }
    results.api_signature = probed.signatureOk
      ? { ok: true }
      : { ok: false, detail: probed.detail };
    return results;
  }

  const tokenExpired =
    params.secret.expiresAt != null && params.secret.expiresAt <= new Date().toISOString();
  const tokenOk = Boolean(params.secret.accessToken?.trim()) && !tokenExpired;
  results.oauth_token = tokenOk
    ? { ok: true }
    : {
        ok: false,
        detail: tokenExpired ? "OAuth token 已过期。" : "OAuth token 缺失。",
      };

  return results;
}
