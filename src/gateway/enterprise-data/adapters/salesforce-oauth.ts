const SALESFORCE_DEFAULT_LOGIN_URL = "https://login.salesforce.com";

export type SalesforceOAuthConfig = {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  /** Login host: https://login.salesforce.com (prod) or https://test.salesforce.com (sandbox). */
  loginUrl: string;
};

export type SalesforceOAuthTokenResult = {
  accessToken: string;
  /** Per-org API base returned by Salesforce; stored as the credential instanceUrl. */
  instanceUrl?: string;
  refreshToken?: string;
};

export function resolveSalesforceOAuthConfig(params?: {
  redirectUri?: string;
}): SalesforceOAuthConfig | null {
  const clientId =
    process.env.OPENBOT_ENTERPRISE_DATA_SALESFORCE_CLIENT_ID?.trim() ||
    process.env.OPENBOT_SALESFORCE_OAUTH_CLIENT_ID?.trim();
  const clientSecret =
    process.env.OPENBOT_ENTERPRISE_DATA_SALESFORCE_CLIENT_SECRET?.trim() ||
    process.env.OPENBOT_SALESFORCE_OAUTH_CLIENT_SECRET?.trim();
  const redirectUri =
    params?.redirectUri?.trim() ||
    process.env.OPENBOT_ENTERPRISE_DATA_SALESFORCE_REDIRECT_URI?.trim() ||
    "";
  const loginUrl = (
    process.env.OPENBOT_ENTERPRISE_DATA_SALESFORCE_LOGIN_URL?.trim() ||
    process.env.OPENBOT_SALESFORCE_OAUTH_LOGIN_URL?.trim() ||
    SALESFORCE_DEFAULT_LOGIN_URL
  ).replace(/\/+$/, "");
  if (!clientId || !clientSecret || !redirectUri) {
    return null;
  }
  return { clientId, clientSecret, redirectUri, loginUrl };
}

export function buildSalesforceAuthorizeUrl(params: {
  clientId: string;
  redirectUri: string;
  state: string;
  loginUrl?: string;
}): string {
  const loginUrl = (params.loginUrl?.trim() || SALESFORCE_DEFAULT_LOGIN_URL).replace(/\/+$/, "");
  const query = new URLSearchParams({
    response_type: "code",
    client_id: params.clientId,
    redirect_uri: params.redirectUri,
    state: params.state,
    scope: "api refresh_token",
  });
  return `${loginUrl}/services/oauth2/authorize?${query.toString()}`;
}

export async function exchangeSalesforceAuthorizationCode(params: {
  code: string;
  redirectUri: string;
  clientId: string;
  clientSecret: string;
  loginUrl?: string;
}): Promise<SalesforceOAuthTokenResult> {
  const loginUrl = (params.loginUrl?.trim() || SALESFORCE_DEFAULT_LOGIN_URL).replace(/\/+$/, "");
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code: params.code,
    redirect_uri: params.redirectUri,
    client_id: params.clientId,
    client_secret: params.clientSecret,
  });
  const response = await fetch(`${loginUrl}/services/oauth2/token`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
    },
    body: body.toString(),
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(
      `Salesforce token exchange failed (${response.status})${
        detail ? `: ${detail.slice(0, 160)}` : ""
      }`,
    );
  }
  const payload = (await response.json()) as {
    access_token?: string;
    instance_url?: string;
    refresh_token?: string;
  };
  const accessToken = payload.access_token?.trim();
  if (!accessToken) {
    throw new Error("Salesforce token exchange returned no access_token.");
  }
  return {
    accessToken,
    instanceUrl: payload.instance_url?.trim() || undefined,
    refreshToken: payload.refresh_token?.trim() || undefined,
  };
}

export { SALESFORCE_DEFAULT_LOGIN_URL };
