import type { EnterpriseOperationalIdentityCredentialSecret } from "./enterprise-operational-identity-oauth/credential-secrets-persistence.js";
import {
  resolveTencentMeetingClientConfigFromSecret,
  verifyTencentMeetingCredentials,
} from "./enterprise-operational-identity-tencent-meeting-api.js";
import {
  resolveTencentMeetingMcpToken,
  verifyTencentMeetingMcpToken,
} from "./enterprise-operational-identity-tencent-meeting-mcp.js";

export function resolveTencentMeetingDefaultUserId(params: {
  secret: EnterpriseOperationalIdentityCredentialSecret;
  externalAccountId?: string;
}): string {
  return (
    params.externalAccountId?.trim() ||
    params.secret.metadata?.defaultUserId?.trim() ||
    params.secret.externalAccountId?.trim() ||
    ""
  );
}

export function hasTencentMeetingAkSk(params: {
  secret: EnterpriseOperationalIdentityCredentialSecret;
}): boolean {
  return Boolean(params.secret.metadata?.secretId?.trim() && params.secret.accessToken?.trim());
}

export async function probeTencentMeetingCredential(params: {
  secret: EnterpriseOperationalIdentityCredentialSecret;
  externalAccountId?: string;
  fetchImpl?: typeof fetch;
}): Promise<{ userId: string; signatureOk: boolean; detail?: string }> {
  const userId = resolveTencentMeetingDefaultUserId(params);
  if (hasTencentMeetingAkSk(params)) {
    if (!userId) {
      return { userId: "", signatureOk: false, detail: "缺少默认操作员 userid。" };
    }
    const config = resolveTencentMeetingClientConfigFromSecret({
      accessToken: params.secret.accessToken,
      metadata: params.secret.metadata,
      externalAccountId: userId,
    });
    if (!config) {
      return {
        userId,
        signatureOk: false,
        detail: "SecretId、SecretKey 或默认 userid 未配置完整。",
      };
    }
    try {
      await verifyTencentMeetingCredentials({ config, fetchImpl: params.fetchImpl });
      return { userId, signatureOk: true };
    } catch (error) {
      return {
        userId,
        signatureOk: false,
        detail: error instanceof Error ? error.message : "腾讯会议 API 签名验证失败。",
      };
    }
  }

  const token = resolveTencentMeetingMcpToken({
    accessToken: params.secret.accessToken,
    metadata: params.secret.metadata,
  });
  if (!token) {
    return { userId, signatureOk: false, detail: "缺少腾讯会议 Token。" };
  }
  try {
    await verifyTencentMeetingMcpToken({ token, fetchImpl: params.fetchImpl });
    return { userId, signatureOk: true };
  } catch (error) {
    return {
      userId,
      signatureOk: false,
      detail: error instanceof Error ? error.message : "腾讯会议 Token 验证失败。",
    };
  }
}
