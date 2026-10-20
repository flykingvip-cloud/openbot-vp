import {
  resolveBilibiliOpenClientConfig,
  verifyBilibiliAccessToken,
} from "../enterprise-operational-identity-bilibili-api.js";
import { verifyDouyinAccessToken } from "../enterprise-operational-identity-douyin-api.js";
import type { EnterpriseOperationalIdentityCredentialSecret } from "../enterprise-operational-identity-oauth/credential-secrets-persistence.js";
import { fetchWechatAuthorizerProfile } from "../enterprise-operational-identity-oauth/wechat-component.js";
import type { EnterpriseOperationalIdentityProvider } from "../enterprise-operational-identity-types.js";
import { fetchWechatOfficialAccountBasicInfo } from "../enterprise-operational-identity-wechat-official-api.js";
import { resolveWechatOfficialAuthMode } from "../enterprise-operational-identity-wechat-official-credential.js";
import { verifyWeiboAccessToken } from "../enterprise-operational-identity-weibo-api.js";
import { getOperationalIdentityProviderAdapter } from "./adapters.js";
import type { OperationalIdentityCredentialProbeResult } from "./credential-probe.js";
import { enrichOperationalIdentityCapabilities } from "./provider-capability-registry.js";

function finalizeDiscovery(
  provider: EnterpriseOperationalIdentityProvider,
  discovery: Omit<OperationalIdentityCapabilityDiscovery, "capabilityDetails">,
): OperationalIdentityCapabilityDiscovery {
  return {
    ...discovery,
    capabilityDetails: enrichOperationalIdentityCapabilities({
      provider,
      granted: discovery.capabilities,
      missing: discovery.missing,
    }),
  };
}

export type OperationalIdentityCapabilityDiscovery = {
  capabilities: string[];
  missing: string[];
  metadata?: Record<string, string>;
  discoveredAt: string;
  capabilityDetails?: Array<{
    action: string;
    label: string;
    risk: "low" | "medium" | "high";
    enabled: boolean;
    alias?: string;
  }>;
};

export async function discoverOperationalIdentityCapabilities(params: {
  provider: EnterpriseOperationalIdentityProvider;
  secret: EnterpriseOperationalIdentityCredentialSecret | null;
  externalAccountId?: string;
  probeResults?: Record<string, OperationalIdentityCredentialProbeResult>;
  nowIso: string;
}): Promise<OperationalIdentityCapabilityDiscovery> {
  const adapter = getOperationalIdentityProviderAdapter(params.provider);
  const declaredOperational = adapter.actions
    .filter((entry) => entry.kind === "operational")
    .map((entry) => entry.action);

  if (params.provider === "wechat-official") {
    return discoverWechatOfficialCapabilities(params, declaredOperational);
  }
  if (params.provider === "weibo") {
    return discoverWeiboCapabilities(params, declaredOperational);
  }
  if (params.provider === "douyin") {
    return discoverDouyinCapabilities(params, declaredOperational);
  }
  if (params.provider === "bilibili") {
    return discoverBilibiliCapabilities(params, declaredOperational);
  }
  if (params.provider === "tencent-meeting") {
    return discoverTencentMeetingCapabilities(params, declaredOperational);
  }

  const capabilities: string[] = [];
  const missing: string[] = [];
  const tokenOk =
    params.probeResults?.oauth_token?.ok ?? params.probeResults?.client_credential?.ok;
  if (tokenOk) {
    capabilities.push(...declaredOperational);
  } else {
    missing.push(...declaredOperational);
  }
  return finalizeDiscovery(params.provider, {
    capabilities,
    missing,
    discoveredAt: params.nowIso,
  });
}

async function discoverWechatOfficialCapabilities(
  params: {
    secret: EnterpriseOperationalIdentityCredentialSecret | null;
    externalAccountId?: string;
    probeResults?: Record<string, OperationalIdentityCredentialProbeResult>;
    nowIso: string;
  },
  declaredOperational: string[],
): Promise<OperationalIdentityCapabilityDiscovery> {
  const capabilities: string[] = [];
  const missing: string[] = [];
  const appId =
    params.externalAccountId?.trim() ||
    params.secret?.externalAccountId?.trim() ||
    params.secret?.metadata?.appId?.trim() ||
    "";
  const tokenOk =
    params.probeResults?.client_credential?.ok === true ||
    params.probeResults?.authorizer_token?.ok === true;

  const metadata: Record<string, string> = {};
  if (appId) {
    metadata.authorizerAppId = appId;
  }

  if (tokenOk && appId && params.secret?.accessToken?.trim()) {
    const authMode = resolveWechatOfficialAuthMode(params.secret);
    const profile =
      authMode === "client_credential"
        ? await fetchWechatOfficialAccountBasicInfo({
            accessToken: params.secret.accessToken.trim(),
          })
        : await fetchWechatAuthorizerProfile({
            authorizerAppId: appId,
            authorizerAccessToken: params.secret.accessToken.trim(),
          });
    if (profile.ok) {
      if (profile.nickName) {
        metadata.nickName = profile.nickName;
      }
      if (profile.principalName) {
        metadata.principalName = profile.principalName;
      }
      if ("verifyType" in profile && profile.verifyType) {
        metadata.verifyType = profile.verifyType;
      }
      if ("serviceType" in profile && profile.serviceType) {
        metadata.serviceType = profile.serviceType;
      }
      if ("accountType" in profile && profile.accountType) {
        metadata.accountType = profile.accountType;
      }
      if (authMode === "client_credential") {
        metadata.authMode = "client_credential";
      }
      if (declaredOperational.includes("publish_draft")) {
        capabilities.push("publish_draft");
      }
      if (declaredOperational.includes("upload_thumb")) {
        capabilities.push("upload_thumb");
      }
      if (declaredOperational.includes("upload_content_image")) {
        capabilities.push("upload_content_image");
      }
      if (declaredOperational.includes("get_publish_status")) {
        capabilities.push("get_publish_status");
      }
      if (declaredOperational.includes("publish_article")) {
        capabilities.push("publish_article");
      }
      if (profile.canBroadcast && declaredOperational.includes("broadcast_article")) {
        capabilities.push("broadcast_article");
      } else if (declaredOperational.includes("broadcast_article")) {
        missing.push("broadcast_article");
      }
    } else {
      for (const action of declaredOperational) {
        missing.push(action);
      }
      metadata.discoveryError = profile.error;
    }
  } else {
    for (const action of declaredOperational) {
      missing.push(action);
    }
  }

  return finalizeDiscovery("wechat-official", {
    capabilities,
    missing,
    ...(Object.keys(metadata).length > 0 ? { metadata } : {}),
    discoveredAt: params.nowIso,
  });
}

async function discoverWeiboCapabilities(
  params: {
    secret: EnterpriseOperationalIdentityCredentialSecret | null;
    externalAccountId?: string;
    probeResults?: Record<string, OperationalIdentityCredentialProbeResult>;
    nowIso: string;
  },
  declaredOperational: string[],
): Promise<OperationalIdentityCapabilityDiscovery> {
  const capabilities: string[] = [];
  const missing: string[] = [];
  const metadata: Record<string, string> = {};
  const tokenOk = params.probeResults?.oauth_token?.ok === true;
  const accessToken = params.secret?.accessToken?.trim();

  if (tokenOk && accessToken) {
    try {
      const verified = await verifyWeiboAccessToken({ accessToken });
      if (verified.uid) {
        metadata.weiboUid = verified.uid;
      }
      if (verified.screenName) {
        metadata.screenName = verified.screenName;
      }
      for (const action of declaredOperational) {
        capabilities.push(action);
      }
    } catch (error) {
      for (const action of declaredOperational) {
        missing.push(action);
      }
      metadata.discoveryError =
        error instanceof Error ? error.message : "Weibo capability discovery failed.";
    }
  } else {
    for (const action of declaredOperational) {
      missing.push(action);
    }
  }

  return finalizeDiscovery("weibo", {
    capabilities,
    missing,
    ...(Object.keys(metadata).length > 0 ? { metadata } : {}),
    discoveredAt: params.nowIso,
  });
}

async function discoverDouyinCapabilities(
  params: {
    secret: EnterpriseOperationalIdentityCredentialSecret | null;
    externalAccountId?: string;
    probeResults?: Record<string, OperationalIdentityCredentialProbeResult>;
    nowIso: string;
  },
  declaredOperational: string[],
): Promise<OperationalIdentityCapabilityDiscovery> {
  const capabilities: string[] = [];
  const missing: string[] = [];
  const metadata: Record<string, string> = {};
  const tokenOk = params.probeResults?.oauth_token?.ok === true;
  const accessToken = params.secret?.accessToken?.trim();
  const openId = params.externalAccountId?.trim() || params.secret?.externalAccountId?.trim() || "";

  if (tokenOk && accessToken && openId) {
    try {
      const verified = await verifyDouyinAccessToken({ accessToken, openId });
      if (verified.openId) {
        metadata.douyinOpenId = verified.openId;
      }
      if (verified.nickname) {
        metadata.nickname = verified.nickname;
      }
      for (const action of declaredOperational) {
        capabilities.push(action);
      }
    } catch (error) {
      for (const action of declaredOperational) {
        missing.push(action);
      }
      metadata.discoveryError =
        error instanceof Error ? error.message : "Douyin capability discovery failed.";
    }
  } else {
    for (const action of declaredOperational) {
      missing.push(action);
    }
  }

  return finalizeDiscovery("douyin", {
    capabilities,
    missing,
    ...(Object.keys(metadata).length > 0 ? { metadata } : {}),
    discoveredAt: params.nowIso,
  });
}

async function discoverBilibiliCapabilities(
  params: {
    secret: EnterpriseOperationalIdentityCredentialSecret | null;
    probeResults?: Record<string, OperationalIdentityCredentialProbeResult>;
    nowIso: string;
  },
  declaredOperational: string[],
): Promise<OperationalIdentityCapabilityDiscovery> {
  const capabilities: string[] = [];
  const missing: string[] = [];
  const metadata: Record<string, string> = {};
  const tokenOk = params.probeResults?.oauth_token?.ok === true;
  const accessToken = params.secret?.accessToken?.trim();
  const client = resolveBilibiliOpenClientConfig();

  if (tokenOk && accessToken && client) {
    try {
      await verifyBilibiliAccessToken({ accessToken, clientId: client.clientId });
      for (const action of declaredOperational) {
        capabilities.push(action);
      }
    } catch (error) {
      for (const action of declaredOperational) {
        missing.push(action);
      }
      metadata.discoveryError =
        error instanceof Error ? error.message : "Bilibili capability discovery failed.";
    }
  } else {
    for (const action of declaredOperational) {
      missing.push(action);
    }
  }

  return finalizeDiscovery("bilibili", {
    capabilities,
    missing,
    ...(Object.keys(metadata).length > 0 ? { metadata } : {}),
    discoveredAt: params.nowIso,
  });
}

function discoverTencentMeetingCapabilities(
  params: {
    secret: EnterpriseOperationalIdentityCredentialSecret | null;
    externalAccountId?: string;
    probeResults?: Record<string, OperationalIdentityCredentialProbeResult>;
    nowIso: string;
  },
  declaredOperational: string[],
): OperationalIdentityCapabilityDiscovery {
  const capabilities: string[] = [];
  const missing: string[] = [];
  const metadata: Record<string, string> = {};
  const signatureOk =
    params.probeResults?.auth_ok?.ok === true || params.probeResults?.api_signature?.ok === true;
  const userId =
    params.externalAccountId?.trim() ||
    params.secret?.metadata?.defaultUserId?.trim() ||
    params.secret?.externalAccountId?.trim() ||
    "";

  if (signatureOk) {
    if (userId) {
      metadata.defaultUserId = userId;
    }
    if (params.secret?.metadata?.sdkId?.trim()) {
      metadata.sdkId = params.secret.metadata.sdkId.trim();
    }
    for (const action of declaredOperational) {
      capabilities.push(action);
    }
  } else {
    for (const action of declaredOperational) {
      missing.push(action);
    }
    if (params.probeResults?.api_signature?.detail) {
      metadata.discoveryError = params.probeResults.api_signature.detail;
    }
  }

  return finalizeDiscovery("tencent-meeting", {
    capabilities,
    missing,
    ...(Object.keys(metadata).length > 0 ? { metadata } : {}),
    discoveredAt: params.nowIso,
  });
}
