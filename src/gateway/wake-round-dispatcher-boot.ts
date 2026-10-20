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
import { resolveCollaborationGroupTenantId } from "./collaboration-learning/shared.js";
import { listGatewayCollaborationSpaces } from "./collaboration-learning/space-store.js";

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

async function resolveModeBWakeRoundContext(
  request: WakeRoundDispatchRequest,
  cfg: OpenBotConfig,
): Promise<ModeBWakeRoundContext | null> {
  const groupId = compact(request.groupId);
  if (!groupId) {
    return null;
  }

  let spaces: Awaited<ReturnType<typeof listGatewayCollaborationSpaces>>;
  try {
    spaces = await listGatewayCollaborationSpaces();
  } catch {
    return null;
  }

  const space =
    spaces.spaces.find(
      (entry) =>
        entry.groupId.trim().toLowerCase() === groupId.toLowerCase() ||
        entry.id
          .trim()
          .toLowerCase()
          .replace(/^space:/, "") === groupId.toLowerCase(),
    ) ?? null;
  if (!space) {
    return null;
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

  const leadBot =
    resolveWakeLeadBot({
      toAgentIds: request.toAgentIds,
      bots,
    }) ??
    bots[0] ??
    null;
  if (!leadBot) {
    return null;
  }

  const tenantId =
    compact(request.tenantId) ||
    compact(space.tenantId) ||
    resolveCollaborationGroupTenantId(groupId) ||
    null;

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
        const text = replyTextFromResult(result);
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
