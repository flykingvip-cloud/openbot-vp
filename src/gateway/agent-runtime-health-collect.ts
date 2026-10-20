/**
 * Fact collection for per-agent runtime health.
 *
 * This reads real state — effective model (readiness), route bindings
 * (agent↔channel), and the live channel runtime snapshot (connectivity) — and
 * feeds it into the pure {@link computeAgentRuntimeHealth} policy. The IO reads
 * are isolated here so the decision logic in `agent-runtime-health.ts` stays
 * pure and unit-testable.
 */

import { resolveAgentEffectiveModelPrimary } from "../agents/agent-scope.js";
import { normalizeChatChannelId } from "../channels/registry.js";
import type { OpenBotConfig } from "../config/config.js";
import { DEFAULT_ACCOUNT_ID, normalizeAccountId } from "../routing/account-id.js";
import { listBindings } from "../routing/bindings.js";
import { normalizeAgentId } from "../routing/session-key.js";
import {
  type AgentChannelBindingFact,
  type AgentRuntimeHealthReport,
  computeAgentRuntimeHealth,
} from "./agent-runtime-health.js";
import { isRecord } from "./records.js";
import type { ChannelRuntimeSnapshot } from "./server-channels.js";

/** A channel account counts as connected only when it is both running and connected. */
export function isChannelAccountConnected(
  snapshot: { running?: unknown; connected?: unknown } | undefined | null,
): boolean {
  return Boolean(snapshot?.running && snapshot?.connected);
}

/** Keep the original flag values, including non-booleans, after an object check. */
function connectionFlags(value: unknown): { running?: unknown; connected?: unknown } | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  return { running: value.running, connected: value.connected };
}

/**
 * Resolve the distinct (channel, account) pairs that route inbound traffic to
 * an agent, from the config route bindings. Wildcard-account bindings are
 * skipped (they are not a concrete account to check connectivity for).
 */
export function resolveAgentBoundChannelRefs(
  cfg: OpenBotConfig,
  agentId: string,
): Array<{ channelId: string; accountId: string }> {
  const target = normalizeAgentId(agentId);
  const refs = new Map<string, { channelId: string; accountId: string }>();
  for (const binding of listBindings(cfg)) {
    if (normalizeAgentId(binding.agentId) !== target) {
      continue;
    }
    const rawChannel = binding.match?.channel;
    const channelId = normalizeChatChannelId(rawChannel) ?? (rawChannel ?? "").trim().toLowerCase();
    if (!channelId) {
      continue;
    }
    const rawAccount = binding.match?.accountId?.trim();
    if (rawAccount === "*") {
      continue;
    }
    const accountId = normalizeAccountId(rawAccount || DEFAULT_ACCOUNT_ID);
    refs.set(`${channelId}::${accountId}`, { channelId, accountId });
  }
  return [...refs.values()];
}

/**
 * Look up the runtime connection snapshot for a (channel, account), mirroring
 * `channels.status`: prefer the per-account entry, and for the default account
 * fall back to the channel-level snapshot.
 */
function lookupAccountConnection(
  runtime: ChannelRuntimeSnapshot,
  channelId: string,
  accountId: string,
): { running?: unknown; connected?: unknown } | undefined {
  const channelAccounts = isRecord(runtime.channelAccounts) ? runtime.channelAccounts : undefined;
  const channels = isRecord(runtime.channels) ? runtime.channels : undefined;
  const byChannel = channelAccounts?.[channelId];
  const direct = connectionFlags(isRecord(byChannel) ? byChannel[accountId] : undefined);
  if (direct) {
    return direct;
  }
  if (accountId === DEFAULT_ACCOUNT_ID) {
    return connectionFlags(channels?.[channelId]);
  }
  return undefined;
}

/**
 * Pure orchestrator: build health reports from injected fact resolvers. Kept
 * pure so the readiness/connectivity → health mapping is fully unit-testable
 * without touching config/routing/runtime IO.
 */
export function buildAgentRuntimeHealthReports(params: {
  agentIds: string[];
  isModelConfigured: (agentId: string) => boolean;
  resolveBoundChannels: (agentId: string) => Array<{ channelId: string; accountId: string }>;
  isChannelConnected: (channelId: string, accountId: string) => boolean;
}): AgentRuntimeHealthReport[] {
  const seen = new Set<string>();
  const reports: AgentRuntimeHealthReport[] = [];
  for (const rawId of params.agentIds) {
    const agentId = normalizeAgentId(rawId);
    if (!agentId || seen.has(agentId)) {
      continue;
    }
    seen.add(agentId);
    const boundChannels: AgentChannelBindingFact[] = params
      .resolveBoundChannels(agentId)
      .map((ref) => ({
        channelId: ref.channelId,
        accountId: ref.accountId,
        connected: params.isChannelConnected(ref.channelId, ref.accountId),
      }));
    reports.push(
      computeAgentRuntimeHealth({
        agentId,
        modelConfigured: params.isModelConfigured(agentId),
        boundChannels,
      }),
    );
  }
  return reports;
}

/**
 * Collect real per-agent runtime health from config + routing + the live
 * channel runtime snapshot.
 */
export function collectAgentRuntimeHealth(params: {
  cfg: OpenBotConfig;
  agentIds: string[];
  runtimeSnapshot: ChannelRuntimeSnapshot;
}): AgentRuntimeHealthReport[] {
  return buildAgentRuntimeHealthReports({
    agentIds: params.agentIds,
    isModelConfigured: (agentId) => Boolean(resolveAgentEffectiveModelPrimary(params.cfg, agentId)),
    resolveBoundChannels: (agentId) => resolveAgentBoundChannelRefs(params.cfg, agentId),
    isChannelConnected: (channelId, accountId) =>
      isChannelAccountConnected(
        lookupAccountConnection(params.runtimeSnapshot, channelId, accountId),
      ),
  });
}
