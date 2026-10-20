/**
 * Per-agent runtime health (readiness + channel connectivity).
 *
 * Why this exists: OpenBot agents run on-demand (a Pi session per message), so
 * there is no long-lived agent process to "ping" for liveness. The employee UI
 * previously showed 运行中/已暂停 derived purely from whether a recent session
 * existed — which is an activity heuristic, not health. This module computes an
 * *honest* health verdict from real, checkable facts:
 *
 *   1. Readiness  — does the agent have a resolvable model so it can run at all?
 *   2. Connectivity — for agents bound to inbound channels (Telegram/Discord/…),
 *      are those channel accounts actually connected on this gateway?
 *
 * The policy is a pure function so it is fully unit-testable and its semantics
 * are transparent. Fact gathering (config/routing/runtime snapshot) lives in a
 * separate gatherer so the flaky IO stays out of the decision logic.
 */

/** Honest per-agent runtime health verdict. */
export type AgentRuntimeHealth = "online" | "degraded" | "offline" | "unconfigured";

/** Real connection fact for one channel account an agent is routed from. */
export type AgentChannelBindingFact = {
  channelId: string;
  accountId: string;
  /** true only when the runtime snapshot reports the account running AND connected. */
  connected: boolean;
};

/** Minimal, real facts required to decide an agent's health. */
export type AgentRuntimeHealthFacts = {
  agentId: string;
  /**
   * Whether the agent has a resolvable model (its own `model` or a usable
   * global default). If false the agent cannot run regardless of channels.
   */
  modelConfigured: boolean;
  /** Channel accounts that route inbound traffic to this agent (may be empty). */
  boundChannels: AgentChannelBindingFact[];
};

export type AgentRuntimeHealthReport = {
  agentId: string;
  health: AgentRuntimeHealth;
  modelConfigured: boolean;
  boundChannelCount: number;
  connectedChannelCount: number;
  /** Machine-readable reason codes explaining the verdict (stable identifiers). */
  reasons: AgentRuntimeHealthReason[];
};

export type AgentRuntimeHealthReason =
  | "no-model-configured"
  | "no-bound-channels"
  | "all-bound-channels-connected"
  | "some-bound-channels-disconnected"
  | "all-bound-channels-disconnected";

/**
 * Decide an agent's runtime health from real facts. Pure and total.
 *
 * Policy (most-severe first):
 *  - `unconfigured`: no resolvable model → cannot run at all.
 *  - `offline`:      has bound channels but none are connected → unreachable via its channels.
 *  - `degraded`:     has bound channels, some (not all) connected → partially reachable.
 *  - `online`:       model ready and either no bound channels (reachable via web/direct)
 *                    or all bound channels connected.
 */
export function computeAgentRuntimeHealth(
  facts: AgentRuntimeHealthFacts,
): AgentRuntimeHealthReport {
  const boundChannelCount = facts.boundChannels.length;
  const connectedChannelCount = facts.boundChannels.filter((c) => c.connected).length;

  const base = {
    agentId: facts.agentId,
    modelConfigured: facts.modelConfigured,
    boundChannelCount,
    connectedChannelCount,
  };

  if (!facts.modelConfigured) {
    return { ...base, health: "unconfigured", reasons: ["no-model-configured"] };
  }
  if (boundChannelCount === 0) {
    // No inbound channel binding: the agent is reachable on-demand via web/direct,
    // so a ready model is honestly "online" (nothing to be disconnected from).
    return { ...base, health: "online", reasons: ["no-bound-channels"] };
  }
  if (connectedChannelCount === 0) {
    return { ...base, health: "offline", reasons: ["all-bound-channels-disconnected"] };
  }
  if (connectedChannelCount < boundChannelCount) {
    return { ...base, health: "degraded", reasons: ["some-bound-channels-disconnected"] };
  }
  return { ...base, health: "online", reasons: ["all-bound-channels-connected"] };
}
