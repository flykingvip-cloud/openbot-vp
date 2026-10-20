/**
 * C3 — assistantMentionDispatch consumer (2026-10-13).
 *
 * C2 writers mark assistant inline `@` as `dispatch_eligible` when
 * `collaboration.task.assistantMentionDispatch` is ON. This module is the
 * opt-in consumer: resolve those tokens to group bots and emit `peer_ask`
 * CollabEdges so the **existing** same-round supplement path dispatches them
 * (CollabEdge → invited supplement). Does **not** open a new round
 * (`assistantInlineAtCreatesRound()===false` stays frozen), invent Floor live,
 * or add a second orchestrator.
 *
 * Flag OFF → no edges / no consumer dispatch (observe stays `not_dispatched`).
 */
import type { OpenBotConfig } from "../../config/types.js";
import {
  budgetCollabEdges,
  createCollabEdgeTargetResolver,
  parseCollabEdgesFromText,
  type CollabEdge,
} from "./collab-edge.js";
import { isBroadcastMentionToken, normalizeAgentIdentifier } from "./mention-utils.js";
import type { CollaborationBotTarget } from "./types.js";
import { planAssistantMentionTargets, shouldDispatchAssistantMention } from "./wake-contract.js";

export const ASSISTANT_MENTION_EDGE_REASON = "assistant_inline_at" as const;

export type AssistantMentionDispatchPlan = {
  allowed: boolean;
  tokens: string[];
  /** Resolved group bots (self + broadcast skipped). */
  targets: CollaborationBotTarget[];
  reason: string;
};

function uniqueBots(bots: readonly CollaborationBotTarget[]): CollaborationBotTarget[] {
  const seen = new Set<string>();
  const out: CollaborationBotTarget[] = [];
  for (const bot of bots) {
    const id = normalizeAgentIdentifier(bot.agentId);
    if (!id || seen.has(id)) {
      continue;
    }
    seen.add(id);
    out.push(bot);
  }
  return out;
}

/**
 * Pure plan: flag gate + token collect + resolve to group bots.
 * Broadcast tokens and self-mentions never become dispatch targets.
 */
export function planAssistantMentionDispatch(params: {
  text: string;
  fromAgentId: string;
  bots: readonly CollaborationBotTarget[];
  cfg?: OpenBotConfig;
}): AssistantMentionDispatchPlan {
  const planned = planAssistantMentionTargets(params.text, params.cfg);
  if (!planned.allowed) {
    return {
      allowed: false,
      tokens: planned.targets,
      targets: [],
      reason: planned.reason,
    };
  }
  const fromId = normalizeAgentIdentifier(params.fromAgentId);
  const resolve = createCollabEdgeTargetResolver(params.bots);
  const byId = new Map(
    params.bots
      .map((bot) => {
        const id = normalizeAgentIdentifier(bot.agentId);
        return id ? ([id, bot] as const) : null;
      })
      .filter((row): row is readonly [string, CollaborationBotTarget] => Boolean(row)),
  );
  const matched: CollaborationBotTarget[] = [];
  for (const token of planned.targets) {
    if (isBroadcastMentionToken(token)) {
      continue;
    }
    const resolved = resolve(token);
    const id = normalizeAgentIdentifier(resolved);
    if (!id || (fromId && id === fromId)) {
      continue;
    }
    const bot = byId.get(id);
    if (bot) {
      matched.push(bot);
    }
  }
  const targets = uniqueBots(matched);
  if (targets.length === 0) {
    return {
      allowed: false,
      tokens: planned.targets,
      targets: [],
      reason: "assistantMentionDispatch=on; @ tokens did not resolve to group bots",
    };
  }
  return {
    allowed: true,
    tokens: planned.targets,
    targets,
    reason: "assistantMentionDispatch=on; targets resolved for same-round peer_ask dispatch",
  };
}

/** Build peer_ask edges for resolved assistant @ targets (not yet budgeted). */
export function buildAssistantMentionPeerAskEdges(params: {
  fromAgentId: string;
  targets: readonly CollaborationBotTarget[];
}): CollabEdge[] {
  const fromAgentId = params.fromAgentId.trim();
  if (!fromAgentId) {
    return [];
  }
  const edges: CollabEdge[] = [];
  const seen = new Set<string>();
  for (const bot of params.targets) {
    const toAgentId = bot.agentId.trim();
    const key = normalizeAgentIdentifier(toAgentId);
    if (!toAgentId || !key || seen.has(key)) {
      continue;
    }
    if (normalizeAgentIdentifier(fromAgentId) === key) {
      continue;
    }
    seen.add(key);
    edges.push({
      kind: "peer_ask",
      fromAgentId,
      toAgentId,
      reason: ASSISTANT_MENTION_EDGE_REASON,
      depth: 1,
    });
  }
  return edges;
}

/**
 * Attach path helper: parse explicit `[[collab_edge:...]]` directives, then when
 * flag ON merge peer_ask edges from plain `@` tokens. Shared budget ≤2.
 */
export function attachPrimaryEdgesWithAssistantMentionConsumer(params: {
  primaryText: string;
  fromAgentId: string;
  bots: readonly CollaborationBotTarget[];
  taskId?: string | null;
  cfg?: OpenBotConfig;
}): {
  edges: CollabEdge[];
  /** Agent ids newly nominated via assistant @ consumer (not directive-only). */
  dispatchedAgentIds: string[];
  consumerActive: boolean;
} {
  const directive = parseCollabEdgesFromText({
    text: params.primaryText,
    fromAgentId: params.fromAgentId,
    taskId: params.taskId,
    resolveTargetAgentId: createCollabEdgeTargetResolver(params.bots),
  });
  const consumerActive = shouldDispatchAssistantMention(params.cfg);
  if (!consumerActive) {
    return {
      edges: directive.edges,
      dispatchedAgentIds: [],
      consumerActive: false,
    };
  }
  const plan = planAssistantMentionDispatch({
    text: params.primaryText,
    fromAgentId: params.fromAgentId,
    bots: params.bots,
    cfg: params.cfg,
  });
  if (!plan.allowed || plan.targets.length === 0) {
    return {
      edges: directive.edges,
      dispatchedAgentIds: [],
      consumerActive: true,
    };
  }
  const mentionEdges = buildAssistantMentionPeerAskEdges({
    fromAgentId: params.fromAgentId,
    targets: plan.targets,
  });
  // Directives win ordering; mention edges fill remaining budget slots.
  const merged = budgetCollabEdges([...directive.edges, ...mentionEdges]);
  // Prefer assistant_inline_at reason when the merged slot came from @ tokens.
  // If a directive already claimed the same toAgentId, budget keeps the directive.
  const dispatchedAgentIds = merged
    .filter((edge) => edge.reason === ASSISTANT_MENTION_EDGE_REASON)
    .map((edge) => edge.toAgentId);
  return {
    edges: merged,
    dispatchedAgentIds,
    consumerActive: true,
  };
}
