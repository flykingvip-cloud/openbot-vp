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
import { sanitizeDispatchError } from "./sanitize-dispatch-error.js";
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
  const needle = (value: string): string => {
    const normalized = normalizeAgentIdentifier(value) ?? compact(value).toLowerCase();
    if (normalized.startsWith("bot:")) {
      return normalized.slice(4);
    }
    if (normalized.startsWith("agent:")) {
      return normalized.slice("agent:".length);
    }
    return normalized;
  };
  const left = needle(a);
  const right = needle(b);
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
  // Prefer durable binding.runId (derived from wake-op attempt) so the Mode B
  // round identity matches the deliverable binding — do not invent a second UUID.
  const boundRunId = compact(request.executionDeliverableBinding?.runId);
  const roundId = boundRunId || `wake_${request.source}_${randomUUID()}`;
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
    // Dispatch-accepted ≠ round-succeeded ≠ task-done. ROUND_ABORTED / empty
    // completion must not be receipted as completed_with_receipt.
    if (round.state === "ROUND_ABORTED") {
      const completion = round.completion;
      const noVisible =
        !completion?.visibleReply ||
        completion.responseStatus === "placeholder" ||
        completion.responseStatus === "failed" ||
        completion.responseStatus === "aborted";
      const abortDetail =
        compact(round.abortReason) || (noVisible ? "no_visible_reply" : "aborted");
      // Once executeCollaborationRound returned an aborted round, we lack proof that
      // tools/files/messages never ran — empty final text ≠ not_started. Only
      // pre-invoke Mode B failures (context/lead) may claim not_started.
      return {
        ok: false,
        reason: `round_aborted:${abortDetail}`,
        message: `Mode B round aborted (${abortDetail})`,
        sideEffectClass: "started_or_unknown",
      };
    }
    if (round.state !== "ROUND_COMPLETE") {
      return {
        ok: false,
        reason: `round_not_complete:${compact(round.state) || "unknown"}`,
        message: `Mode B round ended in ${compact(round.state) || "unknown"}`,
        sideEffectClass: "started_or_unknown",
      };
    }
    return {
      ok: true,
      roundId: settledId,
      detail: `mode_b:${request.source}`,
      sideEffectClass: "completed_with_receipt",
    };
  } catch (error) {
    const safe = sanitizeDispatchError(error, 240);
    // Exception may occur AFTER model/tools/formal write started — not "no side effects".
    return {
      ok: false,
      reason: "execute_collaboration_round_failed",
      message: safe.message,
      sideEffectClass: "started_or_unknown",
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
      return {
        ok: false,
        reason: "mode_b_context_unavailable",
        sideEffectClass: "not_started",
      };
    }
    const leadFromRequest = resolveWakeLeadBot({
      toAgentIds: request.toAgentIds,
      bots: context.facts.bots as CollaborationBotTarget[],
    });
    const leadBot = leadFromRequest ?? context.leadBot;
    if (!leadBot) {
      return {
        ok: false,
        reason: "mode_b_lead_unresolved",
        sideEffectClass: "not_started",
      };
    }
    return executeModeBWakeRound({
      request,
      context: { ...context, leadBot },
    });
  };
}
