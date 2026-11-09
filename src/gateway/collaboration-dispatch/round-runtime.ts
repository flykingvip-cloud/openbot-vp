import { getRuntimeConfigSnapshot } from "../../config/config.js";
import { observeObjectiveShadowFromIngress } from "../../objective-shadow/ingress-hook.js";
import { readSharedTaskCandidates } from "../../objective-shadow/read-existing-objectives.js";
import { parseChatContextScopeRequest, resolveContextScopePlan } from "../context-scope/index.js";
import type { ChatContextScopePayload } from "../context-scope/request.js";
import type { ContextScopeRequest } from "../context-scope/types.js";
import { attachPrimaryEdgesWithAssistantMentionConsumer } from "./assistant-mention-dispatch.js";
import { pickDutyDifferentiatedSupplement } from "./auto-supplement.js";
import {
  type CheapGateResult,
  evaluateCheapGate,
  primaryInvitesSupplementInput,
  shouldDispatchCheapGate,
} from "./cheap-gate.js";
import { maybeExpandBoardKickoffDecision } from "./claim-contract.js";
import { type CollabEdge } from "./collab-edge.js";
import type { CollaborationEventKey } from "./collaboration-event-key.js";
import {
  classifyPrimaryCompletion,
  resolvePrimaryDeadlineMs,
  resolveTimeoutTaskType,
} from "./completion-contract.js";
import { maybeContinueAfterRoundComplete } from "./continue-after-round.js";
import type { SupplementGateEntry } from "./effective-policy.js";
import { startFloorBidShadow, type FloorBidHandle } from "./floor-bid.js";
import {
  assertBidDoesNotDriveProduction,
  FloorLiveCutoverRefusedError,
  guardFloorProductionSpeakers,
} from "./floor-live-cutover.js";
import {
  isCollabFloorShadowEnabled,
  observeFloorShadowAfterRound,
  recordFloorShadowStageAAfterRound,
  recordFloorShadowStageBAfterRound,
} from "./floor-shadow.js";
import { expandV1RollCallInvitedAgentIds } from "./hotfix-rollcall-v1.js"; // v1-only
import {
  assertLegacyProductionExecutor,
  readCollaborationCutoverFlags,
} from "./legacy-production-executor.js";
import { normalizeAgentIdentifier } from "./mention-utils.js";
import { buildPolicyDecisionRecord } from "./policy-decision-record.js";
import { resolveContextLaneForRound } from "./policy-lane-context.js";
import { resolveDispatchLanePolicyV1 } from "./policy-lane-dispatch.js";
import {
  freezeCollaborationPolicy,
  hashCollaborationPolicy,
  resolveCollaborationPolicyV1,
  resolveFrozenRoundPolicy,
  type CollaborationPolicyV1,
} from "./policy.js";
import { buildCollaborationRoundStages, sleepMs } from "./round-orchestrator.js";
import { canTransitionRoundState } from "./round-state-machine.js";
import {
  type PersistedRound,
  type RoundEventType,
  type RoundTransitionEvent,
} from "./round-state.js";
import {
  acceptRoundDispatch,
  applyRoundTransition,
  createPersistedRound,
  listPersistedRounds,
  readPersistedRound,
  writePersistedRound,
} from "./round-store.js";
import type { BeatExecutionInput, RuntimeAuthority, RuntimeFacts } from "./runtime-authority.js";
import { resolveSecondaryTakeoverBot } from "./secondary-takeover.js";
import { isCollabFloorShadowStageB } from "./shadow-stage-flag.js";
import { buildSupplementDenialDiagnosis } from "./supplement-denial-diagnosis.js";
import {
  COLLABORATION_ABSOLUTE_VISIBLE_TURN_LIMIT,
  type CollaborationBotTarget,
  type ParticipationDecision,
} from "./types.js";

export const MENTION_UNMATCHED_TTL_MS = 60_000;

export type RoundDispatchRunner = (params: {
  bot: CollaborationBotTarget;
  role: "primary" | "explicit_member" | "fallback" | "supplement" | "close";
  dispatchId: string;
  isWrapTurn: boolean;
  /** Same-round CollabEdge that nominated this bot (edge-target dispatches only). */
  edge?: CollabEdge;
}) => Promise<{ text?: string; rawText?: string } | undefined>;

export type RoundRecoveryDecision = {
  action: "noop" | "abort" | "timeout" | "complete";
  event?: RoundTransitionEvent;
  eventType?: RoundEventType;
  reason: string;
  pendingAgentIds?: string[];
};

type PersistOpts = {
  tenantId?: string | null;
  roundsDir?: string;
};

function attachEdgesAfterPrimary(params: {
  round: PersistedRound;
  primaryText: string;
  fromAgentId: string;
  taskId?: string | null;
  bots: CollaborationBotTarget[];
}): PersistedRound {
  // C3: when assistantMentionDispatch ON, plain @ tokens become peer_ask edges
  // (budgeted with explicit [[collab_edge:...]] directives). Flag OFF → directives only.
  const cfg = getRuntimeConfigSnapshot() ?? undefined;
  const attached = attachPrimaryEdgesWithAssistantMentionConsumer({
    primaryText: params.primaryText,
    fromAgentId: params.fromAgentId,
    bots: params.bots,
    taskId: params.taskId,
    cfg,
  });
  if (attached.edges.length === 0) {
    return params.round;
  }
  return { ...params.round, edges: attached.edges };
}

function prioritizeSupplementBotsForEdges(params: {
  supplementBots: CollaborationBotTarget[];
  edges: readonly CollabEdge[] | undefined;
  allBots: CollaborationBotTarget[];
}): CollaborationBotTarget[] {
  if (!params.edges?.length) {
    return params.supplementBots;
  }
  const byId = new Map(
    [...params.allBots, ...params.supplementBots].map((bot) => [bot.agentId, bot] as const),
  );
  const prioritized: CollaborationBotTarget[] = [];
  const seen = new Set<string>();
  for (const edge of params.edges) {
    const bot = byId.get(edge.toAgentId);
    if (!bot || seen.has(bot.agentId)) {
      continue;
    }
    seen.add(bot.agentId);
    prioritized.push(bot);
  }
  for (const bot of params.supplementBots) {
    if (seen.has(bot.agentId)) {
      continue;
    }
    seen.add(bot.agentId);
    prioritized.push(bot);
  }
  return prioritized;
}

async function stepRound(
  round: PersistedRound,
  event: RoundTransitionEvent,
  eventType: RoundEventType,
  persist: PersistOpts,
  extra?: {
    eventId?: string;
    dispatchId?: string;
    agentId?: string;
    payload?: Record<string, unknown>;
  },
): Promise<PersistedRound> {
  if (!canTransitionRoundState(round.state, event)) {
    return round;
  }
  const applied = await applyRoundTransition({
    round,
    event,
    eventType,
    tenantId: persist.tenantId,
    roundsDir: persist.roundsDir,
    ...extra,
  });
  return applied.round;
}

function policyFromRound(
  round: PersistedRound,
  fallback: CollaborationPolicyV1,
): CollaborationPolicyV1 {
  return resolveFrozenRoundPolicy(round.policySnapshot) ?? fallback;
}

async function recordCandidateDropped(params: {
  round: PersistedRound;
  persist: PersistOpts;
  agentId: string;
  reason: string;
}): Promise<PersistedRound> {
  return await stepRound(params.round, "candidate_dropped", "CANDIDATE_DROPPED", params.persist, {
    agentId: params.agentId,
    payload: { reason: params.reason },
  });
}

type RoundBotReply = { text?: string; rawText?: string };

async function racePrimaryReply(params: {
  run: () => Promise<RoundBotReply | undefined>;
  deadlineAt: number;
  onDeadline?: () => void;
  /**
   * Primary deadline must not drop the in-flight turn. The deadline still wins
   * the race (optional follow-up closed; no fallback while a
   * real body is in flight), but the same run is awaited so a late visible
   * reply is classified and delivered before the round seals. Applies to every
   * task type, not only chitchat soft-timeout. A settled empty body still
   * times out with visibleReply false.
   */
  settleInFlight?: boolean;
}): Promise<{ reply?: RoundBotReply; timedOut: boolean }> {
  const remainingMs = params.deadlineAt - Date.now();
  if (remainingMs <= 0 && !params.settleInFlight) {
    params.onDeadline?.();
    return { timedOut: true };
  }
  const runPromise = params.run().then((reply) => ({ reply, timedOut: false as const }));
  if (remainingMs <= 0) {
    params.onDeadline?.();
    const settled = await runPromise;
    return { reply: settled.reply, timedOut: true };
  }
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<{ timedOut: true }>((resolve) => {
    timer = setTimeout(() => {
      params.onDeadline?.();
      resolve({ timedOut: true });
    }, remainingMs);
  });
  try {
    const raced = await Promise.race([runPromise, timeout]);
    if (!raced.timedOut) {
      return { reply: raced.reply, timedOut: false };
    }
    if (!params.settleInFlight) {
      return { timedOut: true };
    }
    const settled = await runPromise;
    return { reply: settled.reply, timedOut: true };
  } finally {
    if (timer) {
      clearTimeout(timer);
    }
  }
}

export function decideRoundRecovery(round: PersistedRound, nowMs: number): RoundRecoveryDecision {
  if (round.state === "ROUND_COMPLETE" || round.state === "ROUND_ABORTED") {
    return { action: "noop", reason: "terminal" };
  }
  if (round.abortRequested) {
    return {
      action: "abort",
      event: "abort",
      eventType: "ROUND_ABORTED",
      reason: "abort_requested",
    };
  }
  if (round.state === "MENTION_CONFIRM") {
    return { action: "noop", reason: "awaiting_mention_confirm" };
  }
  if (round.state === "MENTION_UNMATCHED") {
    if (round.deadlineAt && nowMs >= round.deadlineAt) {
      return {
        action: "abort",
        event: "unmatched_expired",
        eventType: "ROUND_ABORTED",
        reason: "unmatched_expired",
      };
    }
    return { action: "noop", reason: "blocked_unmatched" };
  }
  if (round.state === "ROUND_CREATED" || round.state === "CLASSIFYING") {
    return {
      action: "abort",
      event: "abort",
      eventType: "ROUND_ABORTED",
      reason: "incomplete_classify",
    };
  }
  if (round.state === "WAITING_PRIMARY" || round.state === "PRIMARY_RESPONDING") {
    return {
      action: "timeout",
      event: "timeout",
      eventType: "PRIMARY_TIMEOUT",
      reason: "restart_no_rerun",
    };
  }
  if (
    round.state === "PRIMARY_ASSIGNED" ||
    round.state === "PRIMARY_QUEUE" ||
    round.state === "PRIMARY_TIMEOUT" ||
    round.state === "FALLBACK" ||
    round.state === "SUPPLEMENTING" ||
    round.state === "OPTIONAL_CLOSE"
  ) {
    return {
      action: "abort",
      event: "abort",
      eventType: "ROUND_ABORTED",
      reason: round.state === "PRIMARY_QUEUE" ? "restart_no_rerun" : "inflight_dispatch_lost",
    };
  }
  if (round.state === "PRIMARY_COMPLETED" || round.state === "SUPPLEMENT_WINDOW") {
    const attempted = new Set(round.dispatches.map((dispatch) => dispatch.agentId));
    const dropped = new Set(
      (round.policyDecision?.supplementGate ?? [])
        .filter((entry) => entry.decision === "DROP")
        .map((entry) => entry.agentId),
    );
    const pendingAgentIds = [
      ...new Set([
        ...round.primaryQueue.slice(round.primaryCursor + 1),
        ...(round.policyDecision?.participants ?? [])
          .filter(
            (member) =>
              member.tier !== "wrap" &&
              !attempted.has(member.agentId) &&
              !dropped.has(member.agentId),
          )
          .map((member) => member.agentId),
      ]),
    ];
    // A restart cannot prove outstanding work ran, or safely replay unknown
    // side effects. Preserve the dispatch log and expose the interruption.
    if (pendingAgentIds.length > 0 || round.state === "SUPPLEMENT_WINDOW") {
      return {
        action: "abort",
        event: "abort",
        eventType: "ROUND_ABORTED",
        reason: "restart_pending_dispatch",
        pendingAgentIds,
      };
    }
  }
  if (round.state === "PRIMARY_COMPLETED" || round.state === "CONVERGENCE_CHECK") {
    return {
      action: "complete",
      event:
        round.state === "CONVERGENCE_CHECK"
          ? "close_not_required"
          : "queue_exhausted_no_supplement",
      eventType: "ROUND_COMPLETED",
      reason: "skip_remaining",
    };
  }
  return { action: "abort", event: "abort", eventType: "ROUND_ABORTED", reason: "unknown" };
}

export async function applyRoundRecovery(
  round: PersistedRound,
  decision: RoundRecoveryDecision,
  persist: PersistOpts,
): Promise<PersistedRound> {
  if (decision.action === "noop" || !decision.event || !decision.eventType) {
    return round;
  }
  let current = round;
  if (decision.action === "abort" && decision.reason === "restart_pending_dispatch") {
    return await stepRound(
      { ...current, abortReason: "fatal" },
      decision.event,
      decision.eventType,
      persist,
      {
        payload: {
          recoveryReason: decision.reason,
          pendingAgentIds: decision.pendingAgentIds ?? [],
        },
      },
    );
  }
  if (decision.action === "complete" && round.state === "PRIMARY_COMPLETED") {
    current = await stepRound(
      current,
      "queue_exhausted_no_supplement",
      "CONVERGENCE_CHECKED",
      persist,
    );
    return await stepRound(current, "close_not_required", "ROUND_COMPLETED", persist);
  }
  if (decision.action === "complete" && round.state === "SUPPLEMENT_WINDOW") {
    current = await stepRound(current, "no_candidate", "CONVERGENCE_CHECKED", persist);
    return await stepRound(current, "close_not_required", "ROUND_COMPLETED", persist);
  }
  if (
    decision.action === "timeout" &&
    (round.state === "WAITING_PRIMARY" || round.state === "PRIMARY_RESPONDING")
  ) {
    current = await stepRound(current, "timeout", "PRIMARY_TIMEOUT", persist);
    current = { ...current, abortReason: "fatal" };
    return await stepRound(current, "abort", "ROUND_ABORTED", persist);
  }
  return await stepRound(current, decision.event, decision.eventType, persist);
}

export async function recoverIncompleteRounds(
  params: PersistOpts & { groupId: string; skipRoundIds?: Iterable<string> },
) {
  const skip = new Set(params.skipRoundIds ?? []);
  const rounds = await listPersistedRounds(params);
  const now = Date.now();
  let recovered = 0;
  for (const round of rounds) {
    if (skip.has(round.roundId)) {
      continue;
    }
    const decision = decideRoundRecovery(round, now);
    if (decision.action === "noop") {
      continue;
    }
    await applyRoundRecovery(round, decision, params);
    recovered += 1;
  }
  return { recovered, scanned: rounds.length };
}

export async function supersedeBlockedUnmatchedRounds(params: PersistOpts & { groupId: string }) {
  const rounds = await listPersistedRounds(params);
  let superseded = 0;
  for (const round of rounds) {
    if (round.state !== "MENTION_UNMATCHED" && round.state !== "MENTION_CONFIRM") {
      continue;
    }
    await stepRound(round, "user_next_message", "ROUND_ABORTED", params);
    superseded += 1;
  }
  return { superseded };
}

export async function abortPersistedRound(
  params: PersistOpts & { groupId: string; roundId: string },
) {
  const round = await readPersistedRound(params);
  if (!round) {
    return null;
  }
  if (round.state === "ROUND_COMPLETE" || round.state === "ROUND_ABORTED") {
    return round;
  }
  const marked = { ...round, abortReason: "user_stop" as const };
  return await stepRound(marked, "abort", "ROUND_ABORTED", params);
}

function resolveCollaborationMode(
  decision: ParticipationDecision,
): PersistedRound["collaborationMode"] {
  if (decision.primaryMode === "explicit_multi") {
    return "explicit_multi";
  }
  if (decision.responseMode === "single_owner") {
    return "single_owner";
  }
  return "lead_plus_supplement";
}

export async function bootstrapCollaborationRound(
  authority: RuntimeAuthority,
  facts: RuntimeFacts,
  params: {
    decision: ParticipationDecision;
    policy: CollaborationPolicyV1;
    sessionKey: string;
    inboundDepth?: "chat" | "retrieve" | "act";
    contextScopeRequest?: ContextScopeRequest;
    /** P0.0b: CollaborationEventKey stamped onto PDR / round episodeRef. */
    eventKey?: CollaborationEventKey | null;
    roundsDir?: string;
  },
): Promise<PersistedRound> {
  const persist = { tenantId: authority.tenantId, roundsDir: params.roundsDir };
  const decision = await maybeExpandBoardKickoffDecision({
    authority,
    decision: params.decision,
    groupBots: facts.bots as import("./types.js").CollaborationBotTarget[],
  });
  const frozenPolicy = freezeCollaborationPolicy(params.policy);
  // P1-A5 ④: context lane — default legacy keeps PolicyV1.contextPolicy and omits
  // groupConfidentiality (internal fallback). Flag shadow|effective compares / switches
  // to authority.policy.effective.context (composition-root helper; no raw bypass here).
  const contextLane = resolveContextLaneForRound({
    effective: authority.policy.effective,
    legacyPolicy: frozenPolicy,
    ...(params.eventKey ? { key: params.eventKey } : {}),
  });
  const contextScopePlan = resolveContextScopePlan({
    inboundDepth: params.inboundDepth,
    sessionKey: params.sessionKey,
    groupId: authority.groupId,
    request: params.contextScopeRequest,
    contextPolicy: contextLane.planPolicy,
    ...(contextLane.groupConfidentiality
      ? { groupConfidentiality: contextLane.groupConfidentiality }
      : {}),
  });
  const policyDecision = buildPolicyDecisionRecord({
    decision: decision,
    effective: authority.policy
      .effective as import("./effective-policy.js").EffectiveCollaborationPolicy,
    facts,
    ...(params.eventKey ? { key: params.eventKey } : {}),
  });
  const created = createPersistedRound({
    roundId: decision.roundId,
    groupId: authority.groupId,
    sessionKey: params.sessionKey,
    userMessageId: decision.roundId,
    tenantId: authority.tenantId,
    collaborationMode: resolveCollaborationMode(decision),
    policyVersion: params.policy.version,
    policyHash: hashCollaborationPolicy(frozenPolicy),
    policySnapshot: frozenPolicy,
    ...(policyDecision ? { policyDecision } : {}),
    ...(params.eventKey ? { episodeRef: params.eventKey } : {}),
    state: "ROUND_CREATED",
    primaryMode: decision.primaryMode,
    mentionMode: decision.mentionMode,
    primaryQueue: decision.primaryQueue,
    primaryCursor: 0,
    contextScopePlan,
    deadlineAt: decision.mentionUnmatched ? Date.now() + MENTION_UNMATCHED_TTL_MS : undefined,
    ...(decision.mentionConfirm ? { mentionConfirm: decision.mentionConfirm } : {}),
  });
  await writePersistedRound({ round: created, ...persist });
  let round = await stepRound(created, "message_received", "ROUND_CREATED", persist);
  if (decision.mentionUnmatched) {
    return await stepRound(round, "mention_unmatched", "MENTION_UNMATCHED", persist);
  }
  if (decision.mentionConfirm) {
    return await stepRound(round, "mention_confirm", "MENTION_CONFIRM_ASKED", persist);
  }
  round = await stepRound(round, "classified", "CLASSIFIED", persist);
  round = await stepRound(round, "queue_ready", "PRIMARY_QUEUE_ENTERED", persist);
  return round;
}

/**
 * P0 G8 production executor. Advances `PRIMARY_*` / `SUPPLEMENT_*` (optional
 * wrap). Floor shadow and Episode Store exist; default flags do not let them
 * choose participants or replace this state machine. `protocol=floor` is not
 * a branch here. P0 G1 consults the unsigned cutover gate and keeps G8 speakers.
 */
export async function executeCollaborationRound(
  authority: RuntimeAuthority,
  facts: RuntimeFacts,
  input: BeatExecutionInput,
): Promise<PersistedRound> {
  assertLegacyProductionExecutor(input.productionExecutor);
  const cutover = readCollaborationCutoverFlags(getRuntimeConfigSnapshot() ?? undefined);
  guardFloorProductionSpeakers({
    protocol: cutover.floorProtocol === "unset" ? null : cutover.floorProtocol,
    shadowStage: cutover.shadowStage === "unset" ? null : cutover.shadowStage,
    episodeStore: cutover.episodeStore,
    runtimeNamespace: cutover.runtimeNamespace,
    handoffContract: cutover.handoffContract,
    drivesProductionDecision: cutover.floorDrivesProductionDecision,
  });
  // Mode B board-tied kickoff: expand single @mention → intended multi (flag default OFF).
  const expandedDecision = await maybeExpandBoardKickoffDecision({
    authority,
    decision: input.decision,
    groupBots: facts.bots as import("./types.js").CollaborationBotTarget[],
  });
  const params = {
    decision: expandedDecision,
    policy: input.policy,
    message: input.message,
    sessionKey: input.sessionKey,
    isAborted: () => Boolean(input.signal?.aborted) || Boolean(input.isAborted?.()),
    runBot: input.runBot as RoundDispatchRunner,
    roundsDir: input.roundsDir,
    skipRoundIds: input.skipRoundIds,
    inboundDepth: input.inboundDepth,
    onPrimaryDeadline: input.onPrimaryDeadline,
    contextScopeRequest: input.contextScopeRequest,
    contextScope: input.contextScope,
    eventKey: input.eventKey,
    sourceMessageId: input.sourceMessageId,
    discussToTaskActor: input.discussToTaskActor,
    formalTaskEstablish: input.formalTaskEstablish,
  };
  const effectiveEarly = authority.policy
    .effective as import("./effective-policy.js").EffectiveCollaborationPolicy;
  // P1-A5 ② BP-06..10: PolicyV1 via dispatch lane (default legacy ≡ toLegacyPolicyView(effective)).
  const policy: CollaborationPolicyV1 =
    params.policy ??
    resolveDispatchLanePolicyV1({
      effective: effectiveEarly,
      ...(params.eventKey ? { key: params.eventKey } : {}),
    }).policy;
  const contextScopeRequest =
    params.contextScopeRequest ?? parseChatContextScopeRequest(params.contextScope);
  const persist = { tenantId: authority.tenantId, roundsDir: params.roundsDir };
  let floorShadowOn = false;
  try {
    floorShadowOn = isCollabFloorShadowEnabled();
  } catch {
    floorShadowOn = false;
  }
  const shadowPosts: Array<{ agentId: string; text: string; atMs: number }> = [];
  const bidPosts: Array<{ agentId: string; text: string; atMs: number }> = [];
  let stageB = false;
  try {
    stageB = isCollabFloorShadowStageB();
  } catch {
    stageB = false;
  }
  let bidHandle: FloorBidHandle | null = null;
  if (stageB) {
    try {
      bidHandle = startFloorBidShadow({
        authority,
        facts,
        message: params.message,
        signal: input.signal,
        roundsDir: params.roundsDir,
      });
    } catch {
      bidHandle = null;
    }
  }
  const capturePosts = floorShadowOn || stageB;
  const runBot: RoundDispatchRunner = capturePosts
    ? async (args) => {
        const result = await params.runBot(args);
        try {
          const post = {
            agentId: args.bot.agentId,
            text: result?.text ?? result?.rawText ?? "",
            atMs: Date.now(),
          };
          if (floorShadowOn) {
            shadowPosts.push(post);
          }
          if (stageB) {
            bidPosts.push(post);
          }
        } catch {
          // Capture must not change dispatch.
        }
        return result;
      }
    : params.runBot;
  const finishShadow = async (settled: PersistedRound): Promise<PersistedRound> => {
    let bidJoined: Awaited<ReturnType<FloorBidHandle["join"]>> | null = null;
    if (bidHandle) {
      try {
        bidJoined = await bidHandle.join({ posts: bidPosts });
        if (bidJoined) {
          assertBidDoesNotDriveProduction(bidJoined.drivesProductionDecision);
        }
      } catch (error) {
        if (error instanceof FloorLiveCutoverRefusedError) {
          throw error;
        }
        bidJoined = null;
      }
    }
    // P1-C protocol shadow and P2-A shadowStage are independent. Protocol stays
    // legacy by default; stage A still compares into EDR when it is explicitly on.
    if (floorShadowOn) {
      try {
        await observeFloorShadowAfterRound({
          round: settled,
          message: params.message,
          inboundDepth: params.inboundDepth,
          decision: params.decision,
          posts: shadowPosts,
          roundsDir: params.roundsDir,
        });
      } catch {
        // Fail-closed: a shadow throw must not abort the round.
      }
    }
    try {
      await recordFloorShadowStageAAfterRound({
        authority,
        decision: params.decision,
        round: settled,
      });
    } catch {
      // Shadow-A compare must not abort the round. Flag-off returns immediately.
    }
    try {
      if (bidJoined) {
        await recordFloorShadowStageBAfterRound({
          authority,
          decision: params.decision,
          round: settled,
          bids: bidJoined.bids.map((bid) => ({
            agentId: bid.agentId,
            intent: bid.intent,
            selfAssessment: bid.selfAssessment,
            admissionSignals: bid.admissionSignals,
            producer: bid.producer,
          })),
          calibration: bidJoined.calibration,
        });
      }
    } catch {
      // Shadow-B bids must not abort the round and must not change the decision.
    }
    // Platform Mode B: optional inventory-first continue after ROUND_COMPLETE.
    // Default OFF (allowlist). Fail-closed — never abort the round.
    try {
      await maybeContinueAfterRoundComplete({
        authority,
        roundId: settled.roundId,
        roundState: settled.state,
      });
    } catch {
      // continue-after-round must not abort the round.
    }
    return settled;
  };
  const sharedTaskCandidates = await readSharedTaskCandidates({
    sessionKey: params.sessionKey,
    groupId: authority.groupId,
  });
  observeObjectiveShadowFromIngress({
    ingress: "collaboration_turn",
    tenantId: authority.tenantId,
    tenantScope: authority.tenantId?.trim() ? "identified" : "local_unscoped",
    runId: params.decision.roundId,
    groupId: authority.groupId,
    candidates: sharedTaskCandidates,
  });
  const effective = effectiveEarly;
  const existing = await readPersistedRound({
    groupId: authority.groupId,
    roundId: params.decision.roundId,
    ...persist,
  });
  if (existing) {
    if (existing.state === "ROUND_COMPLETE" || existing.state === "ROUND_ABORTED") {
      return finishShadow(existing);
    }
    return finishShadow(
      await applyRoundRecovery(existing, decideRoundRecovery(existing, Date.now()), persist),
    );
  }

  await recoverIncompleteRounds({
    groupId: authority.groupId,
    skipRoundIds: params.skipRoundIds,
    ...persist,
  });
  await supersedeBlockedUnmatchedRounds({ groupId: authority.groupId, ...persist });

  let round = await bootstrapCollaborationRound(authority, facts, {
    decision: params.decision,
    policy,
    sessionKey: params.sessionKey,
    roundsDir: params.roundsDir,
    inboundDepth: params.inboundDepth,
    contextScopeRequest,
    ...(params.eventKey ? { eventKey: params.eventKey } : {}),
  });

  if (round.state === "MENTION_UNMATCHED" || round.state === "MENTION_CONFIRM") {
    return finishShadow(round);
  }
  if (params.isAborted()) {
    return finishShadow(
      (await abortPersistedRound({
        groupId: authority.groupId,
        roundId: round.roundId,
        ...persist,
      })) ?? round,
    );
  }

  const frozen = freezeCollaborationPolicy(policyFromRound(round, policy));
  const stages = buildCollaborationRoundStages(params.decision);
  const leadBots = stages.lead.bots;
  // Empty primary must not sit forever in PRIMARY_QUEUE (e.g. legacy silence paths).
  // Greetings now floor to ≥1 participant; this is a defensive escape hatch.
  if (leadBots.length === 0 && round.state === "PRIMARY_QUEUE") {
    round = { ...round, abortReason: "fatal" };
    return finishShadow(await stepRound(round, "abort", "ROUND_ABORTED", persist));
  }
  const taskType = resolveTimeoutTaskType({
    responseMode: params.decision.responseMode,
    inboundDepth: params.inboundDepth,
    message: params.message,
  });
  const isChitchatRound = taskType === "chitchat" || taskType === "chat";
  // "Primary answered" (visible, non-placeholder) is tracked separately from
  // "primary carried a structural conclusion". Only the latter gates the open
  // supplement window; neither turns a real reply into a timeout.
  let primaryCompleted = false;
  let primaryHasConclusion = false;
  let primaryVisibleText = "";
  // Budget already elapsed: chitchat soft-close, or any task type whose primary
  // settled after the deadline. Blocks optional supplement and wrap; already
  // invited turns retain their own admission and deadline.
  let primaryBudgetClosed = false;
  let leadVisibleCount = 0;

  for (let cursor = 0; cursor < leadBots.length; cursor += 1) {
    if (cursor > 0) {
      await sleepMs(stages.coordinationDelayMs, input.signal);
    }
    if (params.isAborted()) {
      return finishShadow(
        (await abortPersistedRound({
          groupId: authority.groupId,
          roundId: round.roundId,
          ...persist,
        })) ?? round,
      );
    }
    const bot = leadBots[cursor];
    if (!bot) {
      continue;
    }
    const startedAtMs = Date.now();
    const deadlineAt = resolvePrimaryDeadlineMs({
      policy: frozen,
      taskType,
      inboundDepth: params.inboundDepth,
      startedAtMs,
    });
    round = {
      ...round,
      primaryCursor: cursor,
      primaryAgentId: bot.agentId,
      deadlineAt,
      placeholderDeadlineAt: startedAtMs + frozen.fallback.timeoutPolicy.placeholderMs,
    };
    round = await stepRound(round, "cursor_ready", "PRIMARY_STARTED", persist);
    const dispatchId = `${round.roundId}:primary:${bot.agentId}`;
    const accepted = acceptRoundDispatch({
      round,
      dispatchId,
      agentId: bot.agentId,
      role: params.decision.primaryMode === "explicit_multi" ? "explicit_member" : "primary",
    });
    round = accepted.round;
    if (!accepted.accepted) {
      continue;
    }
    round = await stepRound(round, "primary_started", "PRIMARY_STARTED", persist, {
      dispatchId,
      agentId: bot.agentId,
      payload: { taskType, deadlineAt, budgetMs: deadlineAt - startedAtMs },
    });
    const raced = await racePrimaryReply({
      deadlineAt,
      onDeadline: params.onPrimaryDeadline,
      // The budget closes optional supplement / fallback. It does not
      // discard the in-flight primary. A reply that lands after the deadline
      // (chitchat ~8s, analysis 30s, or any other task type) is still
      // classified and delivered before ROUND_COMPLETE or ROUND_ABORTED.
      settleInFlight: true,
      run: () =>
        runBot({
          bot,
          role: accepted.round.dispatches.at(-1)?.role ?? "primary",
          dispatchId,
          isWrapTurn: false,
        }),
    });
    if (params.isAborted()) {
      return finishShadow(
        (await abortPersistedRound({
          groupId: authority.groupId,
          roundId: round.roundId,
          ...persist,
        })) ?? round,
      );
    }
    const primaryReplyText = raced.reply?.text ?? "";
    const completion = classifyPrimaryCompletion(primaryReplyText, taskType, {
      mentionBotMustRespond: effective.participation.mentionBotMustRespond,
      acceptVisibleBody: params.decision.responseMode === "debate_or_brainstorm",
    });
    round = { ...round, completion };
    // A late reply after the primary budget is still a visible primary, for
    // every task type. Optional follow-up stays closed; explicitly queued members
    // retain independent turns. Only a settled empty body keeps visibleReply false and
    // takes the timeout / abort path.
    const lateVisiblePrimary = raced.timedOut && completion.visibleReply;
    if ((!raced.timedOut || lateVisiblePrimary) && completion.responseStatus === "complete") {
      // A real visible reply (incl. tool / execution results) always completes the
      // primary. Missing 结论/下一步 is a quality tag, never a timeout or fallback.
      primaryCompleted = true;
      leadVisibleCount += 1;
      if (completion.hasConclusion) {
        primaryHasConclusion = true;
      }
      primaryVisibleText = primaryReplyText;
      round = await stepRound(round, "completed", "PRIMARY_COMPLETED", persist, {
        dispatchId,
        agentId: bot.agentId,
        payload: lateVisiblePrimary
          ? { ...completion, timedOut: true, softComplete: true, lateVisibleReply: true, taskType }
          : { ...completion },
      });
      // Same-round CollabEdge attach after PRIMARY_COMPLETED (≤2, depth 1).
      round = attachEdgesAfterPrimary({
        round,
        primaryText: raced.reply?.rawText ?? primaryReplyText,
        fromAgentId: bot.agentId,
        taskId: facts.activeContext.currentTaskId,
        bots: facts.bots as CollaborationBotTarget[],
      });
      if (round.edges?.length) {
        await writePersistedRound({
          round,
          tenantId: persist.tenantId,
          roundsDir: persist.roundsDir,
        });
      }
      if (lateVisiblePrimary) {
        // One member's soft deadline must not cancel other explicit invitations.
        // This never advances an in-flight or empty reply, or creates new members.
        primaryBudgetClosed = true;
        if (params.decision.primaryMode !== "explicit_multi") {
          break;
        }
      }
    } else if (isChitchatRound && raced.timedOut) {
      primaryBudgetClosed = true;
      round = await stepRound(round, "completed", "PRIMARY_COMPLETED", persist, {
        dispatchId,
        agentId: bot.agentId,
        payload: { ...completion, timedOut: true, softComplete: true, taskType },
      });
      break;
    } else {
      if (!raced.timedOut) {
        round = await stepRound(round, "placeholder", "PRIMARY_TIMEOUT", persist, {
          dispatchId,
          agentId: bot.agentId,
          payload: { ...completion },
        });
      }
      round = await stepRound(round, "timeout", "PRIMARY_TIMEOUT", persist, {
        dispatchId,
        agentId: bot.agentId,
      });
      const takeoverBot = effective.dispatch.allowSecondaryTakeover
        ? resolveSecondaryTakeoverBot({
            timedOutAgentId: bot.agentId,
            selected: [...leadBots, ...stages.supplement.bots],
          })
        : null;
      if (!takeoverBot) {
        round = { ...round, abortReason: "fatal" };
        return finishShadow(await stepRound(round, "abort", "ROUND_ABORTED", persist));
      }
      round = await stepRound(round, "takeover", "FALLBACK_STARTED", persist, {
        agentId: takeoverBot.agentId,
        payload: { from: bot.agentId },
      });
      const fallbackDispatchId = `${round.roundId}:fallback:${takeoverBot.agentId}`;
      const fallbackAccepted = acceptRoundDispatch({
        round,
        dispatchId: fallbackDispatchId,
        agentId: takeoverBot.agentId,
        role: "fallback",
      });
      round = fallbackAccepted.round;
      if (!fallbackAccepted.accepted) {
        round = { ...round, abortReason: "fatal" };
        return finishShadow(await stepRound(round, "fallback_failed", "ROUND_ABORTED", persist));
      }
      const fallbackReply = await runBot({
        bot: takeoverBot,
        role: "fallback",
        dispatchId: fallbackDispatchId,
        isWrapTurn: false,
      });
      const fallbackCompletion = classifyPrimaryCompletion(fallbackReply?.text ?? "", taskType, {
        mentionBotMustRespond: effective.participation.mentionBotMustRespond,
        acceptVisibleBody: params.decision.responseMode === "debate_or_brainstorm",
      });
      round = { ...round, completion: fallbackCompletion };
      if (fallbackCompletion.responseStatus !== "complete") {
        round = { ...round, abortReason: "fatal" };
        return finishShadow(await stepRound(round, "fallback_failed", "ROUND_ABORTED", persist));
      }
      primaryCompleted = true;
      leadVisibleCount += 1;
      primaryHasConclusion = fallbackCompletion.hasConclusion;
      primaryVisibleText = fallbackReply?.text ?? "";
      round = await stepRound(round, "fallback_completed", "FALLBACK_COMPLETED", persist, {
        dispatchId: fallbackDispatchId,
        agentId: takeoverBot.agentId,
        payload: { ...fallbackCompletion },
      });
      round = attachEdgesAfterPrimary({
        round,
        primaryText: fallbackReply?.rawText ?? fallbackReply?.text ?? "",
        fromAgentId: takeoverBot.agentId,
        taskId: facts.activeContext.currentTaskId,
        bots: facts.bots as CollaborationBotTarget[],
      });
      if (round.edges?.length) {
        await writePersistedRound({
          round,
          tenantId: persist.tenantId,
          roundsDir: persist.roundsDir,
        });
      }
      break;
    }
    if (cursor < leadBots.length - 1) {
      round = await stepRound(round, "queue_has_next", "PRIMARY_QUEUE_ENTERED", persist);
    }
  }

  await sleepMs(stages.coordinationDelayMs, input.signal);
  if (params.isAborted()) {
    return finishShadow(
      (await abortPersistedRound({
        groupId: authority.groupId,
        roundId: round.roundId,
        ...persist,
      })) ?? round,
    );
  }

  const leadIds = new Set(
    leadBots
      .map((bot) => normalizeAgentIdentifier(bot.agentId))
      .filter((id): id is string => Boolean(id)),
  );
  // Bots the human explicitly invited (@name / @所有人 broadcast) beyond the lead.
  // decision_to_executor executors are the core of that mode, not optional extras.
  const replyBudget = round.policyDecision?.visibleReplyBudget;
  const broadcastBudget = replyBudget?.kind === "broadcast";
  const invitedAgentIdsBaseline = new Set(
    [
      ...params.decision.roundPlan.participants
        .filter((participant) => participant.tier === "mention")
        .map((participant) => participant.agentId),
      ...(broadcastBudget || params.decision.responseMode === "decision_to_executor"
        ? stages.supplement.bots.map((bot) => bot.agentId)
        : []),
    ]
      .map((agentId) => normalizeAgentIdentifier(agentId))
      .filter((id): id is string => Boolean(id) && !leadIds.has(id as string)),
  );
  // v1-only — P0.2: group_broadcast / roll-call members count as invited (cheap-gate keep).
  const invitedAgentIds = expandV1RollCallInvitedAgentIds({
    scope: {
      groupId: authority.groupId,
      rawSessionKey: facts.rawSessionKey,
      title: facts.title,
      bots: facts.bots as CollaborationBotTarget[],
      tenantId: authority.tenantId,
    },
    decision: params.decision,
    invitedAgentIds: invitedAgentIdsBaseline,
  });
  const edgeTargetIds = new Set(
    (round.edges ?? [])
      .map((edge) => normalizeAgentIdentifier(edge.toAgentId))
      .filter((id): id is string => Boolean(id) && !leadIds.has(id as string)),
  );
  const invitedMemberPresent = stages.supplement.bots.some((bot) =>
    invitedAgentIds.has(normalizeAgentIdentifier(bot.agentId) ?? ""),
  );
  const invitedSupplementPresent = invitedMemberPresent || edgeTargetIds.size > 0;
  // A settled primary's soft deadline closes optional discussion, not an already
  // invited member's turn. Per-member admission, abort and visible limits still apply.
  const invitedContinuation = primaryBudgetClosed && invitedMemberPresent;
  const supplementStructurallyAllowed =
    primaryCompleted &&
    (!primaryBudgetClosed || invitedContinuation) &&
    params.decision.primaryMode !== "explicit_multi" &&
    frozen.supplement.enabled &&
    (params.decision.responseMode !== "single_owner" || edgeTargetIds.size > 0);
  // Structural conclusion opens the open window; explicit invitations (broadcast,
  // @mention, primary CollabEdge) open an invited-only window even without one.
  const supplementWindowReason: "conclusion" | "invited" | null = !supplementStructurallyAllowed
    ? null
    : !primaryBudgetClosed &&
        primaryHasConclusion &&
        !isChitchatRound &&
        params.decision.responseMode !== "single_owner"
      ? "conclusion"
      : invitedSupplementPresent
        ? "invited"
        : null;
  const allowSupplement = supplementWindowReason !== null;
  const recordSupplementDecision = (
    window: NonNullable<NonNullable<PersistedRound["policyDecision"]>["supplementWindow"]>,
    gate?: SupplementGateEntry[],
  ) => {
    if (!round.policyDecision) {
      return;
    }
    const structuralGate = {
      primaryCompleted,
      primaryBudgetClosed,
      invitedContinuation,
      primaryMode: String(params.decision.primaryMode ?? ""),
      supplementEnabled: Boolean(frozen.supplement.enabled),
      responseMode: String(params.decision.responseMode ?? ""),
      edgeTargetCount: edgeTargetIds.size,
      supplementStructurallyAllowed,
    };
    const edgeDiag = (round.edges ?? []).map((edge) => {
      const to = normalizeAgentIdentifier(edge.toAgentId) ?? edge.toAgentId;
      const dispatched = Boolean(
        gate?.some(
          (g) => g.decision === "KEEP" && (normalizeAgentIdentifier(g.agentId) ?? g.agentId) === to,
        ),
      );
      return {
        toAgentId: edge.toAgentId,
        kind: edge.kind,
        dispatched,
        ...(dispatched ? {} : { rejectReason: "not_dispatched_this_round" as const }),
      };
    });
    const diagnosis = buildSupplementDenialDiagnosis({
      roundId: round.roundId,
      effectivePolicyHash: round.policyDecision.effectivePolicyHash,
      policyVersion: round.policyDecision.protocolVersion,
      structuralGate,
      windowOpened: window.opened,
      windowReason: window.reason,
      edges: edgeDiag,
      ...(params.formalTaskEstablish
        ? { formalTask: params.formalTaskEstablish }
        : {
            formalTask: {
              attempted: false,
              status: "not_attempted",
              taskId: null,
            },
          }),
    });
    round = {
      ...round,
      policyDecision: {
        ...round.policyDecision,
        supplementWindow: window,
        ...(gate && gate.length > 0 ? { supplementGate: gate } : {}),
        supplementDenialDiagnosis: diagnosis,
      },
    };
  };

  if (allowSupplement) {
    round = await stepRound(
      round,
      "queue_exhausted_supplement",
      "SUPPLEMENT_WINDOW_OPENED",
      persist,
    );
    let kept = 0;
    let dispatched = 0;
    const gateLog: SupplementGateEntry[] = [];
    const visibleCap = Math.min(
      COLLABORATION_ABSOLUTE_VISIBLE_TURN_LIMIT,
      Math.max(
        1,
        broadcastBudget
          ? Math.min(replyBudget.limit, effective.participation.rollCall.ceiling)
          : Math.min(
              replyBudget?.limit ?? effective.participation.maxVisibleBotRepliesPerRound,
              effective.participation.maxVisibleBotRepliesPerRound,
            ),
      ),
    );
    // Only fill an empty planned queue. Same-round CollabEdges already nominate
    // targets via prioritizeSupplementBotsForEdges — do not add a third speaker.
    const autoSupplement =
      supplementWindowReason === "conclusion" &&
      stages.supplement.bots.length === 0 &&
      !round.edges?.length
        ? pickDutyDifferentiatedSupplement({
            facts,
            message: params.message,
            leadBots,
            bots: facts.bots as CollaborationBotTarget[],
            roundId: params.decision.roundId,
            responseMode: params.decision.responseMode,
          })
        : undefined;
    const orderedSupplementBots = prioritizeSupplementBotsForEdges({
      supplementBots: autoSupplement ? [autoSupplement] : stages.supplement.bots,
      edges: round.edges,
      allBots: facts.bots as CollaborationBotTarget[],
    }).filter((bot) => !leadIds.has(normalizeAgentIdentifier(bot.agentId) ?? ""));
    const supplementBots =
      supplementWindowReason === "invited"
        ? orderedSupplementBots.filter((bot) => {
            const id = normalizeAgentIdentifier(bot.agentId) ?? "";
            return invitedAgentIds.has(id) || (!primaryBudgetClosed && edgeTargetIds.has(id));
          })
        : orderedSupplementBots;
    const preserveConflict = effective.strategy.preserveConflict;
    const pendingLowRelevance: Array<{ bot: CollaborationBotTarget; relevance: number }> = [];

    const dispatchSupplement = async (bot: CollaborationBotTarget, edge?: CollabEdge) => {
      if (dispatched === 0) {
        round = await stepRound(round, "candidate_found", "SUPPLEMENT_DISPATCHED", persist, {
          agentId: bot.agentId,
          ...(edge ? { payload: { edgeKind: edge.kind, from: edge.fromAgentId } } : {}),
        });
      }
      const dispatchId = `${round.roundId}:supplement:${bot.agentId}`;
      const accepted = acceptRoundDispatch({
        round,
        dispatchId,
        agentId: bot.agentId,
        role: "supplement",
      });
      round = accepted.round;
      if (!accepted.accepted) {
        return;
      }
      kept += 1;
      dispatched += 1;
      await runBot({
        bot,
        role: "supplement",
        dispatchId,
        isWrapTurn: false,
        ...(edge ? { edge } : {}),
      });
    };

    for (const bot of supplementBots) {
      if (dispatched > 0) {
        await sleepMs(stages.coordinationDelayMs, input.signal);
      }
      if (params.isAborted()) {
        return finishShadow(
          (await abortPersistedRound({
            groupId: authority.groupId,
            roundId: round.roundId,
            ...persist,
          })) ?? round,
        );
      }
      const botId = normalizeAgentIdentifier(bot.agentId) ?? "";
      const edgeForBot = round.edges?.find(
        (edge) => normalizeAgentIdentifier(edge.toAgentId) === botId,
      );
      const invited = invitedAgentIds.has(botId);
      const gate: CheapGateResult =
        leadVisibleCount + dispatched >= visibleCap
          ? { decision: "DROP" as const, reason: "visible_limit" }
          : autoSupplement && bot.agentId === autoSupplement.agentId
            ? kept >= frozen.supplement.maxSupplementBots
              ? { decision: "DROP" as const, reason: "budget_limit" }
              : { decision: "KEEP" as const, reason: "auto_supplement" }
            : evaluateCheapGate({
                facts,
                bot,
                message: params.message,
                policy: frozen,
                responseMode: params.decision.responseMode,
                keptCount: kept,
                preserveConflict,
                invited,
                edgeKinds: round.edges
                  ?.filter((edge) => normalizeAgentIdentifier(edge.toAgentId) === botId)
                  .map((edge) => edge.kind),
              });
      gateLog.push({
        agentId: bot.agentId,
        decision: gate.decision,
        reason: gate.reason,
        ...(typeof gate.relevance === "number" ? { relevance: gate.relevance } : {}),
        ...(invited ? { invited: true } : {}),
        ...(edgeForBot ? { edgeKind: edgeForBot.kind } : {}),
      });
      if (!shouldDispatchCheapGate(gate)) {
        if (gate.reason === "low_relevance") {
          // Deferred: the top-scoring one may still be rescued below.
          pendingLowRelevance.push({ bot, relevance: gate.relevance ?? 0 });
          continue;
        }
        round = await recordCandidateDropped({
          round,
          persist,
          agentId: bot.agentId,
          reason: gate.reason,
        });
        continue;
      }
      await dispatchSupplement(bot, edgeForBot);
    }

    if (params.isAborted()) {
      return finishShadow(
        (await abortPersistedRound({
          groupId: authority.groupId,
          roundId: round.roundId,
          ...persist,
        })) ?? round,
      );
    }
    // Calibration: when the open window would otherwise drop everyone for
    // low_relevance, let the single top-scoring candidate through if the group
    // runs open discussion and the primary explicitly asked for others' input.
    // Redundancy guard still runs on that reply downstream.
    let rescuedAgentId: string | null = null;
    if (
      dispatched === 0 &&
      supplementWindowReason === "conclusion" &&
      pendingLowRelevance.length > 0 &&
      effective.participation.openDiscussionWithoutMention &&
      leadVisibleCount < visibleCap &&
      primaryInvitesSupplementInput({
        text: primaryVisibleText,
        bots: facts.bots as CollaborationBotTarget[],
        excludeAgentIds: leadIds,
      })
    ) {
      const top = pendingLowRelevance.toSorted(
        (left, right) => right.relevance - left.relevance,
      )[0];
      if (top) {
        rescuedAgentId = top.bot.agentId;
        gateLog.push({
          agentId: top.bot.agentId,
          decision: "KEEP",
          reason: "rescued_top_candidate",
          relevance: top.relevance,
        });
        await dispatchSupplement(top.bot);
      }
    }
    for (const entry of pendingLowRelevance) {
      if (entry.bot.agentId === rescuedAgentId) {
        continue;
      }
      round = await recordCandidateDropped({
        round,
        persist,
        agentId: entry.bot.agentId,
        reason: "low_relevance",
      });
    }
    recordSupplementDecision({ opened: true, reason: supplementWindowReason }, gateLog);
    if (dispatched === 0) {
      if (round.state === "SUPPLEMENT_WINDOW") {
        round = await stepRound(round, "no_candidate", "CONVERGENCE_CHECKED", persist);
      }
    } else if (round.state === "SUPPLEMENTING") {
      round = await stepRound(round, "supplement_finished", "CONVERGENCE_CHECKED", persist);
    }
  } else {
    recordSupplementDecision({
      opened: false,
      reason: supplementStructurallyAllowed ? "no_conclusion" : "not_allowed",
    });
    if (round.state === "PRIMARY_COMPLETED") {
      round = await stepRound(
        round,
        "queue_exhausted_no_supplement",
        "CONVERGENCE_CHECKED",
        persist,
      );
    }
  }

  const shouldWrap =
    !isChitchatRound &&
    !primaryBudgetClosed &&
    frozen.coordinator.enabled &&
    stages.wrap.bots.length > 0;
  if (round.state === "CONVERGENCE_CHECK" && shouldWrap) {
    round = await stepRound(round, "close_required", "CLOSE_STARTED", persist);
    for (const bot of stages.wrap.bots) {
      if (params.isAborted()) {
        return finishShadow(
          (await abortPersistedRound({
            groupId: authority.groupId,
            roundId: round.roundId,
            ...persist,
          })) ?? round,
        );
      }
      const dispatchId = `${round.roundId}:close:${bot.agentId}`;
      const accepted = acceptRoundDispatch({
        round,
        dispatchId,
        agentId: bot.agentId,
        role: "close",
      });
      round = accepted.round;
      if (!accepted.accepted) {
        continue;
      }
      await runBot({
        bot,
        role: "close",
        dispatchId,
        isWrapTurn: true,
      });
    }
    if (params.isAborted()) {
      return finishShadow(
        (await abortPersistedRound({
          groupId: authority.groupId,
          roundId: round.roundId,
          ...persist,
        })) ?? round,
      );
    }
    if (round.state === "OPTIONAL_CLOSE") {
      round = await stepRound(round, "close_completed", "ROUND_COMPLETED", persist);
    }
  } else if (round.state === "CONVERGENCE_CHECK") {
    round = await stepRound(round, "close_not_required", "ROUND_COMPLETED", persist);
  }

  return finishShadow(round);
}

export { parseChatContextScopeRequest, resolveCollaborationPolicyV1 };
export type { ChatContextScopePayload, ContextScopeRequest };
