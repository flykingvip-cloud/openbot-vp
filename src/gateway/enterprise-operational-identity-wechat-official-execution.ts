import type { EnterpriseOperationalIdentityCredentialSecret } from "./enterprise-operational-identity-oauth/credential-secrets-persistence.js";
import { withEnterpriseOperationalIdentityCredentialSecretStoreWriteLock } from "./enterprise-operational-identity-oauth/credential-secrets-persistence.js";
import { refreshWechatOfficialOperationalAccessToken } from "./enterprise-operational-identity-wechat-official-credential.js";
import { executeWechatOfficialActionWithTicketRetry } from "./wechat-official/credentials.js";
import {
  executeWechatOfficialActionsWithAccessToken,
  parseWechatOfficialOperationalActionPayload,
  type WechatOfficialOperationalActionPayload,
} from "./wechat-official/execute-operational-actions.js";

export type EnterpriseOperationalIdentityWechatPayload = WechatOfficialOperationalActionPayload;

export const parseEnterpriseOperationalIdentityWechatPayload =
  parseWechatOfficialOperationalActionPayload;

async function persistRefreshedWechatOfficialSecret(params: {
  credentialBindingId: string;
  secret: EnterpriseOperationalIdentityCredentialSecret;
}): Promise<void> {
  await withEnterpriseOperationalIdentityCredentialSecretStoreWriteLock(async (store) => {
    store.secrets[params.credentialBindingId] = params.secret;
    return store;
  });
}

export async function executeWechatOfficialOperationalAction(params: {
  action: string;
  payload: EnterpriseOperationalIdentityWechatPayload;
  secret: EnterpriseOperationalIdentityCredentialSecret;
  credentialBindingId: string;
  externalAccountId?: string;
}): Promise<Record<string, unknown>> {
  let currentSecret = params.secret;
  const resolveTicket = async (forceRefresh: boolean): Promise<string | null> => {
    try {
      const result = await refreshWechatOfficialOperationalAccessToken({
        secret: currentSecret,
        externalAccountId: params.externalAccountId,
        nowIso: new Date().toISOString(),
        forceRefresh,
      });
      currentSecret = result.secret;
      if (result.refreshed) {
        await persistRefreshedWechatOfficialSecret({
          credentialBindingId: params.credentialBindingId,
          secret: currentSecret,
        });
      }
      return currentSecret.accessToken?.trim() || null;
    } catch {
      return null;
    }
  };

  return executeWechatOfficialActionWithTicketRetry({
    resolveTicket,
    cachedTicket: params.secret.accessToken,
    missingTicketError: "缺少 AppID 或 access_token；请保存 AppID 与 AppSecret。",
    execute: (accessToken) => {
      const authorizerAppId =
        params.externalAccountId?.trim() ||
        currentSecret.externalAccountId?.trim() ||
        currentSecret.metadata?.appId?.trim() ||
        "";
      if (!authorizerAppId) {
        throw new Error("缺少 AppID 或 access_token；请保存 AppID 与 AppSecret。");
      }
      return executeWechatOfficialActionsWithAccessToken({
        action: params.action,
        payload: params.payload,
        accessToken,
        appId: authorizerAppId,
      });
    },
  });
}
