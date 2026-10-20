const NOTION_AUTHORIZE_URL = "https://api.notion.com/v1/oauth/authorize";
const NOTION_TOKEN_URL = "https://api.notion.com/v1/oauth/token";
const NOTION_API_VERSION = "2022-06-28";

export type NotionOAuthConfig = {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
};

export type NotionOAuthTokenResult = {
  accessToken: string;
  workspaceId?: string;
  workspaceName?: string;
  botId?: string;
};

export function resolveNotionOAuthConfig(params?: {
  redirectUri?: string;
}): NotionOAuthConfig | null {
  const clientId =
    process.env.OPENBOT_ENTERPRISE_DATA_NOTION_CLIENT_ID?.trim() ||
    process.env.OPENBOT_NOTION_OAUTH_CLIENT_ID?.trim();
  const clientSecret =
    process.env.OPENBOT_ENTERPRISE_DATA_NOTION_CLIENT_SECRET?.trim() ||
    process.env.OPENBOT_NOTION_OAUTH_CLIENT_SECRET?.trim();
  const redirectUri =
    params?.redirectUri?.trim() ||
    process.env.OPENBOT_ENTERPRISE_DATA_NOTION_REDIRECT_URI?.trim() ||
    "";
  if (!clientId || !clientSecret || !redirectUri) {
    return null;
  }
  return { clientId, clientSecret, redirectUri };
}

export function buildNotionAuthorizeUrl(params: {
  clientId: string;
  redirectUri: string;
  state: string;
}): string {
  const query = new URLSearchParams({
    client_id: params.clientId,
    response_type: "code",
    owner: "user",
    redirect_uri: params.redirectUri,
    state: params.state,
  });
  return `${NOTION_AUTHORIZE_URL}?${query.toString()}`;
}

export async function exchangeNotionAuthorizationCode(params: {
  code: string;
  redirectUri: string;
  clientId: string;
  clientSecret: string;
}): Promise<NotionOAuthTokenResult> {
  const credentials = Buffer.from(`${params.clientId}:${params.clientSecret}`).toString("base64");
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code: params.code,
    redirect_uri: params.redirectUri,
  });
  const response = await fetch(NOTION_TOKEN_URL, {
    method: "POST",
    headers: {
      Authorization: `Basic ${credentials}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: body.toString(),
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(
      `Notion token exchange failed (${response.status})${detail ? `: ${detail.slice(0, 160)}` : ""}`,
    );
  }
  const payload = (await response.json()) as {
    access_token?: string;
    workspace_id?: string;
    workspace_name?: string;
    bot_id?: string;
  };
  const accessToken = payload.access_token?.trim();
  if (!accessToken) {
    throw new Error("Notion token exchange returned no access_token.");
  }
  return {
    accessToken,
    workspaceId: payload.workspace_id,
    workspaceName: payload.workspace_name,
    botId: payload.bot_id,
  };
}

export async function probeNotionAccessToken(accessToken: string): Promise<{
  ok: boolean;
  message: string;
}> {
  const response = await fetch("https://api.notion.com/v1/users/me", {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Notion-Version": NOTION_API_VERSION,
    },
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    return {
      ok: false,
      message: `Notion API 返回 ${response.status}${detail ? `：${detail.slice(0, 120)}` : ""}`,
    };
  }
  return {
    ok: true,
    message: "Notion API 连通性正常（OAuth 访问令牌有效）。",
  };
}

export { NOTION_API_VERSION };
