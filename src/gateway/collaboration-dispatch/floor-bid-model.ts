/**
 * Production L2 bid model. One short completion per sampled candidate.
 * Uses the parent AbortSignal. Does not create an AbortController.
 * Any failure resolves to null so the collector can skip the candidate.
 *
 * Floor P3 C1: reasoning models (e.g. deepseek-v4-flash) may spend the entire
 * output budget on `thinking` blocks and emit no `text`. Raising only the
 * wall-clock deadline does not help. Keep a dedicated answer budget and add
 * reasoning headroom so a short JSON body can still land after thinking.
 * Shadow-B stays observational (drivesProductionDecision=false).
 */
import { invokeAuxiliarySimpleCompletion } from "../../agent-runtime/model/index.js";
import { getApiKeyForModel, requireApiKey } from "../../agents/model-auth.js";
import { resolveDefaultModelForAgent } from "../../agents/model-selection.js";
import { resolveModel } from "../../agents/pi-embedded-runner/model.js";
import { getRuntimeConfigSnapshot, loadConfig } from "../../config/config.js";
import type { OpenBotConfig } from "../../config/types.js";
import type { FloorBidModel } from "./floor-bid.js";

/** Tokens reserved for the JSON bid body (intent/novelty/confidence/gist). */
export const FLOOR_BID_ANSWER_MAX_TOKENS = 160;

/**
 * Extra completion tokens so a reasoning-model thinking preamble cannot
 * exhaust the whole budget before any text block appears.
 * Empirically deepseek-v4-flash filled BID_MAX_TOKENS=160 with thinking only
 * (Floor P3 C9 diagnose, 2026-10-08).
 */
export const FLOOR_BID_REASONING_HEADROOM_TOKENS = 352;

/** Total maxTokens passed to completeSimple (= answer + reasoning headroom). */
export const FLOOR_BID_MAX_TOKENS =
  FLOOR_BID_ANSWER_MAX_TOKENS + FLOOR_BID_REASONING_HEADROOM_TOKENS;

function isTextBlock(block: {
  type?: string;
  text?: string;
}): block is { type: "text"; text: string } {
  return block.type === "text" && typeof block.text === "string";
}

/**
 * Join text blocks from a completion. Thinking-only content yields "".
 * Exported for unit tests that simulate reasoning-model empty-body failures.
 */
export function extractFloorBidTextFromContent(content: unknown): string {
  if (!Array.isArray(content)) {
    return "";
  }
  return content
    .filter(isTextBlock)
    .map((block) => block.text)
    .join("")
    .trim();
}

export function floorBidCompletionOptions(signal: AbortSignal): {
  maxTokens: number;
  temperature: number;
  reasoning: "minimal";
  signal: AbortSignal;
} {
  return {
    maxTokens: FLOOR_BID_MAX_TOKENS,
    temperature: 0,
    // Prefer minimal thinking when the provider/model honors it; catalog
    // reasoning:false models ignore this and may still emit thinking server-side.
    reasoning: "minimal",
    signal,
  };
}

function resolveCfg(cfg?: OpenBotConfig): OpenBotConfig | null {
  if (cfg) {
    return cfg;
  }
  try {
    return getRuntimeConfigSnapshot() ?? loadConfig();
  } catch {
    return null;
  }
}

export function createProductionFloorBidModel(cfg?: OpenBotConfig): FloorBidModel {
  return async (params) => {
    if (params.signal.aborted) {
      return null;
    }
    const resolvedCfg = resolveCfg(cfg);
    if (!resolvedCfg) {
      return null;
    }
    try {
      const modelRef = resolveDefaultModelForAgent({
        cfg: resolvedCfg,
        agentId: params.agentId,
      });
      if (!modelRef.provider || !modelRef.model) {
        return null;
      }
      const resolved = await resolveModel(
        modelRef.provider,
        modelRef.model,
        undefined,
        resolvedCfg,
      );
      if (!resolved.model || params.signal.aborted) {
        return null;
      }
      const apiKey = requireApiKey(
        await getApiKeyForModel({ model: resolved.model, cfg: resolvedCfg }),
        modelRef.provider,
      );
      const response = await invokeAuxiliarySimpleCompletion(
        resolved.model,
        {
          messages: [
            {
              role: "user",
              content: params.message,
              timestamp: Date.now(),
            },
          ],
        },
        {
          apiKey,
          ...floorBidCompletionOptions(params.signal),
        },
      );
      const text = extractFloorBidTextFromContent(response.content);
      if (!text) {
        return null;
      }
      const usage = response.usage;
      const costTokens = Math.max(0, Math.floor((usage?.input ?? 0) + (usage?.output ?? 0)));
      return { text, costTokens };
    } catch {
      return null;
    }
  };
}
