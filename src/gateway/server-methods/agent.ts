import { randomUUID } from "node:crypto";
import { listAgentIds } from "../../agents/agent-scope.js";
import type { AgentInternalEvent } from "../../agents/internal-events.js";
import {
  normalizeSpawnedRunMetadata,
  resolveIngressWorkspaceOverrideForSpawnedRun,
} from "../../agents/spawned-context.js";
import { buildBareSessionResetPrompt } from "../../auto-reply/reply/session-reset-prompt.js";
import { agentCommandFromIngress } from "../../commands/agent.js";
import { loadConfig } from "../../config/config.js";
import { withOperatorStateScope } from "../../config/operator-state-scope.js";
import {
  mergeSessionEntry,
  resolveAgentIdFromSessionKey,
  resolveExplicitAgentSessionKey,
  resolveAgentMainSessionKey,
  type SessionEntry,
  updateSessionStore,
} from "../../config/sessions.js";
import { extractEmployeeStewardUserId } from "../../diagnosis/diagnose-conversation.js";
import { registerAgentRunContext } from "../../infra/agent-events.js";
import {
  resolveAgentDeliveryPlan,
  resolveAgentOutboundTarget,
} from "../../infra/outbound/agent-delivery.js";
import { resolveMessageChannelSelection } from "../../infra/outbound/channel-selection.js";
import { classifySessionKeyShape, normalizeAgentId } from "../../routing/session-key.js";
import { defaultRuntime } from "../../runtime.js";
import { normalizeInputProvenance, type InputProvenance } from "../../sessions/input-provenance.js";
import { resolveSendPolicy } from "../../sessions/send-policy.js";
import { normalizeSessionDeliveryFields } from "../../utils/delivery-context.js";
import {
  INTERNAL_MESSAGE_CHANNEL,
  isDeliverableMessageChannel,
  isGatewayMessageChannel,
  normalizeMessageChannel,
} from "../../utils/message-channel.js";
import { resolveAssistantIdentity } from "../assistant-identity.js";
import { type ChatImageContent, parseMessageWithAttachments } from "../chat-attachments.js";
import { resolveAssistantAvatarUrl } from "../control-ui-shared.js";
import {
  createExecutionIdentityFromGatewayClient,
  hasAuthenticatedIdentity,
  inheritExecutionIdentityRunFields,
} from "../execution-identity-context.js";
import {
  peekStagedSpawnExecutionIdentity,
  takeStagedSpawnExecutionIdentity,
} from "../execution-identity-handoff.js";
import { recordAgentInvocationShadow } from "../governance/agent-invocation-shadow.js";
import { takeStagedSpawnGovernanceSnapshot } from "../governance/spawn-snapshot-handoff.js";
import { ADMIN_SCOPE } from "../method-scopes.js";
import { GATEWAY_CLIENT_CAPS, hasGatewayClientCap } from "../protocol/client-info.js";
import {
  ErrorCodes,
  errorShape,
  formatValidationErrors,
  validateAgentIdentityParams,
  validateAgentParams,
  validateAgentWaitParams,
} from "../protocol/index.js";
import { performGatewaySessionReset } from "../session-reset-service.js";
import {
  canonicalizeSpawnedByForAgent,
  pruneLegacyStoreKeys,
  resolveGatewaySessionStoreTarget,
} from "../session-utils.js";
import { gatewayClientForSessionOwner, loadSessionEntryForClient } from "../tenant-context.js";
import { hydrateWebchatGatewayClientPlatformIdentity } from "../webchat-client-platform-identity.js";
import { formatForLog } from "../ws-log.js";
import { waitForAgentJob } from "./agent-job.js";
import { injectTimestamp, timestampOptsFromConfig } from "./agent-timestamp.js";
import {
  readTerminalSnapshotFromGatewayDedupe,
  setGatewayDedupeEntry,
  type AgentWaitTerminalSnapshot,
  waitForTerminalGatewayDedupe,
} from "./agent-wait-dedupe.js";
import { stageImagesAsMediaAttachmentNotes } from "./attachment-media.js";
import { normalizeRpcAttachmentsToChatAttachments } from "./attachment-normalize.js";
import {
  getIdempotencyInflightMap,
  type IdempotencyInflightResult,
} from "./idempotency-inflight.js";
import {
  classifyIdempotencyReplay,
  fingerprintIdempotencyPayload,
  idempotencyPayloadConflictError,
} from "./idempotency-payload.js";
import type { GatewayRequestHandlerOptions, GatewayRequestHandlers, RespondFn } from "./types.js";

const RESET_COMMAND_RE = /^\/(new|reset)(?:\s+([\s\S]*))?$/i;

function resolveSenderIsOwnerFromClient(client: GatewayRequestHandlerOptions["client"]): boolean {
  const scopes = Array.isArray(client?.connect?.scopes) ? client.connect.scopes : [];
  return scopes.includes(ADMIN_SCOPE);
}

async function runSessionResetFromAgent(params: {
  key: string;
  reason: "new" | "reset";
  client: GatewayRequestHandlerOptions["client"];
}): Promise<
  | { ok: true; key: string; sessionId?: string }
  | { ok: false; error: ReturnType<typeof errorShape> }
> {
  const result = await performGatewaySessionReset({
    key: params.key,
    reason: params.reason,
    commandSource: "gateway:agent",
    client: params.client,
  });
  if (!result.ok) {
    return result;
  }
  return {
    ok: true,
    key: result.key,
    sessionId: result.entry.sessionId,
  };
}

function dispatchAgentRunFromGateway(params: {
  ingressOpts: Parameters<typeof agentCommandFromIngress>[0];
  runId: string;
  idempotencyKey: string;
  payloadFingerprint: string;
  respond: GatewayRequestHandlerOptions["respond"];
  context: GatewayRequestHandlerOptions["context"];
}) {
  void agentCommandFromIngress(params.ingressOpts, defaultRuntime, params.context.deps)
    .then((result) => {
      const payload = {
        runId: params.runId,
        status: "ok" as const,
        summary: "completed",
        result,
      };
      setGatewayDedupeEntry({
        dedupe: params.context.dedupe,
        key: `agent:${params.idempotencyKey}`,
        entry: {
          ts: Date.now(),
          ok: true,
          payload,
          payloadFingerprint: params.payloadFingerprint,
        },
      });
      // Send a second res frame (same id) so TS clients with expectFinal can wait.
      // Swift clients will typically treat the first res as the result and ignore this.
      params.respond(true, payload, undefined, { runId: params.runId });
    })
    .catch((err) => {
      const error = errorShape(ErrorCodes.UNAVAILABLE, String(err));
      const payload = {
        runId: params.runId,
        status: "error" as const,
        summary: String(err),
      };
      setGatewayDedupeEntry({
        dedupe: params.context.dedupe,
        key: `agent:${params.idempotencyKey}`,
        entry: {
          ts: Date.now(),
          ok: false,
          payload,
          error,
          payloadFingerprint: params.payloadFingerprint,
        },
      });
      params.respond(false, payload, error, {
        runId: params.runId,
        error: formatForLog(err),
      });
    });
}

export const agentHandlers: GatewayRequestHandlers = {
  agent: async ({ params, respond: rawRespond, context, client, isWebchatConnect }) => {
    await hydrateWebchatGatewayClientPlatformIdentity({ client });
    const p = params;
    if (!validateAgentParams(p)) {
      rawRespond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          `invalid agent params: ${formatValidationErrors(validateAgentParams.errors)}`,
        ),
      );
      return;
    }
    const request = p as {
      message: string;
      agentId?: string;
      to?: string;
      replyTo?: string;
      sessionId?: string;
      sessionKey?: string;
      thinking?: string;
      deliver?: boolean;
      attachments?: Array<{
        type?: string;
        mimeType?: string;
        fileName?: string;
        content?: unknown;
      }>;
      channel?: string;
      replyChannel?: string;
      accountId?: string;
      replyAccountId?: string;
      threadId?: string;
      groupId?: string;
      groupChannel?: string;
      groupSpace?: string;
      lane?: string;
      extraSystemPrompt?: string;
      internalEvents?: AgentInternalEvent[];
      idempotencyKey: string;
      timeout?: number;
      bestEffortDeliver?: boolean;
      label?: string;
      spawnedBy?: string;
      inputProvenance?: InputProvenance;
      workspaceDir?: string;
      modelFallbacks?: string[];
    };
    const senderIsOwner = resolveSenderIsOwnerFromClient(client);
    const cfg = loadConfig();
    const idem = request.idempotencyKey;
    const normalizedSpawned = normalizeSpawnedRunMetadata({
      spawnedBy: request.spawnedBy,
      groupId: request.groupId,
      groupChannel: request.groupChannel,
      groupSpace: request.groupSpace,
      workspaceDir: request.workspaceDir,
    });
    let resolvedGroupId: string | undefined = normalizedSpawned.groupId;
    let resolvedGroupChannel: string | undefined = normalizedSpawned.groupChannel;
    let resolvedGroupSpace: string | undefined = normalizedSpawned.groupSpace;
    let spawnedByValue = normalizedSpawned.spawnedBy;
    const inputProvenance = normalizeInputProvenance(request.inputProvenance);
    const socketHasOwner = Boolean(client?.user?.trim() || client?.platformUserId?.trim());
    const interSessionOwner =
      inputProvenance?.kind === "inter_session"
        ? inputProvenance.sourcePlatformUserId?.trim() ||
          extractEmployeeStewardUserId(inputProvenance.sourceSessionKey) ||
          undefined
        : undefined;
    // A spawned child arrives over the loopback `agent` RPC, which carries no
    // Control UI cookie, so `client` has no identity. The parent tool already
    // staged its frozen identity against this idempotency key — read it (without
    // consuming it; dispatch below still takes it) so the tenant-scoped session
    // store can be resolved. Without this, loading the child session key fails
    // with `unresolved_tenant` under OPENBOT_MULTITENANT and every spawn, steer,
    // and inter-session send is refused.
    const stagedSpawnIdentity = peekStagedSpawnExecutionIdentity(idem);
    const sessionClient = gatewayClientForSessionOwner(
      client,
      socketHasOwner
        ? undefined
        : (interSessionOwner ?? stagedSpawnIdentity?.platformUserId?.trim() ?? undefined),
      "employee",
      socketHasOwner ? undefined : stagedSpawnIdentity?.user?.trim() || undefined,
    );
    const routeSessionToOwner = sessionClient !== client && sessionClient != null;
    // Backend/device-token callers run under the wrong operator ALS (pairedDeviceId).
    // Inter-session / spawn deliveries must write into the owner's operator store so
    // enterprise Control UI reads the same transcript the recipient chat opens.
    const ownerScopeForUnboundAgent =
      !client?.user?.trim() && !client?.platformUserId?.trim()
        ? (interSessionOwner ?? (stagedSpawnIdentity?.platformUserId?.trim() || undefined))
        : undefined;
    const payloadFingerprint = fingerprintIdempotencyPayload(request);
    const replay = classifyIdempotencyReplay(
      context.dedupe.get(`agent:${idem}`),
      payloadFingerprint,
    );
    if (replay.kind === "conflict") {
      rawRespond(false, undefined, idempotencyPayloadConflictError());
      return;
    }
    if (replay.kind === "replay") {
      rawRespond(replay.entry.ok, replay.entry.payload, replay.entry.error, {
        cached: true,
      });
      return;
    }

    // Pre-accept in-flight join: concurrent same-key same-payload waits for the
    // first request's accept/error instead of racing a second dispatch.
    const agentDedupeKey = `agent:${idem}`;
    const inflightMap = getIdempotencyInflightMap(context);
    const existingInflight = inflightMap.get(agentDedupeKey);
    if (existingInflight) {
      if (existingInflight.payloadFingerprint !== payloadFingerprint) {
        rawRespond(false, undefined, idempotencyPayloadConflictError());
        return;
      }
      const result = await existingInflight.promise;
      const meta = result.meta ? { ...result.meta, cached: true } : { cached: true };
      rawRespond(result.ok, result.payload, result.error, meta);
      return;
    }
    let settleInflight!: (result: IdempotencyInflightResult) => void;
    const inflightPromise = new Promise<IdempotencyInflightResult>((resolve) => {
      settleInflight = resolve;
    });
    inflightMap.set(agentDedupeKey, {
      payloadFingerprint,
      promise: inflightPromise,
    });
    let settled = false;
    const respond: RespondFn = (ok, payload, error, meta) => {
      if (!settled) {
        settled = true;
        settleInflight({ ok, payload, error, meta });
        inflightMap.delete(agentDedupeKey);
      }
      if (meta === undefined) {
        rawRespond(ok, payload, error);
      } else {
        rawRespond(ok, payload, error, meta);
      }
    };

    try {
      const runAgentTurn = async (): Promise<void> => {
        const normalizedAttachments = normalizeRpcAttachmentsToChatAttachments(request.attachments);
        const requestedBestEffortDeliver =
          typeof request.bestEffortDeliver === "boolean" ? request.bestEffortDeliver : undefined;

        let message = (request.message ?? "").trim();
        let images: ChatImageContent[] = [];
        if (normalizedAttachments.length > 0) {
          try {
            const parsed = await parseMessageWithAttachments(message, normalizedAttachments, {
              log: context.logGateway,
            });
            message = parsed.message.trim();
            images = parsed.images;
            const mediaNote = await stageImagesAsMediaAttachmentNotes({
              images,
              files: parsed.files,
              runId: idem,
              log: context.logGateway,
              label: "agent",
            });
            if (mediaNote) {
              message = [mediaNote, message].filter(Boolean).join("\n\n");
            }
          } catch (err) {
            respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, String(err)));
            return;
          }
        }

        const isKnownGatewayChannel = (value: string): boolean => isGatewayMessageChannel(value);
        const channelHints = [request.channel, request.replyChannel]
          .filter((value): value is string => typeof value === "string")
          .map((value) => value.trim())
          .filter(Boolean);
        for (const rawChannel of channelHints) {
          const normalized = normalizeMessageChannel(rawChannel);
          if (normalized && normalized !== "last" && !isKnownGatewayChannel(normalized)) {
            respond(
              false,
              undefined,
              errorShape(
                ErrorCodes.INVALID_REQUEST,
                `invalid agent params: unknown channel: ${String(normalized)}`,
              ),
            );
            return;
          }
        }

        const agentIdRaw = typeof request.agentId === "string" ? request.agentId.trim() : "";
        const agentId = agentIdRaw ? normalizeAgentId(agentIdRaw) : undefined;
        if (agentId) {
          const knownAgents = listAgentIds(cfg);
          if (!knownAgents.includes(agentId)) {
            respond(
              false,
              undefined,
              errorShape(
                ErrorCodes.INVALID_REQUEST,
                `invalid agent params: unknown agent id "${request.agentId}"`,
              ),
            );
            return;
          }
        }

        const requestedSessionKeyRaw =
          typeof request.sessionKey === "string" && request.sessionKey.trim()
            ? request.sessionKey.trim()
            : undefined;
        if (
          requestedSessionKeyRaw &&
          classifySessionKeyShape(requestedSessionKeyRaw) === "malformed_agent"
        ) {
          respond(
            false,
            undefined,
            errorShape(
              ErrorCodes.INVALID_REQUEST,
              `invalid agent params: malformed session key "${requestedSessionKeyRaw}"`,
            ),
          );
          return;
        }
        let requestedSessionKey =
          requestedSessionKeyRaw ??
          resolveExplicitAgentSessionKey({
            cfg,
            agentId,
          });
        if (agentId && requestedSessionKeyRaw) {
          const sessionAgentId = resolveAgentIdFromSessionKey(requestedSessionKeyRaw);
          if (sessionAgentId !== agentId) {
            respond(
              false,
              undefined,
              errorShape(
                ErrorCodes.INVALID_REQUEST,
                `invalid agent params: agent "${request.agentId}" does not match session key agent "${sessionAgentId}"`,
              ),
            );
            return;
          }
        }
        let resolvedSessionId = request.sessionId?.trim() || undefined;
        let sessionEntry: SessionEntry | undefined;
        let bestEffortDeliver = requestedBestEffortDeliver ?? false;
        let cfgForAgent: ReturnType<typeof loadConfig> | undefined;
        let resolvedSessionKey = requestedSessionKey;
        let skipTimestampInjection = false;

        const resetCommandMatch = message.match(RESET_COMMAND_RE);
        if (resetCommandMatch && requestedSessionKey) {
          const resetReason = resetCommandMatch[1]?.toLowerCase() === "new" ? "new" : "reset";
          const resetResult = await runSessionResetFromAgent({
            key: requestedSessionKey,
            reason: resetReason,
            client,
          });
          if (!resetResult.ok) {
            respond(false, undefined, resetResult.error);
            return;
          }
          requestedSessionKey = resetResult.key;
          resolvedSessionId = resetResult.sessionId ?? resolvedSessionId;
          const postResetMessage = resetCommandMatch[2]?.trim() ?? "";
          if (postResetMessage) {
            message = postResetMessage;
          } else {
            // Keep bare /new and /reset behavior aligned with chat.send:
            // reset first, then run a fresh-session greeting prompt in-place.
            // Date is embedded in the prompt so agents read the correct daily
            // memory files; skip further timestamp injection to avoid duplication.
            message = buildBareSessionResetPrompt(cfg);
            skipTimestampInjection = true;
          }
        }

        // Inject timestamp into user-authored messages that don't already have one.
        // Channel messages (Discord, Telegram, etc.) get timestamps via envelope
        // formatting in a separate code path — they never reach this handler.
        // See: https://github.com/moltbot/moltbot/issues/3658
        if (!skipTimestampInjection) {
          message = injectTimestamp(message, timestampOptsFromConfig(cfg));
        }

        if (requestedSessionKey) {
          const { cfg, storePath, entry, canonicalKey } = await loadSessionEntryForClient(
            requestedSessionKey,
            routeSessionToOwner ? sessionClient : client,
          );
          cfgForAgent = cfg;
          const now = Date.now();
          const sessionId = entry?.sessionId ?? randomUUID();
          const labelValue = request.label?.trim() || entry?.label;
          const sessionAgent = resolveAgentIdFromSessionKey(canonicalKey);
          spawnedByValue = canonicalizeSpawnedByForAgent(
            cfg,
            sessionAgent,
            spawnedByValue || entry?.spawnedBy,
          );
          let inheritedGroup:
            | { groupId?: string; groupChannel?: string; groupSpace?: string }
            | undefined;
          if (
            spawnedByValue &&
            (!resolvedGroupId || !resolvedGroupChannel || !resolvedGroupSpace)
          ) {
            try {
              const parentLoaded = await loadSessionEntryForClient(
                spawnedByValue,
                routeSessionToOwner ? sessionClient : client,
              );
              const parentEntry = parentLoaded.entry;
              inheritedGroup = {
                groupId: parentEntry?.groupId,
                groupChannel: parentEntry?.groupChannel,
                groupSpace: parentEntry?.space,
              };
            } catch {
              inheritedGroup = undefined;
            }
          }
          resolvedGroupId = resolvedGroupId || inheritedGroup?.groupId;
          resolvedGroupChannel = resolvedGroupChannel || inheritedGroup?.groupChannel;
          resolvedGroupSpace = resolvedGroupSpace || inheritedGroup?.groupSpace;
          const deliveryFields = normalizeSessionDeliveryFields(entry);
          const nextEntryPatch: SessionEntry = {
            sessionId,
            updatedAt: now,
            thinkingLevel: entry?.thinkingLevel,
            verboseLevel: entry?.verboseLevel,
            reasoningLevel: entry?.reasoningLevel,
            systemSent: entry?.systemSent,
            sendPolicy: entry?.sendPolicy,
            skillsSnapshot: entry?.skillsSnapshot,
            deliveryContext: deliveryFields.deliveryContext,
            lastChannel: deliveryFields.lastChannel ?? entry?.lastChannel,
            lastTo: deliveryFields.lastTo ?? entry?.lastTo,
            lastAccountId: deliveryFields.lastAccountId ?? entry?.lastAccountId,
            label: labelValue,
            spawnedBy: spawnedByValue,
            spawnDepth: entry?.spawnDepth,
            channel: entry?.channel ?? request.channel?.trim(),
            groupId: resolvedGroupId ?? entry?.groupId,
            groupChannel: resolvedGroupChannel ?? entry?.groupChannel,
            space: resolvedGroupSpace ?? entry?.space,
            cliSessionIds: entry?.cliSessionIds,
            claudeCliSessionId: entry?.claudeCliSessionId,
          };
          sessionEntry = mergeSessionEntry(entry, nextEntryPatch);
          const sendPolicy = resolveSendPolicy({
            cfg,
            entry,
            sessionKey: canonicalKey,
            channel: entry?.channel,
            chatType: entry?.chatType,
          });
          if (sendPolicy === "deny") {
            respond(
              false,
              undefined,
              errorShape(ErrorCodes.INVALID_REQUEST, "send blocked by session policy"),
            );
            return;
          }
          resolvedSessionId = sessionId;
          const canonicalSessionKey = canonicalKey;
          resolvedSessionKey = canonicalSessionKey;
          const agentId = resolveAgentIdFromSessionKey(canonicalSessionKey);
          void recordAgentInvocationShadow({ client, agentId, cfg, runId: idem });
          const mainSessionKey = resolveAgentMainSessionKey({ cfg, agentId });
          if (storePath) {
            const persisted = await updateSessionStore(storePath, (store) => {
              const target = resolveGatewaySessionStoreTarget({
                cfg,
                key: requestedSessionKey,
                store,
              });
              pruneLegacyStoreKeys({
                store,
                canonicalKey: target.canonicalKey,
                candidates: target.storeKeys,
              });
              const merged = mergeSessionEntry(store[canonicalSessionKey], nextEntryPatch);
              store[canonicalSessionKey] = merged;
              return merged;
            });
            sessionEntry = persisted;
          }
          if (canonicalSessionKey === mainSessionKey || canonicalSessionKey === "global") {
            context.addChatRun(idem, {
              sessionKey: canonicalSessionKey,
              clientRunId: idem,
            });
            if (requestedBestEffortDeliver === undefined) {
              bestEffortDeliver = true;
            }
          }
          registerAgentRunContext(idem, { sessionKey: canonicalSessionKey });
        }

        const runId = idem;
        const connId = typeof client?.connId === "string" ? client.connId : undefined;
        const wantsToolEvents = hasGatewayClientCap(
          client?.connect?.caps,
          GATEWAY_CLIENT_CAPS.TOOL_EVENTS,
        );
        if (connId && wantsToolEvents) {
          context.registerToolEventRecipient(runId, connId);
          // Register for any other active runs *in the same session* so
          // late-joining clients (e.g. page refresh mid-response) receive
          // in-progress tool events without leaking cross-session data.
          for (const [activeRunId, active] of context.chatAbortControllers) {
            if (activeRunId !== runId && active.sessionKey === requestedSessionKey) {
              context.registerToolEventRecipient(activeRunId, connId);
            }
          }
        }

        const wantsDelivery = request.deliver === true;
        const explicitTo =
          typeof request.replyTo === "string" && request.replyTo.trim()
            ? request.replyTo.trim()
            : typeof request.to === "string" && request.to.trim()
              ? request.to.trim()
              : undefined;
        const explicitThreadId =
          typeof request.threadId === "string" && request.threadId.trim()
            ? request.threadId.trim()
            : undefined;
        const turnSourceChannel =
          typeof request.channel === "string" && request.channel.trim()
            ? request.channel.trim()
            : undefined;
        const turnSourceTo =
          typeof request.to === "string" && request.to.trim() ? request.to.trim() : undefined;
        const turnSourceAccountId =
          typeof request.accountId === "string" && request.accountId.trim()
            ? request.accountId.trim()
            : undefined;
        const deliveryPlan = resolveAgentDeliveryPlan({
          sessionEntry,
          requestedChannel: request.replyChannel ?? request.channel,
          explicitTo,
          explicitThreadId,
          accountId: request.replyAccountId ?? request.accountId,
          wantsDelivery,
          turnSourceChannel,
          turnSourceTo,
          turnSourceAccountId,
          turnSourceThreadId: explicitThreadId,
        });

        let resolvedChannel = deliveryPlan.resolvedChannel;
        let deliveryTargetMode = deliveryPlan.deliveryTargetMode;
        let resolvedAccountId = deliveryPlan.resolvedAccountId;
        let resolvedTo = deliveryPlan.resolvedTo;
        let effectivePlan = deliveryPlan;

        if (wantsDelivery && resolvedChannel === INTERNAL_MESSAGE_CHANNEL) {
          const cfgResolved = cfgForAgent ?? cfg;
          try {
            const selection = await resolveMessageChannelSelection({ cfg: cfgResolved });
            resolvedChannel = selection.channel;
            deliveryTargetMode = deliveryTargetMode ?? "implicit";
            effectivePlan = {
              ...deliveryPlan,
              resolvedChannel,
              deliveryTargetMode,
              resolvedAccountId,
            };
          } catch (err) {
            respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, String(err)));
            return;
          }
        }

        if (!resolvedTo && isDeliverableMessageChannel(resolvedChannel)) {
          const cfgResolved = cfgForAgent ?? cfg;
          const fallback = resolveAgentOutboundTarget({
            cfg: cfgResolved,
            plan: effectivePlan,
            targetMode: deliveryTargetMode ?? "implicit",
            validateExplicitTarget: false,
          });
          if (fallback.resolvedTarget?.ok) {
            resolvedTo = fallback.resolvedTo;
          }
        }

        if (wantsDelivery && resolvedChannel === INTERNAL_MESSAGE_CHANNEL) {
          respond(
            false,
            undefined,
            errorShape(
              ErrorCodes.INVALID_REQUEST,
              "delivery channel is required: pass --channel/--reply-channel or use a main session with a previous channel",
            ),
          );
          return;
        }

        const normalizedTurnSource = normalizeMessageChannel(turnSourceChannel);
        const turnSourceMessageChannel =
          normalizedTurnSource && isGatewayMessageChannel(normalizedTurnSource)
            ? normalizedTurnSource
            : undefined;
        const originMessageChannel =
          turnSourceMessageChannel ??
          (client?.connect && isWebchatConnect(client.connect)
            ? INTERNAL_MESSAGE_CHANNEL
            : resolvedChannel);

        const deliver = request.deliver === true && resolvedChannel !== INTERNAL_MESSAGE_CHANNEL;

        const accepted = {
          runId,
          status: "accepted" as const,
          acceptedAt: Date.now(),
        };
        // Store an in-flight ack so retries do not spawn a second run.
        setGatewayDedupeEntry({
          dedupe: context.dedupe,
          key: `agent:${idem}`,
          entry: {
            ts: Date.now(),
            ok: true,
            payload: accepted,
            payloadFingerprint,
          },
        });
        respond(true, accepted, undefined, { runId });

        const resolvedThreadId = explicitThreadId ?? deliveryPlan.resolvedThreadId;

        dispatchAgentRunFromGateway({
          payloadFingerprint,
          ingressOpts: {
            message,
            images,
            to: resolvedTo,
            sessionId: resolvedSessionId,
            sessionKey: resolvedSessionKey,
            thinking: request.thinking,
            deliver,
            deliveryTargetMode,
            channel: resolvedChannel,
            accountId: resolvedAccountId,
            threadId: resolvedThreadId,
            runContext: {
              messageChannel: originMessageChannel,
              accountId: resolvedAccountId,
              groupId: resolvedGroupId,
              groupChannel: resolvedGroupChannel,
              groupSpace: resolvedGroupSpace,
              currentThreadTs: resolvedThreadId != null ? String(resolvedThreadId) : undefined,
            },
            groupId: resolvedGroupId,
            groupChannel: resolvedGroupChannel,
            groupSpace: resolvedGroupSpace,
            spawnedBy: spawnedByValue,
            timeout: request.timeout?.toString(),
            bestEffortDeliver,
            messageChannel: originMessageChannel,
            runId,
            lane: request.lane,
            extraSystemPrompt: request.extraSystemPrompt,
            internalEvents: request.internalEvents,
            inputProvenance,
            gatewayClientUser: routeSessionToOwner ? sessionClient?.user : undefined,
            gatewayClientPlatformUserId: routeSessionToOwner
              ? sessionClient?.platformUserId
              : undefined,
            gatewayClientSessionDomain: routeSessionToOwner
              ? sessionClient?.sessionDomain
              : undefined,
            // Internal-only: allow workspace override for spawned subagent runs.
            workspaceDir: resolveIngressWorkspaceOverrideForSpawnedRun({
              spawnedBy: spawnedByValue,
              workspaceDir: request.workspaceDir,
            }),
            modelFallbacks: request.modelFallbacks,
            spawnGovernanceSnapshot: takeStagedSpawnGovernanceSnapshot(idem),
            // Managed BYOK: keep agent RPC on the same tenant session store as chat.send.
            gatewayClientSessionTenantId: client?.sessionTenantId,
            // Frozen turn identity: spawned children inherit the in-process parent
            // pin; Control UI / webchat agent RPC freezes from the authenticated
            // client. Never read identity from agent RPC params.
            ...(() => {
              const staged = takeStagedSpawnExecutionIdentity(idem);
              const fromClient = createExecutionIdentityFromGatewayClient(client, {
                agentId: resolveAgentIdFromSessionKey(resolvedSessionKey),
                sessionKey: resolvedSessionKey,
              });
              const executionIdentity =
                staged ?? (hasAuthenticatedIdentity(fromClient) ? fromClient : undefined);
              return executionIdentity
                ? inheritExecutionIdentityRunFields({ executionIdentity })
                : {};
            })(),
            senderIsOwner,
          },
          runId,
          idempotencyKey: idem,
          respond,
          context,
        });
      };
      if (ownerScopeForUnboundAgent) {
        await withOperatorStateScope(ownerScopeForUnboundAgent, () => runAgentTurn());
      } else {
        await runAgentTurn();
      }
    } finally {
      if (!settled) {
        settled = true;
        settleInflight({
          ok: false,
          error: errorShape(ErrorCodes.UNAVAILABLE, "agent ended without a response"),
        });
        inflightMap.delete(agentDedupeKey);
      }
    }
  },
  "agent.identity.get": ({ params, respond }) => {
    if (!validateAgentIdentityParams(params)) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          `invalid agent.identity.get params: ${formatValidationErrors(
            validateAgentIdentityParams.errors,
          )}`,
        ),
      );
      return;
    }
    const p = params;
    const agentIdRaw = typeof p.agentId === "string" ? p.agentId.trim() : "";
    const sessionKeyRaw = typeof p.sessionKey === "string" ? p.sessionKey.trim() : "";
    let agentId = agentIdRaw ? normalizeAgentId(agentIdRaw) : undefined;
    if (sessionKeyRaw) {
      if (classifySessionKeyShape(sessionKeyRaw) === "malformed_agent") {
        respond(
          false,
          undefined,
          errorShape(
            ErrorCodes.INVALID_REQUEST,
            `invalid agent.identity.get params: malformed session key "${sessionKeyRaw}"`,
          ),
        );
        return;
      }
      const resolved = resolveAgentIdFromSessionKey(sessionKeyRaw);
      if (agentId && resolved !== agentId) {
        respond(
          false,
          undefined,
          errorShape(
            ErrorCodes.INVALID_REQUEST,
            `invalid agent.identity.get params: agent "${agentIdRaw}" does not match session key agent "${resolved}"`,
          ),
        );
        return;
      }
      agentId = resolved;
    }
    const cfg = loadConfig();
    const identity = resolveAssistantIdentity({ cfg, agentId });
    const avatarValue =
      resolveAssistantAvatarUrl({
        avatar: identity.avatar,
        agentId: identity.agentId,
        basePath: cfg.gateway?.controlUi?.basePath,
      }) ?? identity.avatar;
    respond(true, { ...identity, avatar: avatarValue }, undefined);
  },
  "agent.wait": async ({ params, respond, context }) => {
    if (!validateAgentWaitParams(params)) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          `invalid agent.wait params: ${formatValidationErrors(validateAgentWaitParams.errors)}`,
        ),
      );
      return;
    }
    const p = params;
    const runId = (p.runId ?? "").trim();
    const timeoutMs =
      typeof p.timeoutMs === "number" && Number.isFinite(p.timeoutMs)
        ? Math.max(0, Math.floor(p.timeoutMs))
        : 30_000;
    const hasActiveChatRun = context.chatAbortControllers.has(runId);

    const cachedGatewaySnapshot = readTerminalSnapshotFromGatewayDedupe({
      dedupe: context.dedupe,
      runId,
      ignoreAgentTerminalSnapshot: hasActiveChatRun,
    });
    if (cachedGatewaySnapshot) {
      respond(true, {
        runId,
        status: cachedGatewaySnapshot.status,
        startedAt: cachedGatewaySnapshot.startedAt,
        endedAt: cachedGatewaySnapshot.endedAt,
        error: cachedGatewaySnapshot.error,
      });
      return;
    }

    const lifecycleAbortController = new AbortController();
    const dedupeAbortController = new AbortController();
    const lifecyclePromise = waitForAgentJob({
      runId,
      timeoutMs,
      signal: lifecycleAbortController.signal,
      // When chat.send is active with the same runId, ignore cached lifecycle
      // snapshots so stale agent results do not preempt the active chat run.
      ignoreCachedSnapshot: hasActiveChatRun,
    });
    const dedupePromise = waitForTerminalGatewayDedupe({
      dedupe: context.dedupe,
      runId,
      timeoutMs,
      signal: dedupeAbortController.signal,
      ignoreAgentTerminalSnapshot: hasActiveChatRun,
    });

    const first = await Promise.race([
      lifecyclePromise.then((snapshot) => ({ source: "lifecycle" as const, snapshot })),
      dedupePromise.then((snapshot) => ({ source: "dedupe" as const, snapshot })),
    ]);

    let snapshot: AgentWaitTerminalSnapshot | Awaited<ReturnType<typeof waitForAgentJob>> =
      first.snapshot;
    if (snapshot) {
      if (first.source === "lifecycle") {
        dedupeAbortController.abort();
      } else {
        lifecycleAbortController.abort();
      }
    } else {
      snapshot = first.source === "lifecycle" ? await dedupePromise : await lifecyclePromise;
      lifecycleAbortController.abort();
      dedupeAbortController.abort();
    }

    if (!snapshot) {
      respond(true, {
        runId,
        status: "timeout",
      });
      return;
    }
    respond(true, {
      runId,
      status: snapshot.status,
      startedAt: snapshot.startedAt,
      endedAt: snapshot.endedAt,
      error: snapshot.error,
    });
  },
};
