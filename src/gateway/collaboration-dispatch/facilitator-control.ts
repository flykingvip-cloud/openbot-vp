/**
 * P0 G3 — Facilitator control plane on the G2 single-beat observation point.
 *
 * Coordinator is not the speaker. This module does not select who speaks
 * and does not append anyone to a participant list. It gates control actions
 * while the episode sits in
 * FACILITATOR_OBSERVE (after beat_done, before the beat is left).
 *
 * Gate outcomes stay the existing Episode Decision Record set:
 *   authorized | denied | route_to_task_governance
 *
 * `collaboration.episodeStore` (default off) gates the observation. When it is
 * off, nothing is stamped and the ledger is not touched. Copying the same
 * array onto an Episode Decision Record still requires
 * `collaboration.ledger.decisionRecords` (default off).
 */
import type { OpenBotConfig } from "../../config/types.js";
import { beatIdForEpisode, type CollaborationEventKey } from "./collaboration-event-key.js";
import type { EffectiveCollaborationPolicy } from "./effective-policy.js";
import {
  EPISODE_FACILITATOR_GATE_KINDS,
  isCollabLedgerDecisionRecordsEnabled,
  writeBeatDecisionRecords,
  type EpisodeFacilitatorGateKind,
} from "./episode-decision-record.js";
import { classifyEpisodeIntent, type EpisodeIntentInput } from "./episode-intent.js";
import type { EpisodeTransitionEvent, PersistedEpisode } from "./episode-state.js";
import { isCollabEpisodeStoreEnabled, stampEpisodeFacilitator } from "./episode-store.js";
import {
  facilitatorNextBeatOutcome,
  MULTI_BEAT_DEFAULT_MAX,
  resolveMaxBeatsPerEpisode,
} from "./multi-beat-gate.js";
import { resolveEpisodeNeed } from "./need-resolver.js";

export type FacilitatorControlRequest = {
  actionId: string;
  /** Existing episode event this action would take from FACILITATOR_OBSERVE. */
  event: EpisodeTransitionEvent;
};

export type FacilitatorGateEntry = {
  actionId: string;
  outcome: EpisodeFacilitatorGateKind;
};

export type FacilitatorLeaveEvent = "stop_loop" | "route_to_task_governance" | "converged";

export type FacilitatorObservation = {
  facilitator: FacilitatorGateEntry[];
  leaveEvent: FacilitatorLeaveEvent;
  /** Copy of the G8 participant ids. Same order. Not the input array. */
  participantIds: string[];
};

const GATE_KIND_SET = new Set<string>(EPISODE_FACILITATOR_GATE_KINDS);

/**
 * Single-beat observe always proposes stop_loop. Extra requests are appended.
 * Speaker selection is not a request this function understands.
 */
export function singleBeatControlRequests(
  extra: readonly FacilitatorControlRequest[] | undefined,
): FacilitatorControlRequest[] {
  const requests: FacilitatorControlRequest[] = [{ actionId: "stop_loop", event: "stop_loop" }];
  const seen = new Set<string>(["stop_loop\0stop_loop"]);
  for (const request of extra ?? []) {
    const actionId = request.actionId.trim();
    if (!actionId) {
      continue;
    }
    const token = `${actionId}\0${request.event}`;
    if (seen.has(token)) {
      continue;
    }
    seen.add(token);
    requests.push({ actionId, event: request.event });
  }
  return requests;
}

/**
 * Gate control actions. Denied events are not applied by the caller:
 * redirect and authorized_action would open another beat or re-enter
 * participant selection. handoff_proposed stays denied here so this plane
 * does not turn Handoff on. next_beat is denied while maxBeatsPerEpisode is 1
 * (default); when the P5 raise gate opens (maxBeats > 1) it may be recorded
 * as authorized — observation only; G2 single-beat runtime still refuses to
 * apply next_beat (no multi-beat controller).
 */
export function gateFacilitatorControl(params: {
  requests: readonly FacilitatorControlRequest[];
  participantIds: readonly string[];
  /** From collaboration.episode.maxBeats / EffectivePolicy. Default 1. */
  maxBeatsPerEpisode?: number;
}): FacilitatorObservation {
  const participantIds = params.participantIds.map((id) => id);
  const facilitator: FacilitatorGateEntry[] = [];
  let route = false;
  let stop = false;
  const maxBeats =
    typeof params.maxBeatsPerEpisode === "number"
      ? params.maxBeatsPerEpisode
      : MULTI_BEAT_DEFAULT_MAX;
  for (const request of params.requests) {
    const actionId = request.actionId.trim();
    if (!actionId) {
      continue;
    }
    const outcome = outcomeFor(request.event, maxBeats);
    if (!GATE_KIND_SET.has(outcome)) {
      continue;
    }
    facilitator.push({ actionId, outcome });
    if (outcome === "route_to_task_governance") {
      route = true;
    } else if (request.event === "stop_loop" && outcome === "authorized") {
      stop = true;
    }
  }
  const leaveEvent: FacilitatorLeaveEvent = route
    ? "route_to_task_governance"
    : stop
      ? "stop_loop"
      : "converged";
  return { facilitator, leaveEvent, participantIds };
}

function outcomeFor(
  event: EpisodeTransitionEvent,
  maxBeatsPerEpisode: number,
): EpisodeFacilitatorGateKind {
  if (event === "stop_loop") {
    return "authorized";
  }
  if (event === "route_to_task_governance") {
    return "route_to_task_governance";
  }
  if (event === "next_beat") {
    return facilitatorNextBeatOutcome(maxBeatsPerEpisode);
  }
  return "denied";
}

export type FacilitatorDecisionContext = {
  cfg?: OpenBotConfig;
  episodesDir: string;
  episode: PersistedEpisode;
  requests: readonly FacilitatorControlRequest[];
  participantIds: readonly string[];
  admittedIds: readonly string[];
  plannedParticipants?: ReadonlyArray<{
    agentId: string;
    contributionRole?: string;
    reasonText?: string;
  }>;
  message?: string;
  mentionMode?: EpisodeIntentInput["mentionMode"];
  responseMode?: string;
  groupId: string;
  tenantId?: string | null;
  episodeId: string;
  roundId: string;
  policySnapshotId: string;
  policyHash?: string | null;
  provenanceHash?: string | null;
  compilerRevision?: string | null;
  key?: CollaborationEventKey | null;
  effective?: EffectiveCollaborationPolicy;
};

export type FacilitatorRecordResult = FacilitatorObservation & {
  enabled: boolean;
  episode: PersistedEpisode;
  wroteDecisionRecord: boolean;
};

/**
 * Flag off: no stamp, no ledger I/O, participant ids copied and returned.
 * Flag on: stamp facilitator[] on the episode, then copy it onto the Episode
 * Decision Record when the ledger flag is also on.
 */
export async function recordFacilitatorObservation(
  params: FacilitatorDecisionContext,
): Promise<FacilitatorRecordResult> {
  const maxBeatsPerEpisode =
    params.effective?.dispatch?.tuning?.floor?.beats?.maxBeatsPerEpisode ??
    resolveMaxBeatsPerEpisode(params.cfg);
  const observation = gateFacilitatorControl({
    requests: params.requests,
    participantIds: params.participantIds,
    maxBeatsPerEpisode,
  });
  if (!isCollabEpisodeStoreEnabled(params.cfg)) {
    return {
      ...observation,
      enabled: false,
      episode: params.episode,
      wroteDecisionRecord: false,
    };
  }
  const episode = await stampEpisodeFacilitator({
    episodesDir: params.episodesDir,
    episode: params.episode,
    facilitator: observation.facilitator,
  });
  const wroteDecisionRecord = await writeFacilitatorDecisionRecord(params, observation.facilitator);
  return { ...observation, enabled: true, episode, wroteDecisionRecord };
}

async function writeFacilitatorDecisionRecord(
  params: FacilitatorDecisionContext,
  facilitator: readonly FacilitatorGateEntry[],
): Promise<boolean> {
  if (!isCollabLedgerDecisionRecordsEnabled(params.cfg)) {
    return false;
  }
  const effective = params.effective;
  const provenanceHash = params.provenanceHash?.trim() ?? "";
  const policyHash = (params.key?.policyHash || params.policyHash || "").trim();
  const compilerRevision = (params.key?.compilerRevision || params.compilerRevision || "").trim();
  const policySnapshotId = (params.key?.policySnapshotId || params.policySnapshotId).trim();
  if (!effective || !provenanceHash || !policyHash || !compilerRevision || !policySnapshotId) {
    return false;
  }
  const beatId = params.key?.beatId?.trim() || beatIdForEpisode(params.episodeId, 0);
  const intent = classifyEpisodeIntent({
    message: params.message,
    mentionMode: params.mentionMode,
    responseMode: params.responseMode,
  });
  const admitted = params.admittedIds.map((id) => id);
  const planned = params.plannedParticipants ?? [];
  try {
    const result = await writeBeatDecisionRecords({
      key: {
        tenantId: params.tenantId ?? params.key?.tenantId ?? null,
        groupId: params.groupId,
        episodeId: params.episodeId,
        beatId,
        policySnapshotId,
        policyHash,
        compilerRevision,
      },
      protocol: "legacy",
      intent,
      provenanceHash,
      decideBranch: "legacy",
      legacy: {
        admitted,
        primaryQueue: admitted,
        dropped: [],
      },
      need: resolveEpisodeNeed({ intent }),
      facilitator: facilitator.map((item) => ({ ...item })),
      roundId: params.roundId,
      mode: effective.strategy.id,
      policyConstraints: [...effective.clamps],
      participants:
        planned.length > 0
          ? planned.map((participant) => ({
              agentId: participant.agentId,
              tier: tierForRole(participant.contributionRole),
              reason: participant.reasonText ?? "",
            }))
          : admitted.map((agentId) => ({
              agentId,
              tier: "primary" as const,
              reason: "legacy",
            })),
      provenance: effective.provenance,
      cfg: params.cfg,
    });
    return result.wroteEpisodeDecision;
  } catch {
    // A ledger miss must not abort the G8 round or the single-beat close.
    return false;
  }
}

function tierForRole(role: string | undefined): "primary" | "contributor" | "wrap" {
  if (role === "wrap") {
    return "wrap";
  }
  if (role === "lead") {
    return "primary";
  }
  return "contributor";
}
