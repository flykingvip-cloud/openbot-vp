/**
 * P0-2 — Mode B wake→round dispatcher (reuses executeCollaborationRound).
 *
 * Builds a single-owner Mode B ParticipationDecision for the wake target lead
 * and advances it through the existing Legacy Primary/Supplement round-runtime.
 * Does not invent a second orchestrator, Floor live, or multi-beat controller.
 *
 * Composition roots bind this via setWakeRoundDispatcher / createModeBWakeRoundDispatcher.
 */
import { randomUUID } from "node:crypto";
import type { OpenBotConfig } from "../../config/types.js";
import { resolveProductionCollaborationExecutor } from "./legacy-production-executor.js";
import { normalizeAgentIdentifier } from "./mention-utils.js";
import { executeCollaborationRound } from "./round-runtime.js";
import type { BeatExecutionInput, RuntimeAuthority, RuntimeFacts } from "./runtime-authority.js";
import type { CollaborationBotTarget, ParticipationDecision } from "./types.js";
import type {
  WakeRoundDispatcher,
  WakeRoundDispatchRequest,
  WakeRoundDispatchResult,
} from "./wake-round-dispatch.js";

function compact(value: string | null | undefined): string {
  return value?.trim() ?? "";
}

function sameAgentId(a: string, b: string): boolean {
  const left = normalizeAgentIdentifier(a) ?? compact(a).toLowerCase();
  const right = normalizeAgentIdentifier(b) ?? compact(b).toLowerCase();
  return Boolean(left && right && left === right);
}

export function resolveWakeLeadBot(params: {
  toAgentIds: readonly string[];
  bots: readonly CollaborationBotTarget[];
}): CollaborationBotTarget | null {
  for (const targetId of params.toAgentIds) {
    const want = compact(targetId);
    if (!want) {
      continue;
    }
    const bot = params.bots.find((candidate) => sameAgentId(candidate.agentId, want));
    if (bot) {
      return bot;
    }
  }
  return null;
}

/** Build a Mode B single-owner decision for wake-driven execution kickoff. */
export function buildModeBWakeParticipationDecision(params: {
  roundId: string;
  sessionKey: string;
  leadBot: CollaborationBotTarget;
  reason: string;
  source: string;
}): ParticipationDecision {
  const lead = params.leadBot;
  const summary = `Mode B wake dispatch (${params.source}): ${params.reason}`;
  return {
    roundId: params.roundId,
    responseMode: "single_owner",
    tier0: [lead],
    tier1: [],
    tier2: [],
    executionBots: [lead],
    roundPlan: {
      roundId: params.roundId,
      sessionKey: params.sessionKey,
      responseMode: "single_owner",
      summaryText: summary,
      participants: [
        {
          agentId: lead.agentId,
          displayName: lead.name,
          tier: "mention",
          contributionRole: "lead",
          reasonText: `wake:${params.source}`,
        },
      ],
      alerts: [
        {
          kind: "mode_b_board_lead",
          message: summary,
        },
      ],
      mentionMode: "single_primary",
    },
    lowSignalLimited: false,
    mentionUnmatched: false,
    primaryMode: "single",
    mentionMode: "single_primary",
    primaryQueue: [lead.agentId],
  };
}

export type ModeBWakeRoundContext = Readonly<{
  authority: RuntimeAuthority;
  facts: RuntimeFacts;
  sessionKey: string;
  leadBot: CollaborationBotTarget;
  runBot: BeatExecutionInput["runBot"];
  message?: string;
  cfg?: OpenBotConfig;
  nowMs?: number;
}>;

export type ModeBWakeRoundContextResolver = (
  request: WakeRoundDispatchRequest,
) => Promise<ModeBWakeRoundContext | null> | ModeBWakeRoundContext | null;

/**
 * Run one Mode B execution round for a wake request via executeCollaborationRound.
 */
export async function executeModeBWakeRound(params: {
  request: WakeRoundDispatchRequest;
  context: ModeBWakeRoundContext;
}): Promise<WakeRoundDispatchResult> {
  const { request, context } = params;
  const leadBot = context.leadBot;
  const roundId = `wake_${request.source}_${randomUUID()}`;
  const reason = compact(request.reason) || `wake:${request.source}`;
  const message =
    compact(request.dispatchPrompt) ||
    compact(context.message) ||
    [
      `【Mode B 自推进】来源=${request.source}`,
      request.taskId ? `task=${request.taskId}` : null,
      request.itemId ? `board=${request.itemId}` : null,
      `请继续推进你认领的看板项（责任人 ${leadBot.name}）。`,
      reason,
    ]
      .filter(Boolean)
      .join("\n");

  const decision = buildModeBWakeParticipationDecision({
    roundId,
    sessionKey: context.sessionKey,
    leadBot,
    reason,
    source: request.source,
  });

  try {
    const round = await executeCollaborationRound(context.authority, context.facts, {
      decision,
      message,
      sessionKey: context.sessionKey,
      runBot: context.runBot,
      productionExecutor: resolveProductionCollaborationExecutor(context.cfg),
      isAborted: () => false,
    });
    const settledId = compact(round.roundId) || roundId;
    return { ok: true, roundId: settledId, detail: `mode_b:${request.source}` };
  } catch (error) {
    const messageText = error instanceof Error ? error.message : String(error);
    return {
      ok: false,
      reason: "execute_collaboration_round_failed",
      message: messageText.slice(0, 240),
    };
  }
}

/**
 * Create a WakeRoundDispatcher that resolves Mode B context then calls
 * executeCollaborationRound. Resolver returning null → dispatch fails soft
 * (consumer keeps outcome `recorded`).
 */
export function createModeBWakeRoundDispatcher(
  resolveContext: ModeBWakeRoundContextResolver,
): WakeRoundDispatcher {
  return async (request) => {
    const context = await resolveContext(request);
    if (!context) {
      return { ok: false, reason: "mode_b_context_unavailable" };
    }
    const leadFromRequest = resolveWakeLeadBot({
      toAgentIds: request.toAgentIds,
      bots: context.facts.bots as CollaborationBotTarget[],
    });
    const leadBot = leadFromRequest ?? context.leadBot;
    if (!leadBot) {
      return { ok: false, reason: "mode_b_lead_unresolved" };
    }
    return executeModeBWakeRound({
      request,
      context: { ...context, leadBot },
    });
  };
}
