/**
 * Map enterprise runtimeModelId → upstream provider/model + credential for a single run.
 */

import { isEnterpriseRuntimeModelId } from "./ids.js";
import {
  resolveTenantModelRuntimeConfig,
  type TenantModelRuntimeConfig,
} from "./runtime-resolve.js";

export type EnterpriseRuntimeInvocation = {
  runtimeModelId: string;
  provider: string;
  model: string;
  apiKey: string;
  baseUrl?: string;
  protocol: string;
  billingOwner: "enterprise";
  source: "enterprise";
  tenantId: string;
};

function mapProviderTypeToProviderId(
  providerType: string,
  upstreamModelId: string,
): { provider: string; model: string } {
  const trimmed = upstreamModelId.trim();
  if (trimmed.includes("/")) {
    const idx = trimmed.indexOf("/");
    return { provider: trimmed.slice(0, idx), model: trimmed.slice(idx + 1) };
  }
  switch (providerType) {
    case "anthropic":
      return { provider: "anthropic", model: trimmed };
    case "openai":
      return { provider: "openai", model: trimmed };
    case "openai-compatible":
    case "custom":
    default:
      // OpenAI-compatible custom endpoints: reuse openai client with baseUrl override.
      return { provider: "openai", model: trimmed };
  }
}

export async function resolveEnterpriseRuntimeInvocation(params: {
  tenantId: string;
  /** Either full runtimeModelId or provider/model split from fallback candidates. */
  provider: string;
  model: string;
  connectionStorePath?: string;
  assetStorePath?: string;
  vaultPath?: string;
}): Promise<EnterpriseRuntimeInvocation | null> {
  const runtimeModelId = `${params.provider}/${params.model}`.replace(/\/+/g, "/");
  if (!isEnterpriseRuntimeModelId(runtimeModelId)) {
    return null;
  }
  const cfg: TenantModelRuntimeConfig | null = await resolveTenantModelRuntimeConfig({
    tenantId: params.tenantId,
    runtimeModelId,
    ...(params.connectionStorePath ? { connectionStorePath: params.connectionStorePath } : {}),
    ...(params.assetStorePath ? { assetStorePath: params.assetStorePath } : {}),
    ...(params.vaultPath ? { vaultPath: params.vaultPath } : {}),
  });
  if (!cfg) {
    return null;
  }
  const mapped = mapProviderTypeToProviderId(cfg.providerType, cfg.upstreamModelId);
  return {
    runtimeModelId,
    provider: mapped.provider,
    model: mapped.model,
    apiKey: cfg.apiKey,
    ...(cfg.baseUrl ? { baseUrl: cfg.baseUrl } : {}),
    protocol: cfg.protocol,
    billingOwner: "enterprise",
    source: "enterprise",
    tenantId: cfg.tenantId,
  };
}
