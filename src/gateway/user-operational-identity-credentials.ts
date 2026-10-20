import { randomUUID } from "node:crypto";
import { BUILTIN_STEWARD_AGENT_ID } from "../agents/builtin-steward/identity.js";
import {
  getUserOperationalIdentityManualKind,
  getUserOperationalIdentityProviderAdapter,
  isUserOperationalIdentityProviderManualAuth,
  isUserOperationalIdentityProviderQrChannelAuth,
  isUserOperationalIdentityProviderRegistrationReady,
  parseUserOperationalIdentityProvider,
} from "./user-operational-identity-providers.js";
import { listUserOperationalIdentityProviderCatalog } from "./user-operational-identity-providers.js";
import { withUserOperationalIdentityCredentialSecretStoreWriteLock } from "./user-operational-identity-secrets-persistence.js";
import { loadUserOperationalIdentityCredentialSecretForHandle } from "./user-operational-identity-secrets.js";
import {
  buildPersonalEmailCredentialSecret,
  buildPersonalEmailSmtpConfig,
  probeUserOperationalIdentityImapCredentials,
  probeUserOperationalIdentitySmtpCredentials,
  resolveUserOperationalIdentitySmtpConfig,
  type UserOperationalIdentitySmtpBindInput,
} from "./user-operational-identity-smtp.js";
import {
  getUserOperationalIdentity,
  registerUserOperationalIdentity,
  registerUserOperationalIdentityCredentialHandleFromOAuth,
  rotateUserOperationalIdentityCredential,
  upsertUserOperationalIdentityGrant,
} from "./user-operational-identity-store.js";
import type {
  UserOperationalIdentity,
  UserOperationalIdentityCredentialSecret,
  UserOperationalIdentityProvider,
  UserOperationalIdentityStore,
} from "./user-operational-identity-types.js";
import {
  isValidWechatOfficialAppId,
  normalizeWechatOfficialAppId,
  persistWechatOfficialAppSecretToEnv,
  probeWechatOfficialCredentials,
  readWechatOfficialAppSecretFromEnv,
  shouldSkipWechatOfficialCredentialProbe,
} from "./wechat-official/index.js";

export {
  isValidWechatOfficialAppId,
  normalizeWechatOfficialAppId,
  probeWechatOfficialCredentials,
  shouldSkipWechatOfficialCredentialProbe,
} from "./wechat-official/index.js";

function buildWechatOfficialCredentialSecret(params: {
  handleId: string;
  ownerId: string;
  appId: string;
  appSecret: string;
  displayName?: string;
  nowIso: string;
}): UserOperationalIdentityCredentialSecret {
  return {
    handleId: params.handleId,
    ownerId: params.ownerId,
    provider: "wechat-official",
    kind: "wechat_oa",
    accessToken: params.appSecret,
    accountLabel: params.displayName?.trim() || params.appId,
    metadata: {
      appId: params.appId,
      secretSource: "enterprise_aligned_env",
    },
    createdAt: params.nowIso,
    updatedAt: params.nowIso,
  };
}

function buildSocialAccountCredentialSecret(params: {
  handleId: string;
  ownerId: string;
  provider: UserOperationalIdentityProvider;
  accountHandle: string;
  accessToken: string;
  displayName?: string;
  nowIso: string;
}): UserOperationalIdentityCredentialSecret {
  return {
    handleId: params.handleId,
    ownerId: params.ownerId,
    provider: params.provider,
    kind: "social_account",
    accessToken: params.accessToken,
    accountLabel: params.displayName?.trim() || params.accountHandle,
    metadata: {
      accountHandle: params.accountHandle,
    },
    createdAt: params.nowIso,
    updatedAt: params.nowIso,
  };
}

async function persistManualIdentity(params: {
  store: UserOperationalIdentityStore;
  ownerId: string;
  provider: UserOperationalIdentityProvider;
  displayName: string;
  externalAccountId: string;
  identityId?: string;
  nowIso: string;
  buildSecret: (handleId: string) => UserOperationalIdentityCredentialSecret;
}): Promise<
  | { ok: true; identity: UserOperationalIdentity; credentialHandleId: string }
  | { ok: false; code: string; error: string }
> {
  const handleId = randomUUID();
  const identityId = params.identityId?.trim() || undefined;
  let identity: UserOperationalIdentity;

  if (identityId) {
    const existing = getUserOperationalIdentity(params.store, params.ownerId, identityId);
    if (!existing || existing.revokedAt) {
      return { ok: false, code: "USER_IDENTITY_NOT_FOUND", error: "Identity not found." };
    }
    if (existing.provider !== params.provider) {
      return {
        ok: false,
        code: "USER_IDENTITY_PROVIDER_MISMATCH",
        error: "Identity provider does not match credential provider.",
      };
    }
    const rotated = rotateUserOperationalIdentityCredential({
      store: params.store,
      ownerId: params.ownerId,
      identityId,
      credentialHandleId: handleId,
      oauthSessionId: `manual:${handleId}`,
      nowIso: params.nowIso,
    });
    if (!rotated.ok) {
      return rotated;
    }
    rotated.identity.displayName = params.displayName;
    rotated.identity.externalAccountId = params.externalAccountId;
    rotated.identity.updatedAt = params.nowIso;
    rotated.identity.lastVerifiedAt = params.nowIso;
    if (params.store.credentialHandles[handleId]) {
      params.store.credentialHandles[handleId].label =
        params.displayName || params.externalAccountId;
    }
    identity = rotated.identity;
  } else {
    const credential = registerUserOperationalIdentityCredentialHandleFromOAuth({
      store: params.store,
      ownerId: params.ownerId,
      provider: params.provider,
      credentialHandleId: handleId,
      oauthSessionId: `manual:${handleId}`,
      label: params.displayName || params.externalAccountId,
      nowIso: params.nowIso,
    });
    if (!credential.ok) {
      return credential;
    }
    const registered = registerUserOperationalIdentity({
      store: params.store,
      ownerId: params.ownerId,
      displayName: params.displayName,
      provider: params.provider,
      credentialHandleId: handleId,
      externalAccountId: params.externalAccountId,
      nowIso: params.nowIso,
      skipPlaceholderSecret: true,
      credentialVerified: true,
    });
    if (!registered.ok) {
      return registered;
    }
    identity = registered.identity;
  }

  await withUserOperationalIdentityCredentialSecretStoreWriteLock((secretStore) => {
    secretStore.secrets[handleId] = params.buildSecret(handleId);
    return secretStore;
  });

  return { ok: true, identity, credentialHandleId: handleId };
}

function listPersonalEmailAllowedActions(): string[] {
  const entry = listUserOperationalIdentityProviderCatalog().find(
    (item) => item.provider === "personal-email",
  );
  return (
    entry?.operationalActions.map((action) => action.action) ?? [
      "verify_credentials",
      "sync_inbox",
      "read_email",
      "search_email",
      "send_email",
      "reply_email",
    ]
  );
}

async function grantPersonalEmailToBuiltinSteward(params: {
  store: UserOperationalIdentityStore;
  ownerId: string;
  identityId: string;
  nowIso: string;
}): Promise<string | null> {
  try {
    const agentId = BUILTIN_STEWARD_AGENT_ID;
    upsertUserOperationalIdentityGrant({
      store: params.store,
      ownerId: params.ownerId,
      identityId: params.identityId,
      agentId,
      agentScope: "owned",
      grantMode: "auto",
      allowedActions: listPersonalEmailAllowedActions(),
      nowIso: params.nowIso,
    });
    return agentId;
  } catch {
    return null;
  }
}

export async function bindUserOperationalIdentityManualCredentials(params: {
  store: UserOperationalIdentityStore;
  ownerId: string;
  provider: string;
  displayName: string;
  appId?: string;
  appSecret?: string;
  accountHandle?: string;
  accessToken?: string;
  identityId?: string;
  smtp?: UserOperationalIdentitySmtpBindInput;
  nowIso: string;
  fetchImpl?: typeof fetch;
}): Promise<
  | {
      ok: true;
      identity: UserOperationalIdentity;
      credentialHandleId: string;
      grantedAgentId?: string;
    }
  | { ok: false; code: string; error: string }
> {
  const provider = parseUserOperationalIdentityProvider(params.provider);
  if (!provider) {
    return { ok: false, code: "USER_IDENTITY_PROVIDER_INVALID", error: "provider is invalid." };
  }
  if (!isUserOperationalIdentityProviderRegistrationReady(provider)) {
    const adapter = getUserOperationalIdentityProviderAdapter(provider);
    return {
      ok: false,
      code: "USER_IDENTITY_PROVIDER_NOT_READY",
      error: adapter?.degradedHint ?? "This provider is not available for binding yet.",
    };
  }
  if (isUserOperationalIdentityProviderQrChannelAuth(provider)) {
    return {
      ok: false,
      code: "USER_IDENTITY_QR_CHANNEL_REQUIRED",
      error:
        "Use user-operational-identity.wechat-personal.qr.start for WeChat personal QR binding.",
    };
  }
  if (!isUserOperationalIdentityProviderManualAuth(provider)) {
    return {
      ok: false,
      code: "USER_IDENTITY_OAUTH_REQUIRED",
      error: "Use user-operational-identity.oauth.start to bind credentials for this provider.",
    };
  }

  const displayName = params.displayName.trim();
  if (!displayName) {
    return {
      ok: false,
      code: "USER_IDENTITY_DISPLAY_NAME_REQUIRED",
      error: "displayName is required.",
    };
  }

  const manualKind = getUserOperationalIdentityManualKind(provider);
  if (manualKind === "wechat_oa") {
    const appId = normalizeWechatOfficialAppId(params.appId ?? "");
    const appSecret = (params.appSecret ?? "").trim();
    if (!isValidWechatOfficialAppId(appId)) {
      return {
        ok: false,
        code: "USER_IDENTITY_WECHAT_OA_APPID_INVALID",
        error: "AppID 格式无效，应以 wx 开头。",
      };
    }
    if (!appSecret) {
      return {
        ok: false,
        code: "USER_IDENTITY_WECHAT_OA_SECRET_REQUIRED",
        error: "AppSecret 不能为空。",
      };
    }
    const probe = await probeWechatOfficialCredentials({
      appId,
      appSecret,
      fetchImpl: params.fetchImpl,
    });
    if (!probe.ok) {
      return probe;
    }
    // Align with enterprise seed: AppSecret lives in ~/.openbot/.env as
    // WECHAT_OFFICIAL_{APPID}_APPSECRET; AppID is identity.externalAccountId.
    const envWrite = persistWechatOfficialAppSecretToEnv({ appId, appSecret });
    if (!envWrite.ok) {
      return {
        ok: false,
        code: "USER_IDENTITY_WECHAT_OA_ENV_PERSIST_FAILED",
        error: envWrite.error,
      };
    }
    return persistManualIdentity({
      store: params.store,
      ownerId: params.ownerId,
      provider,
      displayName,
      externalAccountId: appId,
      identityId: params.identityId,
      nowIso: params.nowIso,
      buildSecret: (handleId) =>
        buildWechatOfficialCredentialSecret({
          handleId,
          ownerId: params.ownerId,
          appId,
          appSecret,
          displayName,
          nowIso: params.nowIso,
        }),
    });
  }

  if (manualKind === "social_account") {
    const accountHandle = (params.accountHandle ?? "").trim();
    const accessToken = (params.accessToken ?? "").trim();
    if (!accountHandle) {
      return {
        ok: false,
        code: "USER_IDENTITY_ACCOUNT_HANDLE_REQUIRED",
        error: "账号标识不能为空（用户名 / UID / 主页链接）。",
      };
    }
    if (!accessToken) {
      return {
        ok: false,
        code: "USER_IDENTITY_SOCIAL_TOKEN_REQUIRED",
        error: "访问凭证不能为空（Access Token / Cookie / 开放平台密钥）。",
      };
    }
    // Xiaohongshu + xiaohongshu-mcp: probe cookie sync at bind time so users
    // learn immediately if the sidecar is down or cookies are invalid.
    if (provider === "xiaohongshu") {
      const {
        resolveXiaohongshuApiBase,
        resolveXiaohongshuConnectorKind,
        syncXiaohongshuMcpCookies,
      } = await import("./user-operational-identity-xiaohongshu-connector.js");
      const base = resolveXiaohongshuApiBase();
      const connector = resolveXiaohongshuConnectorKind(base);
      if (connector === "xiaohongshu-mcp") {
        if (!base) {
          return {
            ok: false,
            code: "USER_IDENTITY_XHS_CONNECTOR_MISSING",
            error: "未配置 OPENBOT_XIAOHONGSHU_API_BASE（xiaohongshu-mcp 地址）。",
          };
        }
        const synced = await syncXiaohongshuMcpCookies({
          base,
          cookieOrToken: accessToken,
          fetchImpl: params.fetchImpl,
        });
        if (!synced.ok) {
          return {
            ok: false,
            code: "USER_IDENTITY_XHS_COOKIE_SYNC_FAILED",
            error: `小红书 Cookie 同步失败：${synced.error}`,
          };
        }
      }
    }
    return persistManualIdentity({
      store: params.store,
      ownerId: params.ownerId,
      provider,
      displayName,
      externalAccountId: accountHandle,
      identityId: params.identityId,
      nowIso: params.nowIso,
      buildSecret: (handleId) =>
        buildSocialAccountCredentialSecret({
          handleId,
          ownerId: params.ownerId,
          provider,
          accountHandle,
          accessToken,
          displayName,
          nowIso: params.nowIso,
        }),
    });
  }

  if (manualKind === "smtp") {
    const smtpInput: UserOperationalIdentitySmtpBindInput = {
      from: params.smtp?.from?.trim() || params.accountHandle?.trim() || "",
      host: params.smtp?.host,
      port: params.smtp?.port,
      user: params.smtp?.user,
      pass: params.smtp?.pass ?? params.accessToken ?? params.appSecret,
      secure: params.smtp?.secure,
      startTls: params.smtp?.startTls,
      replyTo: params.smtp?.replyTo,
      imapHost: params.smtp?.imapHost,
      imapPort: params.smtp?.imapPort,
      imapUser: params.smtp?.imapUser,
      usePlatformSmtp: params.smtp?.usePlatformSmtp,
    };
    const built = buildPersonalEmailSmtpConfig(smtpInput);
    if (!built.ok) {
      return built;
    }
    if (!smtpInput.usePlatformSmtp && !built.imap) {
      return {
        ok: false,
        code: "USER_IDENTITY_IMAP_HOST_REQUIRED",
        error: "查收/回复邮件需要 IMAP；请填写 IMAP 主机或使用已知邮箱域名以便自动填充。",
      };
    }
    const probe = await probeUserOperationalIdentitySmtpCredentials({ config: built.config });
    if (!probe.ok) {
      return probe;
    }
    const personalEmail = smtpInput.from;
    const draftSecret = buildPersonalEmailCredentialSecret({
      handleId: "probe",
      ownerId: params.ownerId,
      displayName,
      personalEmail,
      config: built.config,
      source: built.source,
      imap: built.imap,
      nowIso: params.nowIso,
    });
    if (built.imap) {
      const imapProbe = await probeUserOperationalIdentityImapCredentials({ secret: draftSecret });
      if (!imapProbe.ok) {
        return imapProbe;
      }
    }
    const bound = await persistManualIdentity({
      store: params.store,
      ownerId: params.ownerId,
      provider,
      displayName,
      // Keep the user's mailbox as the identity handle even when envelope FROM
      // is the platform SMTP address (platform_env).
      externalAccountId: personalEmail,
      identityId: params.identityId,
      nowIso: params.nowIso,
      buildSecret: (handleId) =>
        buildPersonalEmailCredentialSecret({
          handleId,
          ownerId: params.ownerId,
          displayName,
          personalEmail,
          config: built.config,
          source: built.source,
          imap: built.imap,
          nowIso: params.nowIso,
        }),
    });
    if (!bound.ok) {
      return bound;
    }
    const grantedAgentId = await grantPersonalEmailToBuiltinSteward({
      store: params.store,
      ownerId: params.ownerId,
      identityId: bound.identity.identityId,
      nowIso: params.nowIso,
    });
    return {
      ...bound,
      ...(grantedAgentId ? { grantedAgentId } : {}),
    };
  }

  return {
    ok: false,
    code: "USER_IDENTITY_MANUAL_PROVIDER_UNSUPPORTED",
    error: "Manual credential binding is not supported for this provider.",
  };
}

export function resolveWechatOfficialAppSecretForIdentity(params: {
  appId: string;
  secretAccessToken?: string;
}): string | null {
  const fromStore = params.secretAccessToken?.trim();
  if (fromStore) {
    return fromStore;
  }
  return readWechatOfficialAppSecretFromEnv({ appId: params.appId });
}

export async function verifyUserOperationalIdentityWechatOfficialCredentials(params: {
  store: UserOperationalIdentityStore;
  ownerId: string;
  identityId: string;
  nowIso: string;
  fetchImpl?: typeof fetch;
}): Promise<
  | { ok: true; identity: UserOperationalIdentity; appId: string }
  | { ok: false; code: string; error: string }
> {
  const identity = getUserOperationalIdentity(params.store, params.ownerId, params.identityId);
  if (!identity || identity.revokedAt) {
    return { ok: false, code: "USER_IDENTITY_NOT_FOUND", error: "Identity not found." };
  }
  if (identity.provider !== "wechat-official") {
    return {
      ok: false,
      code: "USER_IDENTITY_PROVIDER_MISMATCH",
      error: "Only WeChat Official Account identities support credential verify.",
    };
  }
  const secret = await loadUserOperationalIdentityCredentialSecretForHandle({
    handleId: identity.credentialHandleId,
    ownerId: params.ownerId,
  });
  const appId = secret?.metadata?.appId?.trim() || identity.externalAccountId?.trim() || "";
  if (!appId) {
    return {
      ok: false,
      code: "USER_IDENTITY_WECHAT_OA_APPID_INVALID",
      error: "AppID 缺失，请重新绑定公众号。",
    };
  }
  // Align with enterprise: fall back to WECHAT_OFFICIAL_{APPID}_APPSECRET env.
  const appSecret = resolveWechatOfficialAppSecretForIdentity({
    appId,
    secretAccessToken: secret?.kind === "wechat_oa" ? secret.accessToken : undefined,
  });
  if (!appSecret) {
    return {
      ok: false,
      code: "USER_IDENTITY_CREDENTIAL_SECRET_MISSING",
      error: "公众号凭证缺失，请重新绑定 AppSecret（与企业端同一 env 约定）。",
    };
  }
  const probe = await probeWechatOfficialCredentials({
    appId,
    appSecret,
    fetchImpl: params.fetchImpl,
  });
  if (!probe.ok) {
    return probe;
  }
  markIdentityCredentialsVerified(identity, params.store, params.nowIso);
  return { ok: true, identity, appId };
}

function markIdentityCredentialsVerified(
  identity: UserOperationalIdentity,
  store: UserOperationalIdentityStore,
  nowIso: string,
): void {
  identity.status = "active";
  identity.lastVerifiedAt = nowIso;
  identity.updatedAt = nowIso;
  const handle = store.credentialHandles[identity.credentialHandleId];
  if (handle) {
    handle.lastVerifiedAt = nowIso;
    handle.secretVerifiedAt = nowIso;
    handle.updatedAt = nowIso;
  }
}

export async function verifyUserOperationalIdentityPersonalEmailCredentials(params: {
  store: UserOperationalIdentityStore;
  ownerId: string;
  identityId: string;
  nowIso: string;
}): Promise<
  | { ok: true; identity: UserOperationalIdentity; from: string }
  | { ok: false; code: string; error: string }
> {
  const identity = getUserOperationalIdentity(params.store, params.ownerId, params.identityId);
  if (!identity || identity.revokedAt) {
    return { ok: false, code: "USER_IDENTITY_NOT_FOUND", error: "Identity not found." };
  }
  if (identity.provider !== "personal-email") {
    return {
      ok: false,
      code: "USER_IDENTITY_PROVIDER_MISMATCH",
      error: "Only personal-email identities support SMTP credential verify.",
    };
  }
  const secret = await loadUserOperationalIdentityCredentialSecretForHandle({
    handleId: identity.credentialHandleId,
    ownerId: params.ownerId,
  });
  if (!secret || secret.kind !== "smtp") {
    return {
      ok: false,
      code: "USER_IDENTITY_CREDENTIAL_SECRET_MISSING",
      error: "个人邮箱 SMTP 凭证缺失，请重新绑定。",
    };
  }
  const config = resolveUserOperationalIdentitySmtpConfig(secret);
  if (!config) {
    return {
      ok: false,
      code: "USER_IDENTITY_SMTP_CONFIG_INVALID",
      error: "个人邮箱 SMTP 配置不完整，请重新绑定。",
    };
  }
  const probe = await probeUserOperationalIdentitySmtpCredentials({ config });
  if (!probe.ok) {
    return probe;
  }
  markIdentityCredentialsVerified(identity, params.store, params.nowIso);
  return { ok: true, identity, from: config.from };
}

export async function verifyUserOperationalIdentityCredentials(params: {
  store: UserOperationalIdentityStore;
  ownerId: string;
  identityId: string;
  nowIso: string;
  fetchImpl?: typeof fetch;
}): Promise<
  | { ok: true; identity: UserOperationalIdentity; provider: UserOperationalIdentityProvider }
  | { ok: false; code: string; error: string }
> {
  const identity = getUserOperationalIdentity(params.store, params.ownerId, params.identityId);
  if (!identity || identity.revokedAt) {
    return { ok: false, code: "USER_IDENTITY_NOT_FOUND", error: "Identity not found." };
  }
  if (identity.provider === "wechat-official") {
    const result = await verifyUserOperationalIdentityWechatOfficialCredentials(params);
    return result.ok
      ? { ok: true, identity: result.identity, provider: "wechat-official" }
      : result;
  }
  if (identity.provider === "personal-email") {
    const result = await verifyUserOperationalIdentityPersonalEmailCredentials(params);
    return result.ok ? { ok: true, identity: result.identity, provider: "personal-email" } : result;
  }
  return {
    ok: false,
    code: "USER_IDENTITY_VERIFY_UNSUPPORTED",
    error: "该身份类型暂不支持凭证验证。",
  };
}
