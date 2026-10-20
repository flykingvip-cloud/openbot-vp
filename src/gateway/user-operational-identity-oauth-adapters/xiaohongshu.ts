import { createHash } from "node:crypto";
import type { UserOperationalIdentityOAuthAdapter } from "./types.js";
import { resolveOAuthEnvConfig } from "./types.js";

const XHS_AUTHORIZE_URL = "https://ark.xiaohongshu.com/ark/authorization";
const XHS_API_URL = "https://ark.xiaohongshu.com/ark/open_api/v3/common_controller";

function signXiaohongshuRequest(params: {
  method: string;
  appId: string;
  timestamp: string;
  appSecret: string;
}): string {
  const payload = `${params.method}?appId=${params.appId}&timestamp=${params.timestamp}&version=2.0${params.appSecret}`;
  return createHash("md5").update(payload).digest("hex");
}

export const xiaohongshuOAuthAdapter: UserOperationalIdentityOAuthAdapter = {
  provider: "xiaohongshu",
  envPrefix: "XIAOHONGSHU",
  resolveConfig: (params) =>
    resolveOAuthEnvConfig({
      envPrefix: "XIAOHONGSHU",
      redirectUri: params?.redirectUri,
      clientIdKeys: ["APP_ID", "CLIENT_ID"],
      clientSecretKeys: ["APP_SECRET", "CLIENT_SECRET"],
    }),
  buildAuthorizeUrl: ({ config, state }) => {
    const query = new URLSearchParams({
      appId: config.clientId,
      redirectUri: config.redirectUri,
      state,
    });
    return `${XHS_AUTHORIZE_URL}?${query.toString()}`;
  },
  exchangeCode: async ({ config, code }) => {
    const timestamp = String(Date.now());
    const method = "oauth.getAccessToken";
    const sign = signXiaohongshuRequest({
      method,
      appId: config.clientId,
      timestamp,
      appSecret: config.clientSecret,
    });
    const body = {
      sign,
      appId: config.clientId,
      timestamp,
      version: "2.0",
      method,
      code,
    };
    const response = await fetch(XHS_API_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!response.ok) {
      throw new Error(`Xiaohongshu token exchange failed: HTTP ${response.status}`);
    }
    const payload = (await response.json()) as {
      data?: {
        accessToken?: string;
        refreshToken?: string;
        accessTokenExpiresIn?: number;
        sellerId?: string;
        sellerName?: string;
      };
      error_msg?: string;
    };
    const data = payload.data;
    if (!data?.accessToken) {
      throw new Error(payload.error_msg ?? "Xiaohongshu token exchange failed.");
    }
    return {
      accessToken: data.accessToken,
      refreshToken: data.refreshToken,
      expiresIn: data.accessTokenExpiresIn,
      accountLabel: data.sellerName ?? data.sellerId,
      externalAccountId: data.sellerId,
      metadata: data.sellerId ? { sellerId: data.sellerId } : undefined,
    };
  },
};
