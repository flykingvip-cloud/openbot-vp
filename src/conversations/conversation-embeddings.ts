/**
 * Real embedding provider for conversation search (CL-P4 semantic).
 * Uses memory stack createEmbeddingProvider; falls back to hashEmbedding offline.
 */
import type { OpenBotConfig } from "../config/config.js";
import { createSubsystemLogger } from "../logging/subsystem.js";
import type { EmbeddingProvider } from "../memory/embeddings.js";
import { resolveConversationFlags } from "./flags.js";
import { hashEmbedding } from "./search-index.js";

const log = createSubsystemLogger("conversations/embeddings");

export type ConversationEmbeddingProvider = {
  id: string;
  model: string;
  /** True when using real model (openai/voyage/local/…); false for hash fallback. */
  isRealModel: boolean;
  embedQuery: (text: string) => Promise<number[]>;
  embedBatch: (texts: string[]) => Promise<number[][]>;
};

export type ConversationEmbeddingConfig = {
  /** openai | voyage | gemini | mistral | ollama | local | auto | hash */
  provider?: string;
  model?: string;
  /** Force hash even when API keys exist (tests). */
  forceHash?: boolean;
};

function asConversationEmbeddingConfig(cfg?: OpenBotConfig | null): ConversationEmbeddingConfig {
  const raw = (
    cfg as { conversation?: { search?: { embedding?: ConversationEmbeddingConfig } } } | null
  )?.conversation?.search?.embedding;
  return raw && typeof raw === "object" ? raw : {};
}

/**
 * Resolve embedding provider for conversation semantic search.
 * - Prefer configured / auto remote providers via memory embeddings stack.
 * - On failure or missing keys → deterministic hashEmbedding (dims 64 for index compat
 *   unless real model returns different dims — then we store as-is).
 */
export async function resolveConversationEmbeddingProvider(params: {
  cfg?: OpenBotConfig | null;
  forceHash?: boolean;
}): Promise<ConversationEmbeddingProvider> {
  const embCfg = asConversationEmbeddingConfig(params.cfg);
  const forceHash =
    params.forceHash === true ||
    embCfg.forceHash === true ||
    process.env.OPENBOT_CONVERSATION_EMBEDDING_HASH === "1";

  if (forceHash) {
    return createHashFallbackProvider();
  }

  const flags = resolveConversationFlags(params.cfg);
  if (!flags.searchSemanticEnabled) {
    return createHashFallbackProvider();
  }

  try {
    const { createEmbeddingProvider } = await import("../memory/embeddings.js");
    const providerReq = (embCfg.provider?.trim() ||
      process.env.OPENBOT_CONVERSATION_EMBEDDING_PROVIDER?.trim() ||
      "auto") as "auto" | "openai" | "voyage" | "gemini" | "mistral" | "ollama" | "local";
    const model =
      embCfg.model?.trim() ||
      process.env.OPENBOT_CONVERSATION_EMBEDDING_MODEL?.trim() ||
      defaultModelForProvider(providerReq);

    const result = await createEmbeddingProvider({
      config: params.cfg ?? {},
      provider: providerReq,
      model,
      fallback: "none",
    });

    if (!result.provider) {
      log.debug(
        `conversation embedding unavailable (${result.providerUnavailableReason ?? "no provider"}); using hash fallback`,
      );
      return createHashFallbackProvider();
    }

    const provider: EmbeddingProvider = result.provider;
    log.info(`conversation embedding provider=${provider.id} model=${provider.model}`);
    return {
      id: provider.id,
      model: provider.model,
      isRealModel: true,
      embedQuery: (text) => provider.embedQuery(text),
      embedBatch: (texts) => provider.embedBatch(texts),
    };
  } catch (err) {
    log.warn(`conversation embedding init failed: ${String(err)}; using hash fallback`);
    return createHashFallbackProvider();
  }
}

function defaultModelForProvider(provider: string): string {
  switch (provider) {
    case "voyage":
      return "voyage-3-lite";
    case "gemini":
      return "text-embedding-004";
    case "mistral":
      return "mistral-embed";
    case "ollama":
      return "nomic-embed-text";
    case "local":
      return "local";
    case "openai":
    case "auto":
    default:
      return "text-embedding-3-small";
  }
}

function createHashFallbackProvider(): ConversationEmbeddingProvider {
  return {
    id: "hash",
    model: "hash-v1-64",
    isRealModel: false,
    embedQuery: async (text) => hashEmbedding(text, 64),
    embedBatch: async (texts) => texts.map((t) => hashEmbedding(t, 64)),
  };
}

/** Embed query text for search; never throws. */
export async function embedConversationQuery(params: {
  cfg?: OpenBotConfig | null;
  text: string;
}): Promise<{ embedding: number[]; providerId: string; isRealModel: boolean }> {
  const provider = await resolveConversationEmbeddingProvider({ cfg: params.cfg });
  try {
    const embedding = await provider.embedQuery(params.text);
    return { embedding, providerId: provider.id, isRealModel: provider.isRealModel };
  } catch (err) {
    log.warn(`embedQuery failed (${String(err)}); hash fallback`);
    return {
      embedding: hashEmbedding(params.text, 64),
      providerId: "hash",
      isRealModel: false,
    };
  }
}
