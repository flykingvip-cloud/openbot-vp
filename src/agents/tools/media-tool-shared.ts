import { type Api, type Model } from "@earendil-works/pi-ai/compat";
import type { OpenBotConfig } from "../../config/config.js";
import { getDefaultLocalRoots } from "../../web/media.js";
import type { ImageModelConfig } from "./image-tool.helpers.js";
import { getApiKeyForModel, normalizeWorkspaceDir, requireApiKey } from "./tool-runtime.helpers.js";

type TextToolAttempt = {
  provider: string;
  model: string;
  error: string;
};

type TextToolResult = {
  text: string;
  provider: string;
  model: string;
  attempts: TextToolAttempt[];
};

export function applyImageModelConfigDefaults(
  cfg: OpenBotConfig | undefined,
  imageModelConfig: ImageModelConfig,
): OpenBotConfig | undefined {
  if (!cfg) {
    return undefined;
  }
  return {
    ...cfg,
    agents: {
      ...cfg.agents,
      defaults: {
        ...cfg.agents?.defaults,
        imageModel: imageModelConfig,
      },
    },
  };
}

export function resolveMediaToolLocalRoots(
  workspaceDirRaw: string | undefined,
  options?: {
    workspaceOnly?: boolean;
    /**
     * Exact file paths this run may read in addition to the roots above — the
     * turn's own inbound attachments (see inbound-media-grants.ts). These are
     * files, not directories: `assertLocalMediaAllowed` matches a root either
     * exactly or as a path prefix, so a file entry grants only that one file and
     * never its directory. Required under workspaceOnly, where webchat uploads
     * live outside the agent workspace.
     */
    grantedPaths?: readonly string[];
  },
): string[] {
  const workspaceDir = normalizeWorkspaceDir(workspaceDirRaw);
  const granted = (options?.grantedPaths ?? []).filter((entry) => entry.trim().length > 0);
  if (options?.workspaceOnly) {
    return Array.from(new Set([...(workspaceDir ? [workspaceDir] : []), ...granted]));
  }
  const roots = getDefaultLocalRoots();
  if (!workspaceDir) {
    return Array.from(new Set([...roots, ...granted]));
  }
  return Array.from(new Set([...roots, workspaceDir, ...granted]));
}

export function resolvePromptAndModelOverride(
  args: Record<string, unknown>,
  defaultPrompt: string,
): {
  prompt: string;
  modelOverride?: string;
} {
  const prompt =
    typeof args.prompt === "string" && args.prompt.trim() ? args.prompt.trim() : defaultPrompt;
  const modelOverride =
    typeof args.model === "string" && args.model.trim() ? args.model.trim() : undefined;
  return { prompt, modelOverride };
}

export function buildTextToolResult(
  result: TextToolResult,
  extraDetails: Record<string, unknown>,
): {
  content: Array<{ type: "text"; text: string }>;
  details: Record<string, unknown>;
} {
  return {
    content: [{ type: "text", text: result.text }],
    details: {
      model: `${result.provider}/${result.model}`,
      ...extraDetails,
      attempts: result.attempts,
    },
  };
}

export function resolveModelFromRegistry(params: {
  modelRegistry: { find: (provider: string, modelId: string) => unknown };
  provider: string;
  modelId: string;
}): Model<Api> {
  const model = params.modelRegistry.find(params.provider, params.modelId) as Model<Api> | null;
  if (!model) {
    throw new Error(`Unknown model: ${params.provider}/${params.modelId}`);
  }
  return model;
}

export async function resolveModelRuntimeApiKey(params: {
  model: Model<Api>;
  cfg: OpenBotConfig | undefined;
  agentDir: string;
  authStorage: {
    setRuntimeApiKey: (provider: string, apiKey: string) => void;
  };
}): Promise<string> {
  const apiKeyInfo = await getApiKeyForModel({
    model: params.model,
    cfg: params.cfg,
    agentDir: params.agentDir,
  });
  const apiKey = requireApiKey(apiKeyInfo, params.model.provider);
  params.authStorage.setRuntimeApiKey(params.model.provider, apiKey);
  return apiKey;
}
