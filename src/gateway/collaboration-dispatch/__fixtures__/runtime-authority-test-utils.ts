import { episodeIdForClientRun } from "../collaboration-event-key.js";
import { decideParticipants as decideParticipantsAuthority } from "../decision-engine.js";
import type { RoundPolicySnapshot } from "../round-policy-snapshot.js";
import {
  executeCollaborationRound as executeCollaborationRoundAuthority,
  type RoundDispatchRunner,
} from "../round-runtime.js";
import {
  buildGroupRuntimeAuthority,
  type BeatExecutionInput,
  type DecideInput,
  type RuntimeAuthority,
  type RuntimeFacts,
} from "../runtime-authority.js";
import type { CollaborationDispatchScope, ParticipationDecision } from "../types.js";

/** Build branded authority+facts from a test scope (composition-root equivalent). */
export function testAuthorityFromScope(
  scope: CollaborationDispatchScope,
  opts?: {
    episodeId?: string;
    snapshot?: RoundPolicySnapshot | null;
    roundId?: string;
  },
): { authority: RuntimeAuthority; facts: RuntimeFacts; snapshot: RoundPolicySnapshot } {
  const episodeId =
    opts?.episodeId ?? episodeIdForClientRun(opts?.roundId ?? `test-${scope.groupId || "group"}`);
  return buildGroupRuntimeAuthority({
    scope,
    episodeId,
    ...(opts?.snapshot !== undefined ? { snapshot: opts.snapshot } : {}),
  });
}

export function decideParticipantsForTest(params: {
  message: string;
  scope: CollaborationDispatchScope;
  roundId: string;
  explicitMentions?: string[];
  explicitMentionRefs?: DecideInput["explicitMentionRefs"];
  recentGroupMessages?: unknown[];
  senderLabel?: string | null;
  nowMs?: number;
  policySnapshot?: RoundPolicySnapshot | null;
}): ParticipationDecision {
  const { authority, facts } = testAuthorityFromScope(params.scope, {
    roundId: params.roundId,
    snapshot: params.policySnapshot,
  });
  return decideParticipantsAuthority(authority, facts, {
    message: params.message,
    roundId: params.roundId,
    explicitMentions: params.explicitMentions,
    explicitMentionRefs: params.explicitMentionRefs,
    recentGroupMessages: params.recentGroupMessages,
    senderLabel: params.senderLabel,
    nowMs: params.nowMs,
    operatingState: params.scope.operatingState ?? null,
  });
}

export async function executeCollaborationRoundForTest(params: {
  lifecycle?: BeatExecutionInput["lifecycle"];
  admittedTaskId?: string;
  scope: CollaborationDispatchScope;
  decision: ParticipationDecision;
  message: string;
  sessionKey: string;
  isAborted?: () => boolean;
  signal?: AbortSignal;
  runBot: RoundDispatchRunner;
  policySnapshot?: RoundPolicySnapshot | null;
  eventKey?: BeatExecutionInput["eventKey"];
  tenantId?: string | null;
  roundsDir?: string;
  skipRoundIds?: Iterable<string>;
  inboundDepth?: BeatExecutionInput["inboundDepth"];
  contextScopeRequest?: BeatExecutionInput["contextScopeRequest"];
  contextScope?: BeatExecutionInput["contextScope"];
  onPrimaryDeadline?: () => void;
  policy?: BeatExecutionInput["policy"];
  /** P0 G8. Production chat passes the legacy executor id. */
  productionExecutor?: BeatExecutionInput["productionExecutor"];
}) {
  const { authority, facts } = testAuthorityFromScope(params.scope, {
    roundId: params.decision.roundId,
    snapshot: params.policySnapshot,
  });
  return executeCollaborationRoundAuthority(authority, facts, {
    lifecycle: params.lifecycle,
    admittedTaskId: params.admittedTaskId,
    decision: params.decision,
    message: params.message,
    sessionKey: params.sessionKey,
    isAborted: params.isAborted ?? (() => false),
    signal: params.signal,
    runBot: params.runBot as BeatExecutionInput["runBot"],
    skipRoundIds: params.skipRoundIds,
    inboundDepth: params.inboundDepth,
    contextScopeRequest: params.contextScopeRequest,
    contextScope: params.contextScope,
    onPrimaryDeadline: params.onPrimaryDeadline,
    policy: params.policy,
    eventKey: params.eventKey,
    roundsDir: params.roundsDir,
    ...(params.productionExecutor ? { productionExecutor: params.productionExecutor } : {}),
  });
}
