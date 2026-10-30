import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { OpenBotConfig } from "../config/config.js";
import {
  readEnvBoolOverride,
  resolveConversationFlags,
  type ConversationConfigSlice,
  type ConversationFlagSubject,
} from "../conversations/flags.js";
import { resolveProjectionStoreDir } from "../conversations/projection-store.js";
import { registerContextEngine } from "./registry.js";
import type {
  ContextEngine,
  ContextEngineInfo,
  AssembleResult,
  CompactResult,
  ContextCapabilityDecision,
  ContextEngineRuntimeContext,
  IngestResult,
} from "./types.js";

type ParsedRuntime = {
  config?: OpenBotConfig;
  sessionKey?: string;
  subject?: ConversationFlagSubject;
};

function conversationSlice(cfg?: OpenBotConfig | null): ConversationConfigSlice | undefined {
  const raw = (cfg as { conversation?: ConversationConfigSlice } | null | undefined)?.conversation;
  return raw && typeof raw === "object" ? raw : undefined;
}

function disableReason(
  envKey: string,
  configValue: boolean | undefined,
): ContextCapabilityDecision["reason"] {
  const override = readEnvBoolOverride(envKey);
  if (override === false) {
    return "disabled_by_env";
  }
  if (configValue === false) {
    return "disabled_by_config";
  }
  return "disabled";
}

function parseRuntime(runtimeContext?: ContextEngineRuntimeContext): ParsedRuntime {
  if (!runtimeContext || typeof runtimeContext !== "object") {
    return {};
  }
  const config = runtimeContext.config;
  const sessionKey = runtimeContext.sessionKey;
  const subjectRaw = runtimeContext.subject;
  let subject: ConversationFlagSubject | undefined;
  if (subjectRaw && typeof subjectRaw === "object") {
    const record = subjectRaw as Record<string, unknown>;
    subject = {
      tenantId: typeof record.tenantId === "string" ? record.tenantId : null,
      principalId: typeof record.principalId === "string" ? record.principalId : null,
      seatId: typeof record.seatId === "string" ? record.seatId : null,
    };
  }
  return {
    config: config && typeof config === "object" ? (config as OpenBotConfig) : undefined,
    sessionKey: typeof sessionKey === "string" ? sessionKey : undefined,
    subject,
  };
}

function positiveBudget(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

function sessionBindingPath(cfg: OpenBotConfig | undefined, sessionId: string): string {
  const safe = sessionId.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 180);
  return join(resolveProjectionStoreDir({ cfg }), "_sessions", `${safe}.txt`);
}

async function writeSessionProjectionBinding(params: {
  cfg?: OpenBotConfig;
  sessionId: string;
  conversationId: string;
}): Promise<void> {
  if (!params.sessionId.trim() || !params.conversationId.trim()) {
    return;
  }
  const target = sessionBindingPath(params.cfg, params.sessionId);
  await mkdir(dirname(target), { recursive: true, mode: 0o700 });
  await writeFile(target, `${params.conversationId}\n`, "utf-8");
}

async function readSessionProjectionBinding(
  cfg: OpenBotConfig | undefined,
  sessionId: string,
): Promise<string | null> {
  if (!sessionId.trim()) {
    return null;
  }
  try {
    const raw = await readFile(sessionBindingPath(cfg, sessionId), "utf-8");
    const conversationId = raw.trim();
    return conversationId || null;
  } catch {
    return null;
  }
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
 * - assemble: Context Budget Planner when the unified conversation flags enable
 *   it and tokenBudget is set. Flags follow env override > config > default.
 * - afterTurn: Conversation Projection refresh under the same flag source.
 *   The next assemble consumes the stored projection for that session.
 * - compact: delegates to compactEmbeddedPiSessionDirect
 */
export class LegacyContextEngine implements ContextEngine {
  readonly info: ContextEngineInfo = {
    id: "legacy",
    name: "Legacy Context Engine",
    version: "1.0.0",
  };

  /** Last planner/projection decisions. Skips are recorded here and are not thrown. */
  lastCapabilityDecisions: ContextCapabilityDecision[] = [];

  constructor(private readonly boundConfig?: OpenBotConfig) {}

  private resolveCfg(runtime?: ParsedRuntime): OpenBotConfig | undefined {
    return runtime?.config ?? this.boundConfig;
  }

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
    runtimeContext?: ContextEngineRuntimeContext;
  }): Promise<AssembleResult> {
    const runtime = parseRuntime(params.runtimeContext);
    const cfg = this.resolveCfg(runtime);
    const flags = resolveConversationFlags(cfg, runtime.subject);
    const slice = conversationSlice(cfg);
    const decisions: ContextCapabilityDecision[] = [];

    let messages = params.messages;
    let estimatedTokens = 0;
    let budgetTrace: AssembleResult["budgetTrace"];
    let systemPromptAddition: string | undefined;

    if (!flags.contextPlannerEnabled) {
      decisions.push({
        capability: "context_planner",
        enabled: false,
        applied: false,
        reason: disableReason(
          "OPENBOT_CONVERSATION_CONTEXT_PLANNER",
          slice?.contextPlanner?.enabled,
        ),
      });
    } else if (!positiveBudget(params.tokenBudget)) {
      // Missing budget is a normal skip. Do not invent a trace or throw.
      decisions.push({
        capability: "context_planner",
        enabled: true,
        applied: false,
        reason: "missing_token_budget",
      });
    } else {
      const { assembleMessagesWithBudget } = await import("../conversations/context-assemble.js");
      const result = assembleMessagesWithBudget(params.messages, {
        tokenBudget: params.tokenBudget,
      });
      messages = result.messages;
      estimatedTokens = result.estimatedTokens;
      budgetTrace = result.plan.trace;
      decisions.push({
        capability: "context_planner",
        enabled: true,
        applied: true,
        reason: null,
      });
    }

    if (!flags.projectionEnabled) {
      decisions.push({
        capability: "conversation_projection",
        enabled: false,
        applied: false,
        reason: disableReason("OPENBOT_CONVERSATION_PROJECTION", slice?.projection?.enabled),
      });
    } else {
      const fromKey = extractConversationId(runtime.sessionKey);
      const conversationId = fromKey ?? (await readSessionProjectionBinding(cfg, params.sessionId));
      if (!conversationId) {
        decisions.push({
          capability: "conversation_projection",
          enabled: true,
          applied: false,
          reason: "missing_conversation_id",
        });
      } else {
        try {
          const { getFileProjectionStore } = await import("../conversations/projection-store.js");
          const stored = await getFileProjectionStore({ cfg }).get(conversationId);
          const summary = stored?.shortSummary?.trim();
          if (!stored || !summary || summary === "No summary yet.") {
            decisions.push({
              capability: "conversation_projection",
              enabled: true,
              applied: false,
              reason: "projection_not_found",
            });
          } else {
            systemPromptAddition = `Conversation projection (prior turns, not new evidence):\n${summary}`;
            decisions.push({
              capability: "conversation_projection",
              enabled: true,
              applied: true,
              reason: null,
            });
          }
        } catch {
          decisions.push({
            capability: "conversation_projection",
            enabled: true,
            applied: false,
            reason: "projection_not_found",
          });
        }
      }
    }

    this.lastCapabilityDecisions = decisions;
    return {
      messages,
      estimatedTokens,
      ...(budgetTrace ? { budgetTrace } : {}),
      ...(systemPromptAddition ? { systemPromptAddition } : {}),
      capabilityDecisions: decisions,
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
    const runtime = parseRuntime(params.runtimeContext);
    const cfg = this.resolveCfg(runtime);
    const flags = resolveConversationFlags(cfg, runtime.subject);
    const slice = conversationSlice(cfg);
    if (!flags.projectionEnabled) {
      this.lastCapabilityDecisions = [
        {
          capability: "conversation_projection",
          enabled: false,
          applied: false,
          reason: disableReason("OPENBOT_CONVERSATION_PROJECTION", slice?.projection?.enabled),
        },
      ];
      return;
    }
    const sessionKey = runtime.sessionKey;
    const conversationId = extractConversationId(sessionKey);
    if (!conversationId) {
      this.lastCapabilityDecisions = [
        {
          capability: "conversation_projection",
          enabled: true,
          applied: false,
          reason: "missing_conversation_id",
        },
      ];
      return;
    }

    try {
      const { getFileProjectionStore } = await import("../conversations/projection-store.js");
      const { refreshConversationProjection } = await import("../conversations/projection.js");
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
      await writeSessionProjectionBinding({
        cfg,
        sessionId: params.sessionId,
        conversationId,
      });
      this.lastCapabilityDecisions = [
        {
          capability: "conversation_projection",
          enabled: true,
          applied: true,
          reason: null,
        },
      ];
    } catch {
      // Projection is best-effort; never throw from afterTurn.
      this.lastCapabilityDecisions = [
        {
          capability: "conversation_projection",
          enabled: true,
          applied: false,
          reason: "projection_not_found",
        },
      ];
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
  registerContextEngine("legacy", (config) => new LegacyContextEngine(config));
}
