import type { UserOperationalIdentityProvider } from "../user-operational-identity-types.js";

export type UserOperationalIdentityOAuthAdapterConfig = {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
};

export type UserOperationalIdentityOAuthExchangeResult = {
  accessToken: string;
  refreshToken?: string;
  expiresIn?: number;
  scope?: string;
  accountLabel?: string;
  externalAccountId?: string;
  metadata?: Record<string, string>;
};

export type UserOperationalIdentityOAuthAdapter = {
  provider: UserOperationalIdentityProvider;
  /** Env prefix segment, e.g. WEIBO → OPENBOT_USER_OPERATIONAL_IDENTITY_WEIBO_CLIENT_ID */
  envPrefix: string;
  requiresPkce?: boolean;
  resolveConfig: (params?: {
    redirectUri?: string;
  }) => UserOperationalIdentityOAuthAdapterConfig | null;
  buildAuthorizeUrl: (params: {
    config: UserOperationalIdentityOAuthAdapterConfig;
    state: string;
    codeChallenge?: string;
  }) => string;
  exchangeCode: (params: {
    config: UserOperationalIdentityOAuthAdapterConfig;
    code: string;
    codeVerifier?: string;
  }) => Promise<UserOperationalIdentityOAuthExchangeResult>;
};

export function resolveOAuthEnvConfig(params: {
  envPrefix: string;
  redirectUri?: string;
  clientIdKeys?: string[];
  clientSecretKeys?: string[];
}): UserOperationalIdentityOAuthAdapterConfig | null {
  const prefix = `OPENBOT_USER_OPERATIONAL_IDENTITY_${params.envPrefix}`;
  const clientIdKeys = params.clientIdKeys ?? ["CLIENT_ID", "APP_ID", "APP_KEY", "CLIENT_KEY"];
  const clientSecretKeys = params.clientSecretKeys ?? [
    "CLIENT_SECRET",
    "APP_SECRET",
    "CLIENT_SECRET",
  ];
  let clientId = "";
  for (const key of clientIdKeys) {
    clientId = process.env[`${prefix}_${key}`]?.trim() ?? "";
    if (clientId) {
      break;
    }
  }
  let clientSecret = "";
  for (const key of clientSecretKeys) {
    clientSecret = process.env[`${prefix}_${key}`]?.trim() ?? "";
    if (clientSecret) {
      break;
    }
  }
  const redirectUri =
    params.redirectUri?.trim() || process.env[`${prefix}_REDIRECT_URI`]?.trim() || "";
  if (!clientId || !clientSecret || !redirectUri) {
    return null;
  }
  return { clientId, clientSecret, redirectUri };
}

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }
  return (await response.json()) as T;
}

export async function fetchAccountLabelFromBearer(params: {
  url: string;
  accessToken: string;
  userAgent?: string;
  pickLabel: (payload: Record<string, unknown>) => string | undefined;
}): Promise<string | undefined> {
  try {
    const payload = await fetchJson<Record<string, unknown>>(params.url, {
      headers: {
        Authorization: `Bearer ${params.accessToken}`,
        Accept: "application/json",
        ...(params.userAgent ? { "User-Agent": params.userAgent } : {}),
      },
    });
    return params.pickLabel(payload);
  } catch {
    return undefined;
  }
}

export { fetchJson };
