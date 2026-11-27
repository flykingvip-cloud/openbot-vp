import { randomUUID } from "node:crypto";
import type { TextContent } from "@earendil-works/pi-ai/compat";
import { invokeAuxiliarySimpleCompletion } from "../../../../agent-runtime/model/index.js";
import { getApiKeyForModel, requireApiKey } from "../../../../agents/model-auth.js";
import { resolveDefaultModelForAgent } from "../../../../agents/model-selection.js";
import { resolveModel } from "../../../../agents/pi-embedded-runner/model.js";
import type { OpenBotConfig } from "../../../../config/config.js";
import { loadConfig } from "../../../../config/config.js";
import {
  extractGovernanceLlmTokenUsage,
  reportGovernanceLlmUsageBestEffort,
  type GovernanceLlmUsageScope,
} from "../usage/governance-llm-usage.js";

export type ChunkConflictLlmVerdict = {
  contradicts: boolean;
  reason: string;
  confidence: number;
};

export type ChunkConflictLlmClient = {
  judgePair: (params: {
    leftText: string;
    rightText: string;
  }) => Promise<ChunkConflictLlmVerdict | null>;
};

const MAX_CHUNK_CHARS = 1_200;
const LLM_TIMEOUT_MS = 20_000;
const MIN_LLM_CONFIDENCE = 0.55;

function truncateChunkText(text: string): string {
  const trimmed = text.trim();
  if (trimmed.length <= MAX_CHUNK_CHARS) {
    return trimmed;
  }
  return `${trimmed.slice(0, MAX_CHUNK_CHARS)}…`;
}

function isTextBlock(block: { type: string }): block is TextContent {
  return block.type === "text";
}

export function parseChunkConflictLlmVerdict(raw: string): ChunkConflictLlmVerdict | null {
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1]?.trim();
  const candidate = fenced ?? raw.trim();
  const jsonStart = candidate.indexOf("{");
  const jsonEnd = candidate.lastIndexOf("}");
  if (jsonStart < 0 || jsonEnd <= jsonStart) {
    return null;
  }
  try {
    const parsed = JSON.parse(candidate.slice(jsonStart, jsonEnd + 1)) as {
      contradicts?: unknown;
      reason?: unknown;
      confidence?: unknown;
    };
    if (typeof parsed.contradicts !== "boolean") {
      return null;
    }
    const reason =
      typeof parsed.reason === "string" && parsed.reason.trim()
        ? parsed.reason.trim().slice(0, 240)
        : parsed.contradicts
          ? "llm_contradiction"
          : "llm_no_contradiction";
    const confidence =
      typeof parsed.confidence === "number" && Number.isFinite(parsed.confidence)
        ? Math.min(1, Math.max(0, parsed.confidence))
        : parsed.contradicts
          ? 0.7
          : 0.3;
    return { contradicts: parsed.contradicts, reason, confidence };
  } catch {
    return null;
  }
}

function buildConflictPrompt(leftText: string, rightText: string): string {
  return [
    "You judge whether two knowledge-base text chunks make contradictory factual claims.",
    "Reply with JSON only, no markdown:",
    '{"contradicts":boolean,"reason":string,"confidence":number}',
    "Rules:",
    "- contradicts=true only when both chunks address the same topic and assert incompatible facts.",
    "- Different detail levels, paraphrases, or non-overlapping topics → contradicts=false.",
    "- confidence is 0..1.",
    "",
    "<chunk_a>",
    leftText,
    "</chunk_a>",
    "",
    "<chunk_b>",
    rightText,
    "</chunk_b>",
  ].join("\n");
}

export function createChunkConflictLlmClient(params?: {
  cfg?: OpenBotConfig;
  usageContext?: GovernanceLlmUsageScope;
  reportUsageFn?: typeof reportGovernanceLlmUsageBestEffort;
}): ChunkConflictLlmClient | null {
  const cfg = params?.cfg ?? loadConfig();
  const modelRef = resolveDefaultModelForAgent({ cfg });
  const usageContext = params?.usageContext;
  const reportUsage = params?.reportUsageFn ?? reportGovernanceLlmUsageBestEffort;
  const modelId = modelRef.model;
  const provider = modelRef.provider;

  return {
    judgePair: async ({ leftText, rightText }) => {
      const resolved = await resolveModel(modelRef.provider, modelRef.model, undefined, cfg);
      if (!resolved.model) {
        return null;
      }
      let apiKey: string;
      try {
        apiKey = requireApiKey(
          await getApiKeyForModel({ model: resolved.model, cfg }),
          modelRef.provider,
        );
      } catch {
        return null;
      }

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), LLM_TIMEOUT_MS);
      try {
        const response = await invokeAuxiliarySimpleCompletion(
          resolved.model,
          {
            messages: [
              {
                role: "user",
                content: buildConflictPrompt(
                  truncateChunkText(leftText),
                  truncateChunkText(rightText),
                ),
                timestamp: Date.now(),
              },
            ],
          },
          {
            apiKey,
            maxTokens: 256,
            temperature: 0,
            signal: controller.signal,
          },
        );
        if (usageContext?.kbId) {
          const tokens = extractGovernanceLlmTokenUsage(response.usage);
          void reportUsage({
            kbId: usageContext.kbId,
            enterpriseId: usageContext.enterpriseId,
            userId: usageContext.userId,
            jobId: usageContext.jobId,
            db: usageContext.db,
            modelId,
            provider,
            callId: randomUUID(),
            inputTokens: tokens.inputTokens,
            outputTokens: tokens.outputTokens,
          });
        }
        const text = response.content
          .filter(isTextBlock)
          .map((block) => block.text)
          .join("")
          .trim();
        if (!text) {
          return null;
        }
        const verdict = parseChunkConflictLlmVerdict(text);
        if (!verdict || !verdict.contradicts || verdict.confidence < MIN_LLM_CONFIDENCE) {
          return verdict?.contradicts
            ? null
            : { contradicts: false, reason: "llm_clear", confidence: 0.2 };
        }
        return verdict;
      } catch {
        return null;
      } finally {
        clearTimeout(timeout);
      }
    },
  };
}

export function recallScoreEligibleForLlm(params: {
  recallScore: number;
  recallSource: "vector" | "fts";
}): boolean {
  if (params.recallSource === "vector") {
    return params.recallScore >= 0.8;
  }
  return params.recallScore >= 0.35;
}
