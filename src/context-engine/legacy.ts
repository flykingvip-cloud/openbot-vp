import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { OpenBotConfig } from "../config/config.js";
import { registerContextEngine } from "./registry.js";
import type {
  ContextEngine,
  ContextEngineInfo,
  AssembleResult,
  CompactResult,
  ContextEngineRuntimeContext,
  IngestResult,
} from "./types.js";

function envFlagEnabled(name: string): boolean {
  const raw = process.env[name];
  if (raw == null || raw.trim() === "") {
    return false;
  }
  const v = raw.trim().toLowerCase();
  return v === "1" || v === "true" || v === "yes" || v === "on";
}

function extractConversationId(sessionKey: unknown): string | null {
  if (typeof sessionKey !== "string" || !sessionKey.trim()) {
    return null;
  }
  const match = sessionKey.match(/:conversation:(conv_[a-z0-9_]+)/i);
  return match?.[1] ?? null;
}

function messageText(message: AgentMessage): string {
  const content = (message as { content?: unknown }).content;
  if (typeof content === "string") {
    return content;
  }
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === "string") {
          return part;
        }
        if (part && typeof part === "object" && "text" in part) {
          const text = (part as { text?: unknown }).text;
          return typeof text === "string" ? text : "";
        }
        return "";
      })
      .join("\n");
  }
  return "";
}

/**
 * LegacyContextEngine wraps the existing compaction behavior behind the
 * ContextEngine interface, preserving 100% backward compatibility.
 *
 * - ingest: no-op (SessionManager handles message persistence)
 * - assemble: pass-through by default; optional Context Budget Planner when
 *   OPENBOT_CONVERSATION_CONTEXT_PLANNER is enabled and tokenBudget is set
 * - afterTurn: optional Conversation Projection refresh when
 *   OPENBOT_CONVERSATION_PROJECTION is enabled
 * - compact: delegates to compactEmbeddedPiSessionDirect
 */
export class LegacyContextEngine implements ContextEngine {
  readonly info: ContextEngineInfo = {
    id: "legacy",
    name: "Legacy Context Engine",
    version: "1.0.0",
  };

  async ingest(_params: {
    sessionId: string;
    message: AgentMessage;
    isHeartbeat?: boolean;
  }): Promise<IngestResult> {
    // No-op: SessionManager handles message persistence in the legacy flow
    return { ingested: false };
  }

  async assemble(params: {
    sessionId: string;
    messages: AgentMessage[];
    tokenBudget?: number;
  }): Promise<AssembleResult> {
    if (
      typeof params.tokenBudget === "number" &&
      params.tokenBudget > 0 &&
      envFlagEnabled("OPENBOT_CONVERSATION_CONTEXT_PLANNER")
    ) {
      const { assembleMessagesWithBudget } = await import("../conversations/context-assemble.js");
      const result = assembleMessagesWithBudget(params.messages, {
        tokenBudget: params.tokenBudget,
      });
      return {
        messages: result.messages,
        estimatedTokens: result.estimatedTokens,
        budgetTrace: result.plan.trace,
      };
    }

    // Pass-through: the existing sanitize -> validate -> limit -> repair pipeline
    // in attempt.ts handles context assembly for the legacy engine.
    return {
      messages: params.messages,
      estimatedTokens: 0, // Caller handles estimation
    };
  }

  async afterTurn(params: {
    sessionId: string;
    sessionFile: string;
    messages: AgentMessage[];
    prePromptMessageCount: number;
    autoCompactionSummary?: string;
    isHeartbeat?: boolean;
    tokenBudget?: number;
    runtimeContext?: ContextEngineRuntimeContext;
  }): Promise<void> {
    if (!envFlagEnabled("OPENBOT_CONVERSATION_PROJECTION")) {
      return;
    }
    const sessionKey = params.runtimeContext?.sessionKey;
    const conversationId = extractConversationId(sessionKey);
    if (!conversationId) {
      return;
    }

    try {
      const { getFileProjectionStore } = await import("../conversations/projection-store.js");
      const { refreshConversationProjection } = await import("../conversations/projection.js");
      const cfg = params.runtimeContext?.config as OpenBotConfig | undefined;
      const store = getFileProjectionStore({ cfg });
      const userTexts = params.messages
        .filter((m) => (m as { role?: string }).role === "user")
        .map(messageText)
        .filter(Boolean);
      const assistantTexts = params.messages
        .filter((m) => (m as { role?: string }).role === "assistant")
        .map(messageText)
        .filter(Boolean);
      // Best-effort await: swallow errors so the reply path never fails.
      await refreshConversationProjection({
        store,
        input: {
          conversationId,
          participants: [],
          userTexts,
          assistantTexts,
          sources: [
            {
              sourceIdentityId: `legacy:${params.sessionId}`,
              bindingId: `legacy:${params.sessionId}`,
              sessionId: params.sessionId,
              firstTurnId: "0",
              lastTurnId: String(Math.max(0, params.messages.length - 1)),
              sourceChecksum: String(params.messages.length),
            },
          ],
        },
      });
    } catch {
      // Projection is best-effort; never throw from afterTurn.
    }
  }

  async compact(params: {
    sessionId: string;
    sessionFile: string;
    tokenBudget?: number;
    force?: boolean;
    currentTokenCount?: number;
    compactionTarget?: "budget" | "threshold";
    customInstructions?: string;
    runtimeContext?: ContextEngineRuntimeContext;
  }): Promise<CompactResult> {
    // Import through a dedicated runtime boundary so the lazy edge remains effective.
    const { compactEmbeddedPiSessionDirect } =
      await import("../agents/pi-embedded-runner/compact.runtime.js");

    // runtimeContext carries the full CompactEmbeddedPiSessionParams fields
    // set by the caller in run.ts. We spread them and override the fields
    // that come from the ContextEngine compact() signature directly.
    const runtimeContext = params.runtimeContext ?? {};

    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- bridge runtimeContext matches CompactEmbeddedPiSessionParams
    const result = await compactEmbeddedPiSessionDirect({
      ...runtimeContext,
      sessionId: params.sessionId,
      sessionFile: params.sessionFile,
      tokenBudget: params.tokenBudget,
      force: params.force,
      customInstructions: params.customInstructions,
      workspaceDir: (runtimeContext.workspaceDir as string) ?? process.cwd(),
    } as Parameters<typeof compactEmbeddedPiSessionDirect>[0]);

    return {
      ok: result.ok,
      compacted: result.compacted,
      reason: result.reason,
      result: result.result
        ? {
            summary: result.result.summary,
            firstKeptEntryId: result.result.firstKeptEntryId,
            tokensBefore: result.result.tokensBefore,
            tokensAfter: result.result.tokensAfter,
            details: result.result.details,
          }
        : undefined,
    };
  }

  async dispose(): Promise<void> {
    // Nothing to clean up for legacy engine
  }
}

/** Test helper: read projection persisted by LegacyContextEngine.afterTurn. */
export async function getLegacyProjectionForTests(
  conversationId: string,
  cfg?: OpenBotConfig,
): Promise<{ shortSummary?: string | null } | null> {
  const { getFileProjectionStore } = await import("../conversations/projection-store.js");
  const store = getFileProjectionStore({ cfg });
  return store.get(conversationId);
}

export function registerLegacyContextEngine(): void {
  registerContextEngine("legacy", () => new LegacyContextEngine());
}
