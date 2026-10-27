/**
 * P0-2 follow-up — bind Mode B wake→round dispatcher at gateway boot.
 *
 * #858 added consumeWakeForRoundDispatch + createModeBWakeRoundDispatcher but left
 * the process registry unbound (outcome stayed `recorded`). This composition-root
 * wires setWakeRoundDispatcher once at start; gray execute allowlist + wakeContract
 * still gate dispatch. Unbind on stop so tests / restarts fall back to recorded.
 *
 * Reuses executeCollaborationRound via Mode B dispatcher — no second orchestrator.
 * runBot uses getReplyFromConfig (same E1 path as heartbeat), not chat.send.
 * R3/R4: when the reply contains DELIVERABLE, formal team submit uses
 * request.executionDeliverableBinding (no group+agent Map). Missing binding refuses.
 * Managed background auth uses service_execution (not actor_fallback / fake membership).
 * Space lookup is tenantId+groupId; lead bot has no bots[0] fallback.
 */
import { getReplyFromConfig } from "../auto-reply/reply.js";
import type { ReplyPayload } from "../auto-reply/types.js";
import { loadConfig } from "../config/config.js";
import type { OpenBotConfig } from "../config/types.js";
import { toCollaborationSpaceSessionKey } from "../sessions/session-key-utils.js";
import { episodeIdForClientRun } from "./collaboration-dispatch/collaboration-event-key.js";
import {
  createModeBWakeRoundDispatcher,
  resolveWakeLeadBot,
  type ModeBWakeRoundContext,
} from "./collaboration-dispatch/mode-b-wake-round-dispatcher.js";
import { buildGroupRuntimeAuthority } from "./collaboration-dispatch/runtime-authority.js";
import type {
  CollaborationBotTarget,
  CollaborationDispatchScope,
} from "./collaboration-dispatch/types.js";
import {
  setWakeRoundDispatcher,
  type WakeRoundDispatchRequest,
} from "./collaboration-dispatch/wake-round-dispatch.js";
import { finalizeMemberRunTeamDeliverable } from "./collaboration-learning/chat-deliverable-team-submit.js";
import { normalizeExecutionDeliverableBinding } from "./collaboration-learning/execution-deliverable-binding.js";
import { resolveCollaborationGroupTenantId } from "./collaboration-learning/shared.js";
import { listGatewayCollaborationSpaces } from "./collaboration-learning/space-store.js";
import {
  authorizeTeamGroupResourceAccess,
  createTrustedGroupStores,
} from "./collaboration-learning/team-resource-auth.js";
import {
  labelServiceExecutionTenant,
  type CollaborationTenantResolution,
} from "./collaboration-learning/trusted-tenant.js";
import { resolveSecurityProfile } from "./security-profile.js";

function compact(value: string | null | undefined): string {
  return value?.trim() ?? "";
}

function replyTextFromResult(
  result: ReplyPayload | ReplyPayload[] | undefined,
): string | undefined {
  const payloads = Array.isArray(result) ? result : result ? [result] : [];
  const parts = payloads
    .map((entry) => (typeof entry?.text === "string" ? entry.text.trim() : ""))
    .filter(Boolean);
  return parts.length > 0 ? parts.join("\n\n") : undefined;
}

function buildWakeMessage(params: { request: WakeRoundDispatchRequest; leadName: string }): string {
  const prompt = compact(params.request.dispatchPrompt);
  if (prompt) {
    return prompt;
  }
  const reason = compact(params.request.reason) || `wake:${params.request.source}`;
  return [
    `【Mode B 自推进】来源=${params.request.source}`,
    params.request.taskId ? `task=${params.request.taskId}` : null,
    params.request.itemId ? `board=${params.request.itemId}` : null,
    `请继续推进你认领的看板项（责任人 ${params.leadName}）。`,
    reason,
  ]
    .filter(Boolean)
    .join("\n");
}

/** Exported for product-wiring E2E: boot context → member run → deliverable final. */
export async function resolveModeBWakeRoundContext(
  request: WakeRoundDispatchRequest,
  cfg: OpenBotConfig,
): Promise<ModeBWakeRoundContext | null> {
  const groupId = compact(request.groupId);
  if (!groupId) {
    return null;
  }

  const profile = resolveSecurityProfile(cfg).profile;
  const requestTenantId = compact(request.tenantId);
  // Managed background wake must carry a durable tenant; never guess from groupId alone.
  if (profile === "managed_enterprise" && !requestTenantId) {
    return null;
  }

  let spaces: Awaited<ReturnType<typeof listGatewayCollaborationSpaces>>;
  try {
    spaces = await listGatewayCollaborationSpaces();
  } catch {
    return null;
  }

  const groupKey = groupId.toLowerCase();
  const tenantKey = requestTenantId.toLowerCase();
  const matches = spaces.spaces.filter((entry) => {
    const entryGroup = compact(entry.groupId).toLowerCase();
    const entryId = compact(entry.id)
      .toLowerCase()
      .replace(/^space:/, "");
    const groupMatch = entryGroup === groupKey || entryId === groupKey;
    if (!groupMatch) {
      return false;
    }
    const entryTenant = compact(entry.tenantId).toLowerCase();
    if (tenantKey) {
      // Trusted tenantId + groupId — never accept another tenant's same local groupId.
      return entryTenant === tenantKey;
    }
    // personal_local without request tenant: only spaces that are not tenant-owned.
    return !entryTenant;
  });
  if (matches.length !== 1) {
    return null;
  }
  const space = matches[0];

  // Re-verify durable ownership when a tenant was requested (fail closed on mismatch).
  if (requestTenantId) {
    const owned = resolveCollaborationGroupTenantId(groupId, requestTenantId);
    const spaceTenant = compact(space.tenantId);
    if (owned && owned.toLowerCase() !== requestTenantId.toLowerCase()) {
      return null;
    }
    if (spaceTenant && spaceTenant.toLowerCase() !== requestTenantId.toLowerCase()) {
      return null;
    }
    // When ownership SoT has an active record for a different binding, owned is null
    // for this pair — refuse rather than fall through to another group.
    if (!owned && !spaceTenant) {
      return null;
    }
  }

  const sessionKey = toCollaborationSpaceSessionKey(groupId);
  if (!sessionKey) {
    return null;
  }

  const bots: CollaborationBotTarget[] = (space.members?.bots ?? [])
    .filter((bot) => compact(bot.agentId) && bot.status === "active")
    .map((bot) => ({
      agentId: bot.agentId.trim(),
      name: bot.name?.trim() || bot.agentId.trim(),
      sessionKey,
      updatedAt: 0,
    }));

  // No bots[0] fallback — request target must resolve inside THIS tenant's members.
  const leadBot = resolveWakeLeadBot({
    toAgentIds: request.toAgentIds,
    bots,
  });
  if (!leadBot) {
    return null;
  }

  const tenantId = requestTenantId || compact(space.tenantId) || null;

  // Background service identity (not interactive membership, not actor_fallback).
  const serviceTenant: CollaborationTenantResolution = tenantId
    ? labelServiceExecutionTenant(tenantId)
    : { tenantId: null, trust: "none" };

  const bindingAtResolve = normalizeExecutionDeliverableBinding(
    request.executionDeliverableBinding ?? null,
  );
  if (request.executionDeliverableBinding && !bindingAtResolve) {
    // Incomplete production wake binding — refuse context rather than dispatch.
    return null;
  }
  if (bindingAtResolve?.tenantId && tenantId) {
    if (compact(bindingAtResolve.tenantId).toLowerCase() !== tenantId.toLowerCase()) {
      return null;
    }
  }
  if (bindingAtResolve && compact(bindingAtResolve.groupId).toLowerCase() !== groupKey) {
    return null;
  }

  const scope: CollaborationDispatchScope = {
    groupId,
    rawSessionKey: sessionKey,
    title: space.title?.trim() || groupId,
    bots,
    tenantId,
    ...(space.members ? { members: space.members } : {}),
    ...(space.operatingState !== undefined && space.operatingState !== null
      ? { operatingState: space.operatingState }
      : { operatingState: null }),
    ...(compact(space.coordinatorBotId)
      ? { coordinatorBotId: compact(space.coordinatorBotId) }
      : {}),
  };

  const { authority, facts } = buildGroupRuntimeAuthority({
    scope,
    episodeId: episodeIdForClientRun(`wake-dispatch:${groupId}:${request.source}`),
    cfg,
    tenantTrust: serviceTenant.trust,
  });

  const message = buildWakeMessage({ request, leadName: leadBot.name });

  return {
    authority,
    facts,
    sessionKey,
    leadBot,
    cfg,
    message,
    runBot: async ({ bot }) => {
      try {
        const result = await getReplyFromConfig(
          {
            Body: message,
            SessionKey: sessionKey,
            Provider: "wake-round-dispatch",
            CollaborationBotAgentId: bot.agentId,
            CollaborationGroupId: groupId,
            CollaborationTenantId: tenantId ?? undefined,
            CollaborationRoundInvoked: true,
            WasMentioned: true,
            GroupSubject: scope.title,
          },
          {},
          cfg,
        );
        let text = replyTextFromResult(result);
        if (text && text.includes("DELIVERABLE")) {
          const binding = normalizeExecutionDeliverableBinding(
            request.executionDeliverableBinding ?? null,
          );
          let deliverAuth: Awaited<ReturnType<typeof authorizeTeamGroupResourceAccess>> | null =
            null;
          let deliverStores: ReturnType<typeof createTrustedGroupStores> | null = null;
          try {
            // Re-verify at composition root with service_execution tenant (ACL on).
            deliverAuth = await authorizeTeamGroupResourceAccess({
              groupId,
              actor: bot.agentId,
              tenant: serviceTenant,
              action: "write",
              cfg,
            });
            if (deliverAuth.ok) {
              deliverStores = createTrustedGroupStores({
                groupsRoot: deliverAuth.groupsRoot,
                groupLocator: deliverAuth.groupLocator,
              });
            }
          } catch {
            deliverAuth = null;
          }
          const finalized = await finalizeMemberRunTeamDeliverable({
            text,
            agentId: bot.agentId,
            binding,
            tenant: serviceTenant,
            auth: deliverAuth && deliverAuth.ok ? deliverAuth : null,
            trusted:
              deliverAuth && deliverAuth.ok
                ? {
                    groupsRoot: deliverAuth.groupsRoot,
                    groupLocator: deliverAuth.groupLocator,
                  }
                : null,
            stores: deliverStores,
            cfg,
            // Production boot keeps resource ACL enforced.
            enforceAcl: true,
          });
          text = finalized.text;
        }
        return text ? { text } : undefined;
      } catch {
        // Mirror chat runStageBot: bot failure must not throw out of
        // executeCollaborationRound (would force wake outcome recorded).
        return undefined;
      }
    },
  };
}

/** Bind process-wide Mode B wake→round dispatcher (gateway boot). */
export function bindGatewayWakeRoundDispatcher(opts?: { cfg?: OpenBotConfig }): void {
  const cfgAtBind = opts?.cfg;
  const dispatcher = createModeBWakeRoundDispatcher(async (request) => {
    const cfg = cfgAtBind ?? loadConfig();
    return resolveModeBWakeRoundContext(request, cfg);
  });
  setWakeRoundDispatcher(dispatcher);
}

/** Clear process registry (gateway stop / tests). */
export function unbindGatewayWakeRoundDispatcher(): void {
  setWakeRoundDispatcher(null);
}
