import { randomUUID } from "node:crypto";
import { registerEnterpriseIdentity } from "../enterprise-operational-identity-store.js";
import {
  loadEnterpriseSeatAssetsStore,
  registerConnectorCredentialBinding,
  saveEnterpriseSeatAssetsStore,
} from "../enterprise-seat-assets-store.js";
import { resolveControlPlaneStorePathForTenantId } from "../tenant-context.js";
import { TENANT_SEAT_ASSETS_FILE } from "../tenant-store-paths.js";
import {
  buildUserOperationalIdentityPkcePair,
  getUserOperationalIdentityOAuthAdapter,
  resolveUserOperationalIdentityOAuthAdapterConfig,
} from "../user-operational-identity-oauth-adapters/index.js";
import { withEnterpriseOperationalIdentityCredentialSecretStoreWriteLock } from "./credential-secrets-persistence.js";
import type { EnterpriseSocialOAuthProviderSpec } from "./social-providers.js";
import {
  completeEnterpriseSocialOAuthSession,
  createEnterpriseSocialOAuthSession,
  expireEnterpriseSocialOAuthSessions,
  getEnterpriseSocialOAuthSessionByState,
} from "./social-sessions.js";

export function buildEnterpriseSocialOAuthCallbackPath(params: {
  routeBase: string;
  tenantId: string;
  providerSlug: string;
}): string {
  return `${params.routeBase}/${params.tenantId}/oauth/${params.providerSlug}/callback`;
}

export function startEnterpriseSocialOAuthSession(params: {
  tenantId: string;
  spec: EnterpriseSocialOAuthProviderSpec;
  routeBase: string;
  origin: string;
  seatId?: string;
  createdByEmployeeId?: string;
  displayName?: string;
  nowIso: string;
}):
  | {
      ok: true;
      sessionId: string;
      authorizeUrl: string;
      callbackUrl: string;
    }
  | { ok: false; code: string; error: string } {
  const callbackUrl = `${params.origin.replace(/\/+$/, "")}${buildEnterpriseSocialOAuthCallbackPath(
    {
      routeBase: params.routeBase,
      tenantId: params.tenantId,
      providerSlug: params.spec.slug,
    },
  )}`;
  const adapter = getUserOperationalIdentityOAuthAdapter(params.spec.userProvider);
  if (!adapter) {
    return {
      ok: false,
      code: "ENTERPRISE_SOCIAL_OAUTH_ADAPTER_MISSING",
      error: "OAuth adapter is unavailable for this provider.",
    };
  }
  const config = resolveUserOperationalIdentityOAuthAdapterConfig({
    provider: params.spec.userProvider,
    redirectUri: callbackUrl,
  });
  if (!config) {
    return {
      ok: false,
      code: "ENTERPRISE_SOCIAL_OAUTH_NOT_CONFIGURED",
      error: "OAuth env is not configured for this provider.",
    };
  }
  expireEnterpriseSocialOAuthSessions(params.nowIso);
  const pkce = adapter.requiresPkce ? buildUserOperationalIdentityPkcePair() : null;
  const session = createEnterpriseSocialOAuthSession({
    tenantId: params.tenantId,
    providerSlug: params.spec.slug,
    seatId: params.seatId,
    createdByEmployeeId: params.createdByEmployeeId,
    displayName: params.displayName,
    codeVerifier: pkce?.codeVerifier,
    nowIso: params.nowIso,
  });
  const authorizeUrl = adapter.buildAuthorizeUrl({
    config,
    state: session.state,
    codeChallenge: pkce?.codeChallenge,
  });
  return {
    ok: true,
    sessionId: session.sessionId,
    authorizeUrl,
    callbackUrl,
  };
}

export async function completeEnterpriseSocialOAuthCallback(params: {
  tenantId: string;
  spec: EnterpriseSocialOAuthProviderSpec;
  routeBase: string;
  origin: string;
  state: string;
  code: string;
  nowIso: string;
}): Promise<
  | {
      ok: true;
      identityId: string;
      externalAccountId: string;
      displayName: string;
      auditId: string;
    }
  | { ok: false; code: string; error: string }
> {
  expireEnterpriseSocialOAuthSessions(params.nowIso);
  const session = getEnterpriseSocialOAuthSessionByState(params.state);
  if (
    !session ||
    session.tenantId !== params.tenantId ||
    session.providerSlug !== params.spec.slug ||
    session.status !== "pending"
  ) {
    return {
      ok: false,
      code: "ENTERPRISE_SOCIAL_OAUTH_SESSION_INVALID",
      error: "OAuth session is invalid.",
    };
  }
  const redirectUri = `${params.origin.replace(/\/+$/, "")}${buildEnterpriseSocialOAuthCallbackPath(
    {
      routeBase: params.routeBase,
      tenantId: params.tenantId,
      providerSlug: params.spec.slug,
    },
  )}`;
  const adapter = getUserOperationalIdentityOAuthAdapter(params.spec.userProvider);
  if (!adapter) {
    return {
      ok: false,
      code: "ENTERPRISE_SOCIAL_OAUTH_ADAPTER_MISSING",
      error: "OAuth adapter is unavailable for this provider.",
    };
  }
  const config = adapter.resolveConfig({ redirectUri });
  if (!config) {
    return {
      ok: false,
      code: "ENTERPRISE_SOCIAL_OAUTH_NOT_CONFIGURED",
      error: "OAuth env is not configured for this provider.",
    };
  }
  try {
    const exchanged = await adapter.exchangeCode({
      config,
      code: params.code,
      codeVerifier: session.codeVerifier,
    });
    const externalAccountId =
      exchanged.externalAccountId?.trim() ||
      exchanged.accountLabel?.trim() ||
      `${params.spec.slug}-${randomUUID().slice(0, 8)}`;
    const displayName =
      session.displayName?.trim() ||
      exchanged.accountLabel?.trim() ||
      `${params.spec.label} ${externalAccountId}`;
    const storePath = resolveControlPlaneStorePathForTenantId(
      params.tenantId,
      TENANT_SEAT_ASSETS_FILE,
    );
    const seatStore = await loadEnterpriseSeatAssetsStore(storePath);
    const auditId = randomUUID();
    const ownerId = session.seatId?.trim() || session.createdByEmployeeId?.trim() || "social-oauth";
    const credential = registerConnectorCredentialBinding({
      store: seatStore,
      tenantId: params.tenantId,
      connectorId: params.spec.connectorId,
      ownerType: session.seatId ? "seat" : "employee",
      ownerId,
      nowIso: params.nowIso,
      createdBy: session.createdByEmployeeId,
      auditId,
      allowMultiple: true,
    });
    const identity = registerEnterpriseIdentity({
      store: seatStore,
      tenantId: params.tenantId,
      displayName,
      credentialBindingId: credential.credentialBindingId,
      externalAccountId,
      expiresAt: exchanged.expiresIn
        ? new Date(new Date(params.nowIso).getTime() + exchanged.expiresIn * 1000).toISOString()
        : undefined,
      nowIso: params.nowIso,
      auditId,
    });
    if (!identity.ok) {
      return identity;
    }
    await withEnterpriseOperationalIdentityCredentialSecretStoreWriteLock(async (secretStore) => {
      secretStore.secrets[credential.credentialBindingId] = {
        credentialBindingId: credential.credentialBindingId,
        tenantId: params.tenantId,
        connectorId: params.spec.connectorId,
        kind: "oauth_token",
        accessToken: exchanged.accessToken,
        refreshToken: exchanged.refreshToken,
        expiresAt: exchanged.expiresIn
          ? new Date(new Date(params.nowIso).getTime() + exchanged.expiresIn * 1000).toISOString()
          : undefined,
        accountLabel: exchanged.accountLabel,
        externalAccountId,
        scope: exchanged.scope,
        metadata: exchanged.metadata,
        createdAt: params.nowIso,
        updatedAt: params.nowIso,
      };
    });
    completeEnterpriseSocialOAuthSession({
      session,
      externalAccountId,
      credentialBindingId: credential.credentialBindingId,
      nowIso: params.nowIso,
    });
    await saveEnterpriseSeatAssetsStore(storePath, seatStore);
    return {
      ok: true,
      identityId: identity.identity.identityId,
      externalAccountId,
      displayName,
      auditId,
    };
  } catch (error) {
    return {
      ok: false,
      code: "ENTERPRISE_SOCIAL_OAUTH_EXCHANGE_FAILED",
      error: error instanceof Error ? error.message : "OAuth exchange failed.",
    };
  }
}

export function renderEnterpriseOAuthCallbackHtml(params: {
  ok: boolean;
  title: string;
  message: string;
}): string {
  const tone = params.ok ? "#0f766e" : "#b45309";
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${params.title}</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; margin: 0; background: #f8fafc; color: #0f172a; }
    main { max-width: 420px; margin: 12vh auto; padding: 24px; background: #fff; border-radius: 12px; box-shadow: 0 10px 30px rgba(15, 23, 42, 0.08); }
    h1 { font-size: 20px; margin: 0 0 12px; color: ${tone}; }
    p { margin: 0; line-height: 1.6; }
  </style>
</head>
<body>
  <main>
    <h1>${params.title}</h1>
    <p>${params.message}</p>
  </main>
  <script>
    if (${params.ok ? "true" : "false"}) {
      setTimeout(function () { window.close(); }, 2500);
    }
  </script>
</body>
</html>`;
}
