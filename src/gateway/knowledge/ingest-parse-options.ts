import type { HierarchicalChunking } from "./chunkers/hierarchical.js";

export type KnowledgeFileChunkingStrategy = "auto" | "paragraph" | "fixed";

export type KnowledgeIngestParseOptions = {
  chunkingStrategy?: KnowledgeFileChunkingStrategy;
  ocrEnabled?: boolean;
};

const DEFAULT_KB_CHUNKING: HierarchicalChunking = {
  tokens: 400,
  overlap: 80,
};

const CHUNKING_BY_STRATEGY: Record<KnowledgeFileChunkingStrategy, HierarchicalChunking> = {
  auto: DEFAULT_KB_CHUNKING,
  paragraph: { tokens: 1200, overlap: 0 },
  fixed: { tokens: 200, overlap: 32 },
};

export function parseKnowledgeIngestParseOptions(
  value: unknown,
): KnowledgeIngestParseOptions | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }
  const record = value as Record<string, unknown>;
  const rawStrategy = record.chunkingStrategy;
  const chunkingStrategy =
    rawStrategy === "auto" || rawStrategy === "paragraph" || rawStrategy === "fixed"
      ? rawStrategy
      : undefined;
  const ocrEnabled = typeof record.ocrEnabled === "boolean" ? record.ocrEnabled : undefined;
  if (!chunkingStrategy && ocrEnabled === undefined) {
    return undefined;
  }
  return {
    ...(chunkingStrategy ? { chunkingStrategy } : {}),
    ...(ocrEnabled !== undefined ? { ocrEnabled } : {}),
  };
}

export function resolveChunkingFromStrategy(
  strategy?: KnowledgeFileChunkingStrategy,
): HierarchicalChunking {
  if (!strategy) {
    return DEFAULT_KB_CHUNKING;
  }
  return CHUNKING_BY_STRATEGY[strategy];
}
