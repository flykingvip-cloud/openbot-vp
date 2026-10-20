/**
 * Floor Runtime v2.1 §2.11 / §5.6 P1-B② — EDR + PDR v2 ledger writers.
 *
 * Flag `collaboration.ledger.decisionRecords` (plan `collab.ledger.decisionRecords`) defaults off.
 * Flag-off: `writeBeatDecisionRecords` does no I/O and is not imported by chat / round-runtime.
 * Flag-on: one beat appends exactly one episode_decision and one policy_decision, each with a
 * complete CollaborationEventKey (beatId required), then `recoverIncompleteEpisodes` skips that episode.
 * Non-goals: HandoffContract, Floor protocol production path. No round-store write imports.
 * P1-C: when `collaboration.floor.protocol === "shadow"` and the caller passes
 * `shadowSignals`, need / outcome are filled from the shadow classifier. The
 * shadow sink append is fail-closed and does not run unless that flag is shadow.
 * Unset / legacy / floor leave this writer byte-for-byte unchanged.
 * P2-A: when `collaboration.floor.shadowStage === "A"` and the caller passes
 * `floorShadow`, the EDR gains `floor` + `floorCompare`. Otherwise those fields
 * stay absent. The ledger append itself still requires decisionRecords.
 * P2 gap fix: Stage A/B after-round writers set `legacy.admitted` from
 * `executionBots` (full production speakers), not lead-only `primaryQueue`.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { getRuntimeConfigSnapshot, loadConfig } from "../../config/config.js";
import type { OpenBotConfig } from "../../config/types.js";
import {
  appendCollaborationEpisodeDecisionRecord,
  appendCollaborationPolicyDecisionRecord,
} from "../collaboration-ledger/writer.js";
import {
  isCompleteCollaborationEventKey,
  type CollaborationEventKey,
} from "./collaboration-event-key.js";
import {
  COLLABORATION_POLICY_PROTOCOL_VERSION,
  type CollaborationModeTemplateId,
  type EffectivePolicyProvenance,
  type FloorProtocol,
  type PolicyClamp,
  type PolicyDecisionParticipant,
  type PolicyDecisionRecord,
} from "./effective-policy.js";
import { COLLABORATION_INTENT_KINDS, type CollaborationIntentKind } from "./episode-intent.js";
import { recoverIncompleteEpisodes } from "./episode-store.js";
import { fillFloorShadowBeat, recordFloorShadowDecision } from "./floor-shadow-bridge.js";
import {
  compareLegacyFloorAdmission,
  type FloorLegacyCompare,
  type FloorShadowAttachment,
} from "./floor-shadow-plan.js";
import {
  EPISODE_DECISION_NEED_SOURCES,
  resolveEpisodeNeed,
  type EpisodeDecisionNeedSource,
} from "./need-resolver.js";
import type { PersistedRound } from "./round-state.js";
import { withRoundLock } from "./round-store-io.js";
import type { RuntimeAuthority } from "./runtime-authority.js";
import { resolveCollaborationRuntimeFactPaths } from "./runtime-namespace.js";
import { isCollabFloorShadowStageA, isCollabFloorShadowStageB } from "./shadow-stage-flag.js";
import type { ParticipationDecision } from "./types.js";

export const EPISODE_DECISION_SCHEMA_VERSION = 2 as const;
export const POLICY_DECISION_SCHEMA_VERSION = 2 as const;
export const EPISODE_DECISION_QUALITY_CLASSIFIER_VERSION = "useful-v1" as const;

export { COLLABORATION_INTENT_KINDS, type CollaborationIntentKind };
export { EPISODE_DECISION_NEED_SOURCES, type EpisodeDecisionNeedSource };

export const EPISODE_FACILITATOR_GATE_KINDS = [
  "authorized",
  "denied",
  "route_to_task_governance",
] as const;

export type EpisodeFacilitatorGateKind = (typeof EPISODE_FACILITATOR_GATE_KINDS)[number];

/** CollaborationEventKey for one beat. beatId is required (§2.11). */
export type BeatCollaborationEventKey = Omit<CollaborationEventKey, "beatId"> & {
  beatId: string;
};

/**
 * Optional floor slice. P1-B② only stores it when a caller supplies one.
 * This module does not build Floor plans, bids, or admission.
 */
export type EpisodeDecisionFloorSlice = Readonly<{
  plan: Readonly<{
    episodeId: string;
    intent: CollaborationIntentKind;
    policyHash: string;
  }>;
  bids?: ReadonlyArray<{
    agentId: string;
    intent: string;
    selfAssessment: { novelty: number; confidence: number };
    admissionSignals: {
      novelty: number;
      duplicateSimilarity: number;
      capabilityFit: number;
    };
    producer: "heuristic" | "model";
  }>;
  admission: Readonly<{
    admitted: ReadonlyArray<{ agentId: string; order: number }>;
    rejected: ReadonlyArray<{ agentId: string; reason: string }>;
    fuseTripped: boolean;
  }>;
}>;

/** §2.11 EpisodeDecisionRecord (schemaVersion 2). */
export type EpisodeDecisionRecord = Readonly<{
  kind: "episode_decision";
  schemaVersion: typeof EPISODE_DECISION_SCHEMA_VERSION;
  key: BeatCollaborationEventKey;
  at: number;
  protocol: FloorProtocol;
  intent: CollaborationIntentKind;
  provenanceHash: string;
  decideBranch: string;
  legacy: {
    admitted: string[];
    primaryQueue: string[];
    dropped: Array<{ agentId: string; reason: string }>;
  };
  floor?: EpisodeDecisionFloorSlice;
  /**
   * P2-A only. Present when shadowStage is "A" and a floor shadow was supplied.
   * Compares legacy admitted ids with Floor admission. Does not change legacy.
   */
  floorCompare?: FloorLegacyCompare;
  /**
   * P2-B §6.5. Present only when shadowStage is B and a calibration row was supplied.
   * suppressSelfAssessment is not applied to admission or the production decision.
   */
  bidCalibration?: ReadonlyArray<{
    agentId: string;
    intent: string;
    samples: number;
    noveltyError: number | null;
    confidenceRho: number | null;
    ece: number | null;
    suppressSelfAssessment: boolean;
  }>;
  need: { agentIds: string[]; source: EpisodeDecisionNeedSource };
  outcome?: {
    roundId: string;
    respondedAgentIds: string[];
    usefulAgentIds: string[];
    noReply: string[];
    duplicates: string[];
    timeouts: string[];
    firstUsefulAtMs?: number;
    qualityClassifierVersion: typeof EPISODE_DECISION_QUALITY_CLASSIFIER_VERSION;
  };
  facilitator: Array<{ actionId: string; outcome: EpisodeFacilitatorGateKind }>;
}>;

/**
 * PolicyDecisionRecord v2 (§2.11 ledger kind `policy_decision`).
 * Extends the round-snapshot PDR with provenance, decide branch, drops, and a required key.
 * Flat on the ledger line (same shape as other collaboration ledger kinds).
 */
export type PolicyDecisionRecordV2 = Readonly<{
  kind: "policy_decision";
  schemaVersion: typeof POLICY_DECISION_SCHEMA_VERSION;
  key: BeatCollaborationEventKey;
  at: number;
  roundId: string;
  protocolVersion: typeof COLLABORATION_POLICY_PROTOCOL_VERSION;
  effectivePolicyHash: string;
  mode: CollaborationModeTemplateId;
  policyConstraints: PolicyClamp[];
  participants: PolicyDecisionParticipant[];
  provenanceHash: string;
  compilerRevision: string;
  decideBranch: string;
  droppedAtDecide: Array<{ agentId: string; reason: string }>;
  provenance: EffectivePolicyProvenance;
  supplementWindow?: PolicyDecisionRecord["supplementWindow"];
  supplementGate?: PolicyDecisionRecord["supplementGate"];
}>;

/** Ledger line: design record plus `recordedAtMs` (mirrors `at`) for archive sorting. */
export type CollaborationEpisodeDecisionRecord = EpisodeDecisionRecord & {
  recordedAtMs: number;
};

export type CollaborationPolicyDecisionRecord = PolicyDecisionRecordV2 & {
  recordedAtMs: number;
};

export class DecisionRecordWriteError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DecisionRecordWriteError";
  }
}

/** Plan flag `collab.ledger.decisionRecords` → `collaboration.ledger.decisionRecords` (default false). */
export function isCollabLedgerDecisionRecordsEnabled(cfg?: OpenBotConfig): boolean {
  return (cfg ?? loadConfig()).collaboration?.ledger?.decisionRecords === true;
}

const INTENT_KIND_SET = new Set<string>(COLLABORATION_INTENT_KINDS);
const NEED_SOURCE_SET = new Set<string>(EPISODE_DECISION_NEED_SOURCES);
const GATE_KIND_SET = new Set<string>(EPISODE_FACILITATOR_GATE_KINDS);
const PROTOCOL_SET = new Set<string>(["legacy", "shadow", "floor"]);

export function assertCompleteBeatEventKey(key: CollaborationEventKey): BeatCollaborationEventKey {
  if (!isCompleteCollaborationEventKey(key)) {
    throw new DecisionRecordWriteError("CollaborationEventKey is incomplete");
  }
  if (typeof key.beatId !== "string" || key.beatId.trim().length === 0) {
    throw new DecisionRecordWriteError(
      "CollaborationEventKey.beatId is required for a beat decision record",
    );
  }
  if (key.tenantId !== null && key.tenantId.trim().length === 0) {
    throw new DecisionRecordWriteError("CollaborationEventKey.tenantId must be null or non-empty");
  }
  return key as BeatCollaborationEventKey;
}

function requireText(value: string, label: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new DecisionRecordWriteError(`${label} is required`);
  }
  return value;
}

function stringList(value: readonly string[], label: string): string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    throw new DecisionRecordWriteError(`${label} must be a string array`);
  }
  return [...value];
}

function droppedList(
  value: ReadonlyArray<{ agentId: string; reason: string }>,
  label: string,
): Array<{ agentId: string; reason: string }> {
  if (!Array.isArray(value)) {
    throw new DecisionRecordWriteError(`${label} must be an array`);
  }
  return value.map((item, index) => {
    if (!item || typeof item.agentId !== "string" || typeof item.reason !== "string") {
      throw new DecisionRecordWriteError(`${label}[${index}] needs agentId and reason`);
    }
    return { agentId: item.agentId, reason: item.reason };
  });
}

export type BeatDecisionWriteInput = {
  key: CollaborationEventKey;
  at?: number;
  protocol: FloorProtocol;
  intent: CollaborationIntentKind;
  provenanceHash: string;
  decideBranch: string;
  legacy: EpisodeDecisionRecord["legacy"];
  need: EpisodeDecisionRecord["need"];
  facilitator?: EpisodeDecisionRecord["facilitator"];
  outcome?: EpisodeDecisionRecord["outcome"];
  floor?: EpisodeDecisionFloorSlice;
  roundId: string;
  mode: CollaborationModeTemplateId;
  policyConstraints: readonly PolicyClamp[];
  participants: readonly PolicyDecisionParticipant[];
  provenance: EffectivePolicyProvenance;
  droppedAtDecide?: ReadonlyArray<{ agentId: string; reason: string }>;
  supplementWindow?: PolicyDecisionRecord["supplementWindow"];
  supplementGate?: PolicyDecisionRecord["supplementGate"];
  /**
   * P1-C optional fill. Applied only when `collaboration.floor.protocol === "shadow"`.
   * Ignored otherwise so flag-off decision bytes stay unchanged.
   */
  /** See FloorShadowSignals. Untyped here so this module does not import the sink. */
  shadowSignals?: unknown;
  /**
   * P2-A shadow decision. Applied only when collaboration.floor.shadowStage is "A".
   * Ignored otherwise so flag-off EDR bytes stay unchanged.
   */
  floorShadow?: FloorShadowAttachment;
  /** Set by the writer when shadowStage is A or B. Callers should leave this unset. */
  floorCompare?: FloorLegacyCompare;
  /**
   * P2-B model bids. Applied onto the EDR floor slice only when shadowStage is B.
   * They do not change legacy admitted ids.
   */
  floorBids?: EpisodeDecisionFloorSlice["bids"];
  /** P2-B calibration rows. Stored on the EDR and not fed back into admission. */
  bidCalibration?: EpisodeDecisionRecord["bidCalibration"];
  cfg?: OpenBotConfig;
  /** Extra episode ids left untouched by recover. The beat's own episodeId is always skipped. */
  skipEpisodeIds?: Iterable<string>;
};

export type BeatDecisionWriteResult = {
  enabled: boolean;
  wroteEpisodeDecision: boolean;
  wrotePolicyDecision: boolean;
  episodeDecisions: number;
  policyDecisions: number;
  recover: { recovered: number; scanned: number } | null;
};

function disabledResult(): BeatDecisionWriteResult {
  return {
    enabled: false,
    wroteEpisodeDecision: false,
    wrotePolicyDecision: false,
    episodeDecisions: 0,
    policyDecisions: 0,
    recover: null,
  };
}

function buildOutcome(
  outcome: EpisodeDecisionRecord["outcome"] | undefined,
): EpisodeDecisionRecord["outcome"] | undefined {
  if (outcome === undefined) {
    return undefined;
  }
  if (outcome.qualityClassifierVersion !== EPISODE_DECISION_QUALITY_CLASSIFIER_VERSION) {
    throw new DecisionRecordWriteError(
      "outcome.qualityClassifierVersion must be useful-v1 until the classifier is versioned",
    );
  }
  return {
    roundId: requireText(outcome.roundId, "outcome.roundId"),
    respondedAgentIds: stringList(outcome.respondedAgentIds, "outcome.respondedAgentIds"),
    usefulAgentIds: stringList(outcome.usefulAgentIds, "outcome.usefulAgentIds"),
    noReply: stringList(outcome.noReply, "outcome.noReply"),
    duplicates: stringList(outcome.duplicates, "outcome.duplicates"),
    timeouts: stringList(outcome.timeouts, "outcome.timeouts"),
    qualityClassifierVersion: EPISODE_DECISION_QUALITY_CLASSIFIER_VERSION,
    ...(typeof outcome.firstUsefulAtMs === "number"
      ? { firstUsefulAtMs: outcome.firstUsefulAtMs }
      : {}),
  };
}

function buildFacilitator(
  facilitator: EpisodeDecisionRecord["facilitator"] | undefined,
): EpisodeDecisionRecord["facilitator"] {
  const items = facilitator ?? [];
  if (!Array.isArray(items)) {
    throw new DecisionRecordWriteError("facilitator must be an array");
  }
  return items.map((item, index) => {
    if (!item || typeof item.actionId !== "string" || item.actionId.trim().length === 0) {
      throw new DecisionRecordWriteError(`facilitator[${index}].actionId is required`);
    }
    if (!GATE_KIND_SET.has(item.outcome)) {
      throw new DecisionRecordWriteError(`facilitator[${index}].outcome is not a gate kind`);
    }
    return { actionId: item.actionId, outcome: item.outcome };
  });
}

export function buildEpisodeDecisionRecord(
  params: BeatDecisionWriteInput & { at: number },
): CollaborationEpisodeDecisionRecord {
  const key = assertCompleteBeatEventKey(params.key);
  if (!PROTOCOL_SET.has(params.protocol)) {
    throw new DecisionRecordWriteError("protocol must be legacy, shadow, or floor");
  }
  if (!INTENT_KIND_SET.has(params.intent)) {
    throw new DecisionRecordWriteError("intent is not a CollaborationIntentKind");
  }
  if (!NEED_SOURCE_SET.has(params.need?.source)) {
    throw new DecisionRecordWriteError("need.source is not a known need source");
  }
  const record: CollaborationEpisodeDecisionRecord = {
    kind: "episode_decision",
    schemaVersion: EPISODE_DECISION_SCHEMA_VERSION,
    key,
    at: params.at,
    recordedAtMs: params.at,
    protocol: params.protocol,
    intent: params.intent,
    provenanceHash: requireText(params.provenanceHash, "provenanceHash"),
    decideBranch: requireText(params.decideBranch, "decideBranch"),
    legacy: {
      admitted: stringList(params.legacy.admitted, "legacy.admitted"),
      primaryQueue: stringList(params.legacy.primaryQueue, "legacy.primaryQueue"),
      dropped: droppedList(params.legacy.dropped, "legacy.dropped"),
    },
    need: {
      agentIds: stringList(params.need.agentIds, "need.agentIds"),
      source: params.need.source,
    },
    facilitator: buildFacilitator(params.facilitator),
  };
  const outcome = buildOutcome(params.outcome);
  const floorCompare = params.floorCompare;
  if (floorCompare && floorCompare.stage !== "A" && floorCompare.stage !== "B") {
    throw new DecisionRecordWriteError("floorCompare.stage must be A or B");
  }
  return {
    ...record,
    ...(outcome ? { outcome } : {}),
    ...(params.floor ? { floor: params.floor } : {}),
    ...(floorCompare ? { floorCompare } : {}),
    ...(params.bidCalibration && params.bidCalibration.length > 0
      ? { bidCalibration: params.bidCalibration.map((row) => ({ ...row })) }
      : {}),
  };
}

export function buildPolicyDecisionRecordV2(
  params: BeatDecisionWriteInput & { at: number },
): CollaborationPolicyDecisionRecord {
  const key = assertCompleteBeatEventKey(params.key);
  if (!params.provenance || typeof params.provenance !== "object") {
    throw new DecisionRecordWriteError("provenance is required on PolicyDecisionRecord v2");
  }
  if (!Array.isArray(params.policyConstraints)) {
    throw new DecisionRecordWriteError("policyConstraints must be an array");
  }
  if (!Array.isArray(params.participants)) {
    throw new DecisionRecordWriteError("participants must be an array");
  }
  const dropped = droppedList(params.droppedAtDecide ?? params.legacy.dropped, "droppedAtDecide");
  const record: CollaborationPolicyDecisionRecord = {
    kind: "policy_decision",
    schemaVersion: POLICY_DECISION_SCHEMA_VERSION,
    key,
    at: params.at,
    recordedAtMs: params.at,
    roundId: requireText(params.roundId, "roundId"),
    protocolVersion: COLLABORATION_POLICY_PROTOCOL_VERSION,
    effectivePolicyHash: key.policyHash,
    mode: params.mode,
    policyConstraints: [...params.policyConstraints],
    participants: params.participants.map((participant) => ({ ...participant })),
    provenanceHash: requireText(params.provenanceHash, "provenanceHash"),
    compilerRevision: key.compilerRevision,
    decideBranch: requireText(params.decideBranch, "decideBranch"),
    droppedAtDecide: dropped,
    provenance: params.provenance,
    ...(params.supplementWindow ? { supplementWindow: params.supplementWindow } : {}),
    ...(params.supplementGate ? { supplementGate: [...params.supplementGate] } : {}),
  };
  return record;
}

async function decisionCountsForBeat(
  ledgerFile: string,
  episodeId: string,
  beatId: string,
): Promise<{ episodeDecision: number; policyDecision: number }> {
  let raw: string;
  try {
    raw = await fs.readFile(ledgerFile, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return { episodeDecision: 0, policyDecision: 0 };
    }
    throw error;
  }
  let episodeDecision = 0;
  let policyDecision = 0;
  for (const line of raw.split("\n")) {
    if (!line.trim()) {
      continue;
    }
    let parsed: { kind?: unknown; key?: { episodeId?: unknown; beatId?: unknown } };
    try {
      parsed = JSON.parse(line) as typeof parsed;
    } catch {
      continue;
    }
    const beatKey = parsed.key;
    if (!beatKey || beatKey.episodeId !== episodeId || beatKey.beatId !== beatId) {
      continue;
    }
    if (parsed.kind === "episode_decision") {
      episodeDecision += 1;
    } else if (parsed.kind === "policy_decision") {
      policyDecision += 1;
    }
  }
  return { episodeDecision, policyDecision };
}

function floorSliceFromShadow(
  shadow: FloorShadowAttachment,
  episodeId: string,
  policyHash: string,
  bids?: EpisodeDecisionFloorSlice["bids"],
): EpisodeDecisionFloorSlice {
  return {
    plan: {
      episodeId: shadow.episodeId || episodeId,
      intent: shadow.intent,
      policyHash: shadow.policyHash || policyHash,
    },
    ...(bids && bids.length > 0 ? { bids: bids.map((bid) => ({ ...bid })) } : {}),
    admission: {
      admitted: shadow.admission.admitted.map((row) => ({
        agentId: row.agentId,
        order: row.order,
      })),
      rejected: shadow.admission.rejected.map((row) => ({
        agentId: row.agentId,
        reason: row.reason,
      })),
      fuseTripped: shadow.admission.fuseTripped,
    },
  };
}

function legacyOutcomeFromRound(round: PersistedRound): EpisodeDecisionRecord["outcome"] {
  const respondedAgentIds = round.dispatches
    .filter((dispatch) => dispatch.status === "completed")
    .map((dispatch) => dispatch.agentId);
  const duplicates = round.dispatches
    .filter((dispatch) => dispatch.status === "skipped_duplicate")
    .map((dispatch) => dispatch.agentId);
  return {
    roundId: round.roundId,
    respondedAgentIds,
    usefulAgentIds: [],
    noReply: [],
    duplicates,
    timeouts: [],
    qualityClassifierVersion: EPISODE_DECISION_QUALITY_CLASSIFIER_VERSION,
  };
}

/**
 * Authoritative legacy speaker set for Floor shadow compare.
 * `executionBots` is the production dispatch set (tier0 + tier1). Prefer it over
 * `primaryQueue` (often lead-only) so onlyLegacy/onlyFloor are not undercounted.
 * `primaryQueue` remains a separate EDR field for the lead queue.
 */
export function legacyAdmittedSpeakersFromDecision(decision: ParticipationDecision): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  const push = (raw: string | undefined) => {
    const id = raw?.trim() ?? "";
    if (!id || seen.has(id)) {
      return;
    }
    seen.add(id);
    result.push(id);
  };
  for (const bot of decision.executionBots) {
    push(bot.agentId);
  }
  if (result.length === 0) {
    for (const id of decision.primaryQueue) {
      push(id);
    }
  }
  return result;
}

/**
 * After a round settles. No-op unless shadowStage is A AND decisionRecords is on.
 * Does not change the round. Throws are the caller's to swallow.
 */
export async function recordFloorShadowStageAAfterRound(params: {
  authority: RuntimeAuthority;
  decision: ParticipationDecision;
  round: PersistedRound;
  cfg?: OpenBotConfig;
}): Promise<{ wrote: boolean }> {
  const cfg = params.cfg ?? getRuntimeConfigSnapshot() ?? undefined;
  if (!isCollabFloorShadowStageA(cfg) || !params.decision.floorShadow) {
    return { wrote: false };
  }
  if (!isCollabLedgerDecisionRecordsEnabled(cfg ?? {})) {
    return { wrote: false };
  }
  const shadow = params.decision.floorShadow;
  const effective = params.authority.policy.effective;
  const episodeId = params.round.episodeRef?.episodeId || params.authority.episodeId;
  const beatId =
    params.round.episodeRef?.beatId && params.round.episodeRef.beatId.trim()
      ? params.round.episodeRef.beatId
      : `${episodeId}:b0`;
  const key = {
    tenantId: params.authority.tenantId,
    groupId: params.authority.groupId,
    episodeId,
    beatId,
    policySnapshotId: params.authority.policy.policySnapshotId,
    policyHash: params.authority.policy.policyHash,
    compilerRevision: params.authority.policy.compilerRevision,
  };
  const mentioned = shadow.l0.mustAdmit
    .filter((row) => row.reason === "mention")
    .map((row) => row.agentId);
  const need = resolveEpisodeNeed({
    intent: shadow.intent,
    mentionedAgentIds: mentioned,
    eligibleAgentIds: shadow.l0.mustAdmit.map((row) => row.agentId),
    taskOwnerAgentId:
      shadow.l0.mustAdmit.find((row) => row.reason === "task_owner")?.agentId ?? null,
    handoffReceiverAgentIds: shadow.l0.mustAdmit
      .filter((row) => row.reason === "handoff_receiver")
      .map((row) => row.agentId),
  });
  const result = await writeBeatDecisionRecords({
    key,
    protocol: cfg?.collaboration?.floor?.protocol === "shadow" ? "shadow" : "legacy",
    intent: shadow.intent,
    provenanceHash: params.authority.policy.provenanceHash,
    decideBranch: "legacy",
    legacy: {
      admitted: legacyAdmittedSpeakersFromDecision(params.decision),
      primaryQueue: [...params.decision.primaryQueue],
      dropped: [],
    },
    need,
    outcome: legacyOutcomeFromRound(params.round),
    roundId: params.round.roundId,
    mode: effective.strategy.id,
    policyConstraints: effective.clamps,
    participants: params.decision.roundPlan.participants.map((participant) => ({
      agentId: participant.agentId,
      tier:
        participant.contributionRole === "wrap"
          ? "wrap"
          : participant.contributionRole === "lead"
            ? "primary"
            : "contributor",
      reason: participant.reasonText,
    })),
    provenance: effective.provenance,
    floorShadow: shadow,
    cfg,
  });
  return { wrote: result.wroteEpisodeDecision };
}

/**
 * After a round settles. No-op unless shadowStage is B AND decisionRecords is on.
 * Copies bids and §6.5 calibration onto the EDR. Does not change legacy admitted.
 */
export async function recordFloorShadowStageBAfterRound(params: {
  authority: RuntimeAuthority;
  decision: ParticipationDecision;
  round: PersistedRound;
  bids: NonNullable<EpisodeDecisionFloorSlice["bids"]>;
  calibration?: EpisodeDecisionRecord["bidCalibration"];
  cfg?: OpenBotConfig;
}): Promise<{ wrote: boolean }> {
  const cfg = params.cfg ?? getRuntimeConfigSnapshot() ?? undefined;
  if (!isCollabFloorShadowStageB(cfg) || params.decision.floorShadow?.stage !== "B") {
    return { wrote: false };
  }
  if (!isCollabLedgerDecisionRecordsEnabled(cfg ?? {})) {
    return { wrote: false };
  }
  const shadow = params.decision.floorShadow;
  const effective = params.authority.policy.effective;
  const episodeId = params.round.episodeRef?.episodeId || params.authority.episodeId;
  const beatId =
    params.round.episodeRef?.beatId && params.round.episodeRef.beatId.trim()
      ? params.round.episodeRef.beatId
      : `${episodeId}:b0`;
  const key = {
    tenantId: params.authority.tenantId,
    groupId: params.authority.groupId,
    episodeId,
    beatId,
    policySnapshotId: params.authority.policy.policySnapshotId,
    policyHash: params.authority.policy.policyHash,
    compilerRevision: params.authority.policy.compilerRevision,
  };
  const mentioned = shadow.l0.mustAdmit
    .filter((row) => row.reason === "mention")
    .map((row) => row.agentId);
  const need = resolveEpisodeNeed({
    intent: shadow.intent,
    mentionedAgentIds: mentioned,
    eligibleAgentIds: shadow.l0.mustAdmit.map((row) => row.agentId),
    taskOwnerAgentId:
      shadow.l0.mustAdmit.find((row) => row.reason === "task_owner")?.agentId ?? null,
    handoffReceiverAgentIds: shadow.l0.mustAdmit
      .filter((row) => row.reason === "handoff_receiver")
      .map((row) => row.agentId),
  });
  const result = await writeBeatDecisionRecords({
    key,
    protocol: cfg?.collaboration?.floor?.protocol === "shadow" ? "shadow" : "legacy",
    intent: shadow.intent,
    provenanceHash: params.authority.policy.provenanceHash,
    decideBranch: "legacy",
    legacy: {
      admitted: legacyAdmittedSpeakersFromDecision(params.decision),
      primaryQueue: [...params.decision.primaryQueue],
      dropped: [],
    },
    need,
    outcome: legacyOutcomeFromRound(params.round),
    roundId: params.round.roundId,
    mode: effective.strategy.id,
    policyConstraints: effective.clamps,
    participants: params.decision.roundPlan.participants.map((participant) => ({
      agentId: participant.agentId,
      tier:
        participant.contributionRole === "wrap"
          ? "wrap"
          : participant.contributionRole === "lead"
            ? "primary"
            : "contributor",
      reason: participant.reasonText,
    })),
    provenance: effective.provenance,
    floorShadow: shadow,
    floorBids: params.bids,
    ...(params.calibration ? { bidCalibration: params.calibration } : {}),
    cfg,
  });
  return { wrote: result.wroteEpisodeDecision };
}

/**
 * P1-B② entry. Flag-off: no-op (no recover, no ledger I/O).
 * Flag-on: recover incomplete episodes (skip this beat's episode), then append
 * at most one EDR and one PDR for this beat.
 */
export async function writeBeatDecisionRecords(
  params: BeatDecisionWriteInput,
): Promise<BeatDecisionWriteResult> {
  const cfg = params.cfg ?? loadConfig();
  if (!isCollabLedgerDecisionRecordsEnabled(cfg)) {
    return disabledResult();
  }
  const filled = fillFloorShadowBeat(params.shadowSignals, cfg);
  const stageAShadow = isCollabFloorShadowStageA(cfg) ? params.floorShadow : undefined;
  const stageBShadow =
    isCollabFloorShadowStageB(cfg) && params.floorShadow?.stage === "B"
      ? params.floorShadow
      : undefined;
  const shadow = stageAShadow ?? stageBShadow;
  const need = filled?.need ?? params.need;
  const floorFromShadow = shadow
    ? floorSliceFromShadow(
        shadow,
        params.key.episodeId,
        params.key.policyHash,
        stageBShadow ? params.floorBids : undefined,
      )
    : undefined;
  const floorCompare = shadow
    ? compareLegacyFloorAdmission({
        legacyAdmitted: params.legacy.admitted,
        floorAdmitted: shadow.admission.admitted.map((row) => row.agentId),
        needAgentIds: need.agentIds,
        stage: shadow.stage,
      })
    : undefined;
  const request: BeatDecisionWriteInput = {
    ...params,
    ...(filled ? { intent: filled.intent, need: filled.need, outcome: filled.outcome } : {}),
    ...(floorFromShadow && !params.floor ? { floor: floorFromShadow } : {}),
    ...(floorCompare ? { floorCompare } : {}),
    ...(!stageBShadow ? { bidCalibration: undefined } : {}),
  };
  const at = request.at ?? Date.now();
  const edr = buildEpisodeDecisionRecord({ ...request, at });
  const pdr = buildPolicyDecisionRecordV2({ ...params, at });
  const facts = resolveCollaborationRuntimeFactPaths({
    groupId: edr.key.groupId,
    tenantId: edr.key.tenantId,
    cfg,
  });
  const episodesDir =
    facts.namespace?.episodesDir ?? path.join(path.dirname(facts.roundsDir), "episodes");
  const skip = new Set(params.skipEpisodeIds ?? []);
  skip.add(edr.key.episodeId);
  const recover = await recoverIncompleteEpisodes({
    episodesDir,
    cfg,
    skipEpisodeIds: skip,
    now: at,
  });
  const ledgerDir = path.dirname(facts.ledgerFile);
  return await withRoundLock(ledgerDir, "decision-records", async () => {
    const before = await decisionCountsForBeat(facts.ledgerFile, edr.key.episodeId, edr.key.beatId);
    let wroteEpisodeDecision = false;
    let wrotePolicyDecision = false;
    if (before.episodeDecision === 0) {
      const written = await appendCollaborationEpisodeDecisionRecord({ record: edr, cfg });
      wroteEpisodeDecision = written !== null;
    }
    if (before.policyDecision === 0) {
      const written = await appendCollaborationPolicyDecisionRecord({ record: pdr, cfg });
      wrotePolicyDecision = written !== null;
    }
    const after = await decisionCountsForBeat(facts.ledgerFile, edr.key.episodeId, edr.key.beatId);
    return {
      enabled: true,
      wroteEpisodeDecision,
      wrotePolicyDecision,
      episodeDecisions: after.episodeDecision,
      policyDecisions: after.policyDecision,
      recover,
    };
  }).then(async (result) => {
    try {
      await recordFloorShadowDecision(edr, cfg);
    } catch {
      // Shadow sink must not fail or rewrite the beat decision.
    }
    return result;
  });
}
