/**
 * Translate a selected model into the transport `runEmbeddedPiAgent` understands.
 *
 * Enterprise catalog ids (`ent/<connectionShort>/<upstream>`) are not registry
 * providers. Passing them through makes `resolveModel` throw
 * `Unknown model: ent/...` before any reply. Follow-up, cron, CLI, and the
 * main chat turn all go through this helper.
 */

import { isEnterpriseRuntimeModelId } from "./ids.js";
import { resolveEnterpriseRuntimeInvocation } from "./runtime-invocation.js";

export type EnterpriseEmbeddedProviderAuth = {
  apiKey: string;
  source: string;
  baseUrl?: string;
  protocol: string;
};

export type EnterpriseEmbeddedTransport = {
  provider: string;
  model: string;
  providerAuthOverride?: EnterpriseEmbeddedProviderAuth;
  enterpriseRuntimeModelId?: string;
};

export async function resolveEnterpriseEmbeddedTransport(params: {
  provider: string;
  model: string;
  /** Already-known managed tenant. Empty values fall through to `resolveTenantId`. */
  tenantId?: string | null;
  /**
   * Called only for an `ent/...` selection that still has no tenant id.
   * Typical source: the agent's seat binding.
   */
  resolveTenantId?: () => Promise<string | null | undefined>;
}): Promise<EnterpriseEmbeddedTransport> {
  const provider = params.provider;
  const model = params.model;
  const candidateRuntimeId = `${provider}/${model}`.replace(/\/+/g, "/");
  if (!isEnterpriseRuntimeModelId(candidateRuntimeId)) {
    return { provider, model };
  }

  let tenantId = params.tenantId?.trim() || "";
  if (!tenantId && params.resolveTenantId) {
    tenantId = (await params.resolveTenantId())?.trim() || "";
  }
  if (!tenantId) {
    throw new Error("Enterprise BYOK model selected but managed tenantId could not be resolved");
  }

  const invocation = await resolveEnterpriseRuntimeInvocation({
    tenantId,
    provider,
    model,
  });
  if (!invocation) {
    throw new Error(`Enterprise BYOK runtime config missing for ${candidateRuntimeId}`);
  }
  return {
    provider: invocation.provider,
    model: invocation.model,
    enterpriseRuntimeModelId: invocation.runtimeModelId,
    providerAuthOverride: {
      apiKey: invocation.apiKey,
      source: "enterprise-byok",
      ...(invocation.baseUrl ? { baseUrl: invocation.baseUrl } : {}),
      protocol: invocation.protocol,
    },
  };
}
