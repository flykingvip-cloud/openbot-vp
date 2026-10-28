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
 * R3–R5: when the reply contains DELIVERABLE, formal team submit uses
 * request.executionDeliverableBinding (no group+agent Map). Missing binding refuses.
 * Managed background auth uses service_execution only after active ownership SoT.
 * Space lookup is tenantId+groupId; lead bot has no bots[0] fallback.
 * R5: request/bag/binding scope must align; attempt must still be current wake-op attempt.
 * R6: production wake receipt requires agent, injected op/attempt, and request plan
 * binding (missing ≠ skip). runId must exactly match runIdFromWakeOpAttempt of
 * the injected claim, before the model and again before formal write.
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
import { readWakeOpRecord } from "./collaboration-dispatch/wake-op-ledger.js";
import {
  setWakeRoundDispatcher,
  type WakeRoundDispatchRequest,
} from "./collaboration-dispatch/wake-round-dispatch.js";
import { finalizeMemberRunTeamDeliverable } from "./collaboration-learning/chat-deliverable-team-submit.js";
import {
  executionBindingScopeMismatch,
  normalizeExecutionDeliverableBinding,
  productionWakeDeliverableContractFailure,
  type ExecutionDeliverableBinding,
} from "./collaboration-learning/execution-deliverable-binding.js";
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

/**
 * Scope failure for a normalized binding.
 * wake_dispatch uses the strict production contract (no empty-side skip,
 * runId recomputed from the injected claim). Other sources keep the loose compare.
 */
function deliverableBindingScopeFailure(params: {
  binding: ExecutionDeliverableBinding;
  request: WakeRoundDispatchRequest;
  tenantId: string | null;
  groupId: string;
  agentId: string;
  requireTenant: boolean;
}): string | null {
  const { binding, request } = params;
  if (binding.source === "wake_dispatch") {
    return productionWakeDeliverableContractFailure({
      binding,
      requireTenant: params.requireTenant,
      tenantId: params.tenantId,
      groupId: params.groupId,
      taskId: request.taskId,
      boardItemId: request.itemId,
      agentId: params.agentId,
      opKey: compact(request.wakeOpKey) || compact(request.opKey),
      attemptId: request.wakeExecutionAttemptId,
      planConfirmBinding: request.planConfirmBinding ?? null,
    });
  }
  return executionBindingScopeMismatch({
    binding,
    tenantId: params.tenantId,
    groupId: params.groupId,
    taskId: request.taskId,
    boardItemId: request.itemId,
    todolistId: request.planConfirmBinding?.todolistId,
    planVersion: request.planConfirmBinding?.confirmedVersion,
    stepId: request.planConfirmBinding?.stepId,
    agentId: params.agentId,
    attemptId: request.wakeExecutionAttemptId,
    opKey: request.wakeOpKey ?? request.opKey,
  });
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
  const requireManagedTenant = profile === "managed_enterprise";
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

  // R5: active ownership is the normative source for minting service_execution.
  // Space list snapshot alone must NEVER authorize background managed writes.
  let serviceTenant: CollaborationTenantResolution = { tenantId: null, trust: "none" };
  let tenantId: string | null = null;
  if (requestTenantId) {
    const owned = resolveCollaborationGroupTenantId(groupId, requestTenantId);
    const spaceTenant = compact(space.tenantId);
    if (!owned) {
      // Missing / revoked / unreadable ownership → refuse (no spaceTenant fallback).
      return null;
    }
    if (owned.toLowerCase() !== requestTenantId.toLowerCase()) {
      return null;
    }
    if (spaceTenant && spaceTenant.toLowerCase() !== requestTenantId.toLowerCase()) {
      return null;
    }
    tenantId = requestTenantId;
    serviceTenant = labelServiceExecutionTenant(tenantId);
  } else {
    // personal_local without request tenant: namespace only, no ACL-safe service mint.
    tenantId = compact(space.tenantId) || null;
    serviceTenant = { tenantId: null, trust: "none" };
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

  const bindingAtResolve = normalizeExecutionDeliverableBinding(
    request.executionDeliverableBinding ?? null,
  );
  if (request.executionDeliverableBinding && !bindingAtResolve) {
    // Incomplete production wake binding — refuse context rather than dispatch.
    return null;
  }
  if (bindingAtResolve) {
    // Before Mode B adopts binding.runId as roundId, and before the model.
    const scopeFail = deliverableBindingScopeFailure({
      binding: bindingAtResolve,
      request,
      tenantId,
      groupId,
      agentId: leadBot.agentId,
      requireTenant: requireManagedTenant,
    });
    if (scopeFail) {
      return null;
    }
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
        // Receipt gate before the model. A bad wake binding must not enter
        // getReplyFromConfig, and Mode B must not keep a forged runId.
        if (request.executionDeliverableBinding) {
          const bindingGate = normalizeExecutionDeliverableBinding(
            request.executionDeliverableBinding,
          );
          if (!bindingGate) {
            return {
              text: "团队成果未完成（execution_binding_required）。",
            };
          }
          const gateFail = deliverableBindingScopeFailure({
            binding: bindingGate,
            request,
            tenantId,
            groupId,
            agentId: bot.agentId,
            requireTenant: requireManagedTenant,
          });
          if (gateFail) {
            return {
              text: `团队成果未完成（execution_binding_scope:${gateFail}）。`,
            };
          }
        }

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
          if (!binding) {
            return {
              text: `${text.trim()}\n\n团队成果未完成（execution_binding_required）。`,
            };
          }
          const preScope = deliverableBindingScopeFailure({
            binding,
            request,
            tenantId,
            groupId,
            agentId: bot.agentId,
            requireTenant: requireManagedTenant,
          });
          if (preScope) {
            return {
              text: `${text.trim()}\n\n团队成果未完成（execution_binding_scope:${preScope}）。`,
            };
          }

          // Stale / superseded attempt: isolate as non-current delivery (no formal write).
          const opKey =
            compact(binding.opKey) || compact(request.wakeOpKey) || compact(request.opKey);
          const attemptId = compact(binding.attemptId);
          if (opKey && attemptId) {
            try {
              const wakeRec = await readWakeOpRecord({ authority, opKey, cfg });
              const currentAttempt = compact(wakeRec?.executionAttemptId);
              if (!currentAttempt || currentAttempt !== attemptId) {
                return {
                  text: `${text.trim()}\n\n团队成果未完成（execution_attempt_not_current）。`,
                };
              }
            } catch {
              return {
                text: `${text.trim()}\n\n团队成果未完成（execution_attempt_unreadable）。`,
              };
            }
          }

          let deliverAuth: Awaited<ReturnType<typeof authorizeTeamGroupResourceAccess>> | null =
            null;
          let deliverStores: ReturnType<typeof createTrustedGroupStores> | null = null;
          try {
            // Re-verify at composition root with service_execution tenant (ACL on).
            // serviceTenant is only minted after active ownership above.
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
