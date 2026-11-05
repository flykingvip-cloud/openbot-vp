/** Trusted candidate resolution only. No task execution or model invocation. */
import type { Api, Model } from "@earendil-works/pi-ai/compat";
import { getApiKeyForModel } from "../../agents/model-auth.js";
import { ensureOpenClawModelsJson } from "../../agents/models-config.js";
import { resolveModel } from "../../agents/pi-embedded-runner/model.js";
import { resolveProductionSandboxAccount } from "../../agents/sandbox/account-scope.js";
import type { OpenBotConfig } from "../../config/config.js";
import { resolveEnterpriseEmbeddedTransport } from "../../gateway/enterprise-model/embedded-transport.js";
import {
  inheritExecutionIdentityRunFields,
  type ExecutionIdentityRunFields,
} from "../../gateway/execution-identity-context.js";
import { resolveCopilotApiToken } from "../../providers/github-copilot-token.js";

export function bindInteractionCandidate(params: {
  config: OpenBotConfig;
  agentDir: string;
  agentId: string;
  identity: ExecutionIdentityRunFields;
  primaryProvider: string;
  authProfileId?: string;
  signal?: AbortSignal;
}) {
  const identity = inheritExecutionIdentityRunFields(params.identity);
  // Same managed-account requirement as the existing model/tool runtime, before credential access.
  resolveProductionSandboxAccount({ config: params.config, agentId: params.agentId, ...identity });
  return async (provider: string, modelId: string) => {
    params.signal?.throwIfAborted();
    const transport = await resolveEnterpriseEmbeddedTransport({
      provider,
      model: modelId,
      tenantId: identity.executionIdentity?.enterpriseId,
    });
    await ensureOpenClawModelsJson(params.config, params.agentDir);
    const resolved = await resolveModel(
      transport.provider,
      transport.model,
      params.agentDir,
      params.config,
    );
    const override = transport.providerAuthOverride;
    let model: Model<Api> | undefined = resolved.model;
    if (!model && override?.apiKey) {
      if (!override.baseUrl?.trim()) {
        throw new Error("Enterprise interaction endpoint unavailable");
      }
      model = {
        id: transport.model,
        name: transport.model,
        provider: transport.provider,
        api: override.protocol.includes("anthropic") ? "anthropic-messages" : "openai-completions",
        baseUrl: override.baseUrl.trim(),
        reasoning: false,
        input: ["text"],
        contextWindow: 128000,
        maxTokens: 8192,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      };
    }
    if (!model) {
      throw new Error(resolved.error ?? "Interaction model unavailable");
    }
    if (override?.baseUrl?.trim()) {
      model = { ...model, baseUrl: override.baseUrl.trim() };
    }
    const auth = await getApiKeyForModel({
      model,
      cfg: params.config,
      agentDir: params.agentDir,
      profileId: provider === params.primaryProvider ? params.authProfileId : undefined,
      ...(override?.apiKey
        ? { authOverride: { apiKey: override.apiKey, source: override.source } }
        : {}),
    });
    let apiKey = auth.apiKey;
    if (!apiKey && auth.mode !== "aws-sdk") {
      throw new Error("Interaction provider credential unavailable");
    }
    if (apiKey && model.provider === "github-copilot") {
      apiKey = (await resolveCopilotApiToken({ githubToken: apiKey })).token;
    }
    params.signal?.throwIfAborted();
    return { model, ...(apiKey ? { apiKey } : {}) };
  };
}
