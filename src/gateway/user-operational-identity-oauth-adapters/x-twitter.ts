import type { UserOperationalIdentityOAuthAdapter } from "./types.js";
import { fetchAccountLabelFromBearer, resolveOAuthEnvConfig } from "./types.js";

const X_AUTHORIZE_URL = "https://x.com/i/oauth2/authorize";
const X_TOKEN_URL = "https://api.twitter.com/2/oauth2/token";

export const xTwitterOAuthAdapter: UserOperationalIdentityOAuthAdapter = {
  provider: "x-twitter",
  envPrefix: "X_TWITTER",
  requiresPkce: true,
  resolveConfig: (params) => {
    const fromOpenBotPrefix = resolveOAuthEnvConfig({
      envPrefix: "X_TWITTER",
      redirectUri: params?.redirectUri,
      clientIdKeys: ["CLIENT_ID"],
      clientSecretKeys: ["CLIENT_SECRET"],
    });
    if (fromOpenBotPrefix) {
      return fromOpenBotPrefix;
    }
    // Aliases for operator shorthand (same values as OPENBOT_USER_OPERATIONAL_IDENTITY_X_TWITTER_*).
    const clientId = process.env.X_TWITTER_CLIENT_ID?.trim() || "";
    const clientSecret = process.env.X_TWITTER_CLIENT_SECRET?.trim() || "";
    const redirectUri =
      params?.redirectUri?.trim() || process.env.X_TWITTER_REDIRECT_URI?.trim() || "";
    if (!clientId || !clientSecret || !redirectUri) {
      return null;
    }
    return { clientId, clientSecret, redirectUri };
  },
  buildAuthorizeUrl: ({ config, state, codeChallenge }) => {
    const scope =
      process.env.OPENBOT_USER_OPERATIONAL_IDENTITY_X_TWITTER_SCOPE?.trim() ||
      "tweet.read tweet.write users.read offline.access";
    const query = new URLSearchParams({
      response_type: "code",
      client_id: config.clientId,
      redirect_uri: config.redirectUri,
      scope,
      state,
      code_challenge: codeChallenge ?? "",
      code_challenge_method: "S256",
    });
    return `${X_AUTHORIZE_URL}?${query.toString()}`;
  },
  exchangeCode: async ({ config, code, codeVerifier }) => {
    if (!codeVerifier?.trim()) {
      throw new Error("X OAuth requires PKCE code_verifier.");
    }
    const body = new URLSearchParams({
      code,
      grant_type: "authorization_code",
      client_id: config.clientId,
      redirect_uri: config.redirectUri,
      code_verifier: codeVerifier,
    });
    const headers: Record<string, string> = {
      "Content-Type": "application/x-www-form-urlencoded",
    };
    if (config.clientSecret) {
      headers.Authorization = `Basic ${Buffer.from(`${config.clientId}:${config.clientSecret}`).toString("base64")}`;
    }
    const response = await fetch(X_TOKEN_URL, { method: "POST", headers, body });
    if (!response.ok) {
      throw new Error(`X token exchange failed: HTTP ${response.status}`);
    }
    const payload = (await response.json()) as {
      access_token?: string;
      refresh_token?: string;
      expires_in?: number;
      scope?: string;
      error?: string;
      error_description?: string;
    };
    if (!payload.access_token) {
      throw new Error(payload.error_description ?? payload.error ?? "X token exchange failed.");
    }
    const accountLabel = await fetchAccountLabelFromBearer({
      url: "https://api.twitter.com/2/users/me",
      accessToken: payload.access_token,
      pickLabel: (userPayload) => {
        const data = userPayload.data;
        if (data && typeof data === "object" && !Array.isArray(data)) {
          const username = (data as Record<string, unknown>).username;
          return typeof username === "string" ? username.trim() : undefined;
        }
        return undefined;
      },
    });
    return {
      accessToken: payload.access_token,
      refreshToken: payload.refresh_token,
      expiresIn: payload.expires_in,
      scope: payload.scope,
      accountLabel: accountLabel ? `@${accountLabel}` : undefined,
      externalAccountId: accountLabel,
    };
  },
};
