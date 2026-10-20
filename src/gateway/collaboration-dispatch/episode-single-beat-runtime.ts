/**
 * P0 G2 — flag-gated single-beat Episode runtime.
 *
 * `collaboration.episodeStore` stays default off. When it is off, this module
 * only invokes the caller's round callback (G8). When it is on:
 *   1. `beginSingleBeatEpisodeRuntime` creates the Episode at EPISODE_CREATED.
 *   2. It advances that record on the existing table in episode-state-machine.ts.
 *   3. `finishSingleBeatEpisodeRuntime` stops when the one Beat ends.
 *
 * One round keeps at most one Beat (index 0). `next_beat` is refused.
 * Episode files stay under the episodes directory; this module does not import
 * the round store. At FACILITATOR_OBSERVE the Facilitator control plane (G3)
 * gates stop_loop / route_to_task_governance and writes facilitator[]. It does
 * not choose speakers. Floor live and namespace cutover stay out of scope.
 * `BeatExecutionInput` is still only the round parameter.
 */
import path from "node:path";
import type { OpenBotConfig } from "../../config/types.js";
import { beatIdForEpisode, type CollaborationEventKey } from "./collaboration-event-key.js";
import type { EffectiveCollaborationPolicy } from "./effective-policy.js";
import {
  isEpisodeTerminal,
  type EpisodeState,
  type EpisodeTransitionEvent,
  type PersistedEpisode,
} from "./episode-state.js";
import {
  applyEpisodeTransition,
  createPersistedEpisode,
  isCollabEpisodeStoreEnabled,
  readPersistedEpisode,
  recoverIncompleteEpisodes,
  seedPersistedEpisode,
} from "./episode-store.js";
import {
  recordFacilitatorObservation,
  singleBeatControlRequests,
  type FacilitatorControlRequest,
} from "./facilitator-control.js";
import { resolveCollaborationRuntimeFactPaths } from "./runtime-namespace.js";

export type SingleBeatEpisodeDecision = {
  mentionUnmatched: boolean;
  mentionConfirm?: unknown;
  executionBots: readonly { agentId: string }[];
  /** Copied onto the decision record. Never rewritten by the control plane. */
  primaryQueue?: readonly string[];
  responseMode?: string;
  mentionMode?: "none" | "single_primary" | "explicit_multi" | "broadcast";
  roundPlan?: {
    participants?: ReadonlyArray<{
      agentId: string;
      contributionRole?: string;
      reasonText?: string;
    }>;
  };
};

export type SingleBeatEpisodeRuntimeParams = {
  cfg?: OpenBotConfig;
  groupId: string;
  tenantId?: string | null;
  episodeId: string;
  roundId: string;
  policySnapshotId: string;
  policyHash?: string | null;
  provenanceHash?: string | null;
  compilerRevision?: string | null;
  key?: CollaborationEventKey | null;
  decision: SingleBeatEpisodeDecision;
  /**
   * Extra control actions evaluated at FACILITATOR_OBSERVE.
   * stop_loop is always proposed by the single-beat path.
   * These do not change executionBots or primaryQueue.
   */
  controlActions?: readonly FacilitatorControlRequest[];
  /** Used only to classify the Episode Decision Record when the ledger flag is on. */
  message?: string;
  effective?: EffectiveCollaborationPolicy;
  /** Test override. Production resolves the episodes directory, never a rounds path. */
  episodesDir?: string;
  now?: number;
};

export type SingleBeatEpisodeSession =
  | { readonly enabled: false }
  | {
      readonly enabled: true;
      readonly episodesDir: string;
      episode: PersistedEpisode;
      readonly params: SingleBeatEpisodeRuntimeParams;
    };

const OPENING_HEAD: readonly EpisodeTransitionEvent[] = [
  "snapshot_bound",
  "resolve_context",
  "classified",
];

/** After the Facilitator observation, the single beat commits and stops. */
const AFTER_OBSERVE: readonly EpisodeTransitionEvent[] = ["pass", "committed"];

function assertSingleBeatEvent(event: EpisodeTransitionEvent): void {
  if (event === "next_beat") {
    throw new Error("P0 G2: single-beat runtime stops at beat end and refuses next_beat");
  }
}

function assertAtMostOneBeat(episode: PersistedEpisode): void {
  if (episode.beats.length > 1) {
    throw new Error(
      `P0 G2: episode ${episode.episodeId} has ${episode.beats.length} beats; single-beat allows one`,
    );
  }
  for (const beat of episode.beats) {
    if (beat.beatIndex !== 0) {
      throw new Error(
        `P0 G2: episode ${episode.episodeId} beat index ${beat.beatIndex} is past the single beat`,
      );
    }
  }
}

function waitsForUser(decision: SingleBeatEpisodeDecision): boolean {
  return decision.mentionUnmatched || Boolean(decision.mentionConfirm);
}

function openingEvents(decision: SingleBeatEpisodeDecision): EpisodeTransitionEvent[] {
  if (waitsForUser(decision)) {
    return [...OPENING_HEAD, "unmatched_mention"];
  }
  if (decision.executionBots.length === 0) {
    return [...OPENING_HEAD, "eligibility", "none_eligible"];
  }
  return [...OPENING_HEAD, "eligibility", "ranked", "admitted"];
}

function resolveEpisodesDir(params: SingleBeatEpisodeRuntimeParams): string {
  if (params.episodesDir) {
    return params.episodesDir;
  }
  const facts = resolveCollaborationRuntimeFactPaths({
    groupId: params.groupId,
    tenantId: params.tenantId,
    cfg: params.cfg,
  });
  if (facts.namespace) {
    return facts.namespace.episodesDir;
  }
  return path.join(path.dirname(facts.roundsDir), "episodes");
}

async function walkEpisode(params: {
  episode: PersistedEpisode;
  events: readonly EpisodeTransitionEvent[];
  episodesDir: string;
  roundId: string;
  now?: number;
}): Promise<PersistedEpisode> {
  let current = params.episode;
  for (const event of params.events) {
    assertSingleBeatEvent(event);
    if (isEpisodeTerminal(current.state)) {
      break;
    }
    const result = await applyEpisodeTransition({
      episode: current,
      event,
      episodesDir: params.episodesDir,
      eventId: `g2:${current.episodeId}:${event}`,
      legacyDecisionRef: event === "ranked" ? params.roundId : undefined,
      note: "single-beat",
      now: params.now,
    });
    current = result.episode;
    assertAtMostOneBeat(current);
  }
  return current;
}

function closingEvents(state: EpisodeState, roundState: string | null): EpisodeTransitionEvent[] {
  if (isEpisodeTerminal(state)) {
    return [];
  }
  if (state === "WAITING_USER") {
    if (!roundState || roundState === "ROUND_ABORTED") {
      return ["abort"];
    }
    return ["notice_sent"];
  }
  // BEAT_ACTIVE + ROUND_COMPLETE is handled in finish so the Facilitator
  // observation can run between beat_done and the leave event.
  return ["abort"];
}

function participantIdsOf(decision: SingleBeatEpisodeDecision): string[] {
  const planned = decision.roundPlan?.participants
    ?.map((participant) => participant.agentId.trim())
    .filter(Boolean);
  if (planned && planned.length > 0) {
    return planned;
  }
  return decision.executionBots.map((bot) => bot.agentId.trim()).filter(Boolean);
}

function admittedIdsOf(
  decision: SingleBeatEpisodeDecision,
  participantIds: readonly string[],
): string[] {
  if (decision.primaryQueue) {
    return decision.primaryQueue.map((id) => id);
  }
  return participantIds.map((id) => id);
}

/**
 * Create the Episode and walk it up to the single Beat (or to an early close).
 * Flag off returns a disabled session and does not touch the store.
 */
export async function beginSingleBeatEpisodeRuntime(
  params: SingleBeatEpisodeRuntimeParams,
): Promise<SingleBeatEpisodeSession> {
  if (!isCollabEpisodeStoreEnabled(params.cfg)) {
    return { enabled: false };
  }
  if (!params.groupId.trim() || !params.episodeId.trim() || !params.roundId.trim()) {
    throw new Error("P0 G2: groupId, episodeId, and roundId are required");
  }
  if (!params.policySnapshotId.trim()) {
    throw new Error("P0 G2: policySnapshotId is required to open an episode");
  }
  const episodesDir = resolveEpisodesDir(params);
  await recoverIncompleteEpisodes({
    episodesDir,
    cfg: params.cfg,
    skipEpisodeIds: [params.episodeId],
    now: params.now,
  });
  const admitBeat = !waitsForUser(params.decision) && params.decision.executionBots.length > 0;
  let episode = await seedPersistedEpisode({
    episodesDir,
    episode: createPersistedEpisode({
      episodeId: params.episodeId,
      groupId: params.groupId,
      tenantId: params.tenantId,
      protocol: "legacy",
      state: "EPISODE_CREATED",
      policySnapshotId: params.policySnapshotId,
      policyHash: params.policyHash,
      provenanceHash: params.provenanceHash,
      compilerRevision: params.compilerRevision,
      beats: admitBeat
        ? [
            {
              beatId: beatIdForEpisode(params.episodeId, 0),
              beatIndex: 0,
              roundId: params.roundId,
            },
          ]
        : [],
      now: params.now,
      key: params.key,
    }),
  });
  assertAtMostOneBeat(episode);
  if (episode.state === "EPISODE_CREATED" && episode.stateVersion === 0) {
    episode = await walkEpisode({
      episode,
      events: openingEvents(params.decision),
      episodesDir,
      roundId: params.roundId,
      now: params.now,
    });
  }
  return { enabled: true, episodesDir, episode, params };
}

async function closeSingleBeat(
  session: Extract<SingleBeatEpisodeSession, { enabled: true }>,
  loaded: PersistedEpisode,
  roundState: string | null,
): Promise<PersistedEpisode> {
  const ready =
    roundState === "ROUND_COMPLETE" &&
    (loaded.state === "BEAT_ACTIVE" || loaded.state === "FACILITATOR_OBSERVE");
  if (!ready) {
    return await walkEpisode({
      episode: loaded,
      events: closingEvents(loaded.state, roundState),
      episodesDir: session.episodesDir,
      roundId: loaded.beats[0]?.roundId ?? loaded.episodeId,
    });
  }
  let current = loaded;
  if (current.state === "BEAT_ACTIVE") {
    current = await walkEpisode({
      episode: current,
      events: ["beat_done"],
      episodesDir: session.episodesDir,
      roundId: current.beats[0]?.roundId ?? current.episodeId,
    });
  }
  if (current.state !== "FACILITATOR_OBSERVE") {
    return await walkEpisode({
      episode: current,
      events: closingEvents(current.state, roundState),
      episodesDir: session.episodesDir,
      roundId: current.beats[0]?.roundId ?? current.episodeId,
    });
  }
  const decision = session.params.decision;
  const participantIds = participantIdsOf(decision);
  const recorded = await recordFacilitatorObservation({
    cfg: session.params.cfg,
    episodesDir: session.episodesDir,
    episode: current,
    requests: singleBeatControlRequests(session.params.controlActions),
    participantIds,
    admittedIds: admittedIdsOf(decision, participantIds),
    plannedParticipants: decision.roundPlan?.participants,
    message: session.params.message,
    mentionMode: decision.mentionMode,
    responseMode: decision.responseMode,
    groupId: session.params.groupId,
    tenantId: session.params.tenantId,
    episodeId: session.params.episodeId,
    roundId: session.params.roundId,
    policySnapshotId: session.params.policySnapshotId,
    policyHash: session.params.policyHash,
    provenanceHash: session.params.provenanceHash,
    compilerRevision: session.params.compilerRevision,
    key: session.params.key,
    effective: session.params.effective,
  });
  if (recorded.participantIds.join("\0") !== participantIds.join("\0")) {
    throw new Error("P0 G3: facilitator observation changed the participant list");
  }
  return await walkEpisode({
    episode: recorded.episode,
    events: [recorded.leaveEvent, ...AFTER_OBSERVE],
    episodesDir: session.episodesDir,
    roundId: current.beats[0]?.roundId ?? current.episodeId,
  });
}

/**
 * Stop the Episode when the Beat ends. Terminal records stay terminal.
 * Does not start another Beat.
 */
export async function finishSingleBeatEpisodeRuntime(
  session: SingleBeatEpisodeSession,
  round: { state?: string } | null | undefined,
): Promise<PersistedEpisode | null> {
  if (!session.enabled) {
    return null;
  }
  const loaded =
    (await readPersistedEpisode({
      episodesDir: session.episodesDir,
      episodeId: session.episode.episodeId,
    })) ?? session.episode;
  assertAtMostOneBeat(loaded);
  if (isEpisodeTerminal(loaded.state)) {
    return loaded;
  }
  const roundState = typeof round?.state === "string" ? round.state : null;
  const episode = await closeSingleBeat(session, loaded, roundState);
  if (!isEpisodeTerminal(episode.state)) {
    throw new Error(`P0 G2: single-beat runtime stopped in non-terminal state ${episode.state}`);
  }
  return episode;
}

/**
 * Flag off: return `executeRound()` with no store I/O.
 * Flag on: create, advance, run the one round, then stop the Episode.
 */
export async function runSingleBeatEpisodeAroundRound<T>(
  params: SingleBeatEpisodeRuntimeParams & {
    executeRound: () => Promise<T>;
  },
): Promise<T> {
  if (!isCollabEpisodeStoreEnabled(params.cfg)) {
    return await params.executeRound();
  }
  const session = await beginSingleBeatEpisodeRuntime(params);
  let round: T;
  try {
    round = await params.executeRound();
  } catch (error) {
    await finishSingleBeatEpisodeRuntime(session, null);
    throw error;
  }
  const outcome =
    round && typeof round === "object" && "state" in round ? (round as { state?: string }) : null;
  await finishSingleBeatEpisodeRuntime(session, outcome);
  return round;
}
