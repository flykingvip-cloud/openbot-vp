import { resolveDefaultAgentId } from "../agents/agent-scope.js";
import { loadConfig } from "../config/config.js";
import { getMemorySearchManager } from "./index.js";
import type { MemoryEmbeddingProbeResult, MemoryProviderStatus } from "./types.js";

export type MemoryDoctorStatusPayload = {
  agentId: string;
  backend?: "builtin" | "qmd" | "cogniweave";
  provider?: string;
  queryStatus?: string;
  writeStatus?: string;
  indexStatus?: string;
  enabledSources?: string[];
  sharedSources?: string[];
  transcriptIngest?: "enabled" | "disabled";
  distillation?: {
    atoms: number;
    evidence: number;
  };
  embedding: {
    ok: boolean;
    error?: string;
  };
};

export type LoadGatewayMemoryDoctorStatusOptions = {
  /**
   * Live-ping the embedding provider. Default false: health snapshots must not
   * spend Gemini/OpenAI quota every refresh tick.
   */
  probeEmbeddings?: boolean;
  now?: () => number;
};

/** Live embedding pings are cached so doctor + health cannot metronome a 429. */
export const MEMORY_EMBEDDING_PROBE_CACHE_TTL_MS = 15 * 60 * 1000;

type EmbeddingProbeCache = {
  agentId: string;
  embedding: MemoryEmbeddingProbeResult;
  at: number;
};

let embeddingProbeCache: EmbeddingProbeCache | null = null;

export function resetMemoryDoctorEmbeddingProbeCache(): void {
  embeddingProbeCache = null;
}

function isSourcePolicyEntry(value: unknown): value is {
  enabled?: unknown;
  allowsSharedScope?: unknown;
} {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function isDistillationEntry(value: unknown): value is {
  atoms: number;
  evidence: number;
} {
  return (
    !!value &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    typeof (value as { atoms?: unknown }).atoms === "number" &&
    typeof (value as { evidence?: unknown }).evidence === "number"
  );
}

function normalizeEmbedding(result: MemoryEmbeddingProbeResult): MemoryEmbeddingProbeResult {
  if (!result.ok && !result.error) {
    return { ok: false, error: "memory embeddings unavailable" };
  }
  return result;
}

export function inferEmbeddingFromProviderStatus(
  status: Pick<MemoryProviderStatus, "provider">,
): MemoryEmbeddingProbeResult {
  const provider = status.provider?.trim();
  if (!provider || provider === "none" || provider === "fts" || provider === "fts-only") {
    return {
      ok: false,
      error: "No embedding provider available (FTS-only mode)",
    };
  }
  return { ok: true };
}

function readCachedEmbedding(agentId: string, nowMs: number): MemoryEmbeddingProbeResult | null {
  if (!embeddingProbeCache) {
    return null;
  }
  if (embeddingProbeCache.agentId !== agentId) {
    return null;
  }
  if (nowMs - embeddingProbeCache.at >= MEMORY_EMBEDDING_PROBE_CACHE_TTL_MS) {
    return null;
  }
  return embeddingProbeCache.embedding;
}

export async function loadGatewayMemoryDoctorStatus(
  options: LoadGatewayMemoryDoctorStatusOptions = {},
): Promise<MemoryDoctorStatusPayload> {
  const probeEmbeddings = options.probeEmbeddings === true;
  const nowMs = (options.now ?? Date.now)();
  const cfg = loadConfig();
  const agentId = resolveDefaultAgentId(cfg);
  const { manager, error } = await getMemorySearchManager({
    cfg,
    agentId,
    purpose: "status",
  });
  if (!manager) {
    return {
      agentId,
      embedding: {
        ok: false,
        error: error ?? "memory search unavailable",
      },
    };
  }

  try {
    const status = manager.status();
    const cached = readCachedEmbedding(agentId, nowMs);
    let embedding: MemoryEmbeddingProbeResult;
    if (probeEmbeddings) {
      if (cached) {
        embedding = cached;
      } else {
        embedding = normalizeEmbedding(await manager.probeEmbeddingAvailability());
        embeddingProbeCache = { agentId, embedding, at: nowMs };
      }
    } else {
      embedding = cached ?? inferEmbeddingFromProviderStatus(status);
    }
    const distillation = isDistillationEntry(status.custom?.distillation)
      ? {
          atoms: status.custom.distillation.atoms,
          evidence: status.custom.distillation.evidence,
        }
      : undefined;
    return {
      agentId,
      backend: status.backend,
      provider: status.provider,
      queryStatus:
        typeof status.custom?.queryStatus === "string" ? status.custom.queryStatus : undefined,
      writeStatus:
        typeof status.custom?.writeStatus === "string" ? status.custom.writeStatus : undefined,
      indexStatus:
        typeof status.custom?.indexStatus === "string" ? status.custom.indexStatus : undefined,
      enabledSources:
        status.custom?.sourcePolicy &&
        typeof status.custom.sourcePolicy === "object" &&
        !Array.isArray(status.custom.sourcePolicy)
          ? Object.entries(status.custom.sourcePolicy)
              .filter(
                (entry): entry is [string, { enabled?: unknown }] =>
                  typeof entry[0] === "string" && isSourcePolicyEntry(entry[1]),
              )
              .filter(([, value]) => value.enabled === true)
              .map(([source]) => source)
          : undefined,
      sharedSources:
        status.custom?.sourcePolicy &&
        typeof status.custom.sourcePolicy === "object" &&
        !Array.isArray(status.custom.sourcePolicy)
          ? Object.entries(status.custom.sourcePolicy)
              .filter(
                (entry): entry is [string, { allowsSharedScope?: unknown }] =>
                  typeof entry[0] === "string" && isSourcePolicyEntry(entry[1]),
              )
              .filter(([, value]) => value.allowsSharedScope === true)
              .map(([source]) => source)
          : undefined,
      transcriptIngest:
        status.custom?.sourcePolicy &&
        typeof status.custom.sourcePolicy === "object" &&
        !Array.isArray(status.custom.sourcePolicy) &&
        "sessions" in status.custom.sourcePolicy &&
        isSourcePolicyEntry(status.custom.sourcePolicy.sessions) &&
        status.custom.sourcePolicy.sessions.enabled === true
          ? "enabled"
          : "disabled",
      ...(distillation ? { distillation } : {}),
      embedding,
    };
  } finally {
    await manager.close?.().catch(() => {});
  }
}
