/**
 * Build model definition entries that match backend ModelDefinitionSchema.
 *
 * callType / executor path belong to the platform capability archive (admission
 * store), NOT the strict models.providers.*.models[] config contract.
 */

export type PlatformModelCallType = "text_chat" | "image_generation" | "music_generation";

export type PlatformModelDefinitionInput = {
  modelId: string;
  name: string;
  api: string;
  reasoning: boolean;
  inputModes: Array<"text" | "image">;
  /** Omit or null when unknown — do not invent 128k/8k defaults. */
  contextWindow?: number | null;
  maxTokens?: number | null;
};

/** Shape written into models.providers[id].models[] — no unknown keys. */
export type PlatformModelDefinitionEntry = {
  id: string;
  name: string;
  api: string;
  reasoning: boolean;
  input: Array<"text" | "image">;
  cost: {
    input: number;
    output: number;
    cacheRead: number;
    cacheWrite: number;
  };
  contextWindow?: number;
  maxTokens?: number;
};

export function buildPlatformModelDefinitionEntry(
  input: PlatformModelDefinitionInput,
): PlatformModelDefinitionEntry {
  const modelId = input.modelId.trim();
  const knownContext =
    input.contextWindow != null && Number.isFinite(input.contextWindow) && input.contextWindow > 0
      ? Math.floor(input.contextWindow)
      : null;
  const knownMaxTokens =
    input.maxTokens != null && Number.isFinite(input.maxTokens) && input.maxTokens > 0
      ? Math.floor(input.maxTokens)
      : null;

  return {
    id: modelId,
    name: input.name.trim() || modelId,
    api: input.api,
    reasoning: input.reasoning,
    input: input.inputModes.length > 0 ? input.inputModes : ["text"],
    cost: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
    },
    ...(knownContext != null ? { contextWindow: knownContext } : {}),
    ...(knownMaxTokens != null ? { maxTokens: knownMaxTokens } : {}),
  };
}
