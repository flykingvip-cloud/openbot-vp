/**
 * P0 G1 — Floor is not the live orchestration path.
 *
 * Shadow A/B (`collaboration.floor.shadowStage`) may attach a compare payload
 * and jsonl. `collaboration.floor.protocol === "floor"` is accepted by config
 * and is not a production switch. Speaker lists stay on G8
 * `decideParticipants` / `executeCollaborationRound`.
 *
 * Promoting Floor admitted ids onto production speakers requires this module's
 * cutover default AND a four-field receipt. One config boolean — protocol,
 * shadowStage, episodeStore, runtimeNamespace, handoffContract,
 * maxBeatsPerEpisode>1, or drivesProductionDecision — is not that receipt. The default stays false.
 * This module does not set protocol to floor and it does not set
 * drivesProductionDecision to true. A signed receipt is not present, so G1
 * stays open: protocol is still not floor.
 */

export const FLOOR_LIVE_CUTOVER_DEFAULT = false;

export const LEGACY_PRODUCTION_SPEAKER_SOURCE = "legacy-primary-supplement" as const;

export type LegacyProductionSpeakerSource = typeof LEGACY_PRODUCTION_SPEAKER_SOURCE;

/**
 * Independent of collaboration.* booleans. Analogous to G7's
 * `--confirm-write-freeze`: every field must be true, and the module default
 * must also be on. This build leaves the default off.
 */
export type FloorLiveCutoverReceipt = {
  /** Operator acknowledgement. Not a collaboration.* config boolean. */
  confirmSingleBeatGate: boolean;
  /** G7 N2 namespace production cutover signed. Not collaboration.runtimeNamespace. */
  namespaceN2Signed: boolean;
  /** G2 single-beat gate signed as its own receipt. Not collaboration.episodeStore. */
  singleBeatGateSigned: boolean;
  /** Shadow compare stays non-rewriting. Required together with the other receipts. */
  shadowCompareNonRewriting: boolean;
};

export type FloorLiveCutoverAttempt = {
  /** Config value. "floor" alone is not a cutover. */
  protocol?: string | null;
  shadowStage?: string | null;
  episodeStore?: boolean;
  runtimeNamespace?: boolean;
  handoffContract?: boolean;
  /** P5 multi-Beat raise. Values >1 are casual and cannot sign Floor live. */
  maxBeatsPerEpisode?: number | null;
  drivesProductionDecision?: boolean;
  receipt?: Partial<FloorLiveCutoverReceipt> | null;
};

const RECEIPT_FIELDS = [
  "confirmSingleBeatGate",
  "namespaceN2Signed",
  "singleBeatGateSigned",
  "shadowCompareNonRewriting",
] as const satisfies readonly (keyof FloorLiveCutoverReceipt)[];

export class FloorLiveCutoverRefusedError extends Error {
  readonly code = "COLLAB_FLOOR_LIVE_CUTOVER_REFUSED";
  constructor(message: string) {
    super(message);
    this.name = "FloorLiveCutoverRefusedError";
  }
}

function casualFlags(attempt: FloorLiveCutoverAttempt | null | undefined): string[] {
  const flags: string[] = [];
  if (attempt?.protocol === "floor") {
    flags.push("protocol=floor");
  }
  if (attempt?.shadowStage === "A" || attempt?.shadowStage === "B") {
    flags.push(`shadowStage=${attempt.shadowStage}`);
  }
  if (attempt?.episodeStore === true) {
    flags.push("episodeStore");
  }
  if (attempt?.runtimeNamespace === true) {
    flags.push("runtimeNamespace");
  }
  if (attempt?.handoffContract === true) {
    flags.push("handoffContract");
  }
  if (typeof attempt?.maxBeatsPerEpisode === "number" && attempt.maxBeatsPerEpisode > 1) {
    flags.push(`maxBeatsPerEpisode=${attempt.maxBeatsPerEpisode}`);
  }
  if (attempt?.drivesProductionDecision === true) {
    flags.push("drivesProductionDecision");
  }
  return flags;
}

/**
 * Null only when `FLOOR_LIVE_CUTOVER_DEFAULT` is true and every receipt field
 * is true. Casual config booleans never clear the missing-receipt list.
 * The default is false, so a complete receipt still refuses on this build.
 */
export function floorLiveProductionRefusal(
  attempt?: FloorLiveCutoverAttempt | null,
): string | null {
  const missing = RECEIPT_FIELDS.filter((field) => attempt?.receipt?.[field] !== true);
  const defaultOff = !FLOOR_LIVE_CUTOVER_DEFAULT;
  if (!defaultOff && missing.length === 0) {
    return null;
  }
  const parts: string[] = [];
  if (defaultOff) {
    parts.push("cutover default is off");
  }
  if (missing.length > 0) {
    parts.push(`unsigned ${missing.join(", ")}`);
  }
  const casual = casualFlags(attempt);
  if (casual.length > 0) {
    parts.push(`casual flags ignored: ${casual.join(", ")}`);
  }
  return (
    `P0 G1: refused Floor production speakers (${parts.join("; ")}). ` +
    "collaboration.floor.protocol is not floor. Shadow A/B may compare lists only. " +
    "A single boolean cannot sign this gate."
  );
}

export function assertFloorLiveProductionRefused(attempt?: FloorLiveCutoverAttempt | null): void {
  const refusal = floorLiveProductionRefusal(attempt);
  if (refusal) {
    throw new FloorLiveCutoverRefusedError(refusal);
  }
}

/**
 * Production speaker source. Always G8 while the gate refuses.
 * `protocol === "floor"` and shadowStage A/B do not select Floor.
 * `drivesProductionDecision: true` throws instead of switching sources.
 */
export function guardFloorProductionSpeakers(
  attempt?: FloorLiveCutoverAttempt | null,
): LegacyProductionSpeakerSource {
  const refusal = floorLiveProductionRefusal(attempt);
  if (attempt?.drivesProductionDecision === true) {
    throw new FloorLiveCutoverRefusedError(
      refusal ??
        "P0 G1: refused Floor production speakers. drivesProductionDecision cannot select Floor.",
    );
  }
  if (refusal === null) {
    throw new FloorLiveCutoverRefusedError(
      "P0 G1: Floor production speaker rewrite is not wired. collaboration.floor.protocol is not floor.",
    );
  }
  return LEGACY_PRODUCTION_SPEAKER_SOURCE;
}

/**
 * The only promotion entry. It never copies Floor admitted ids onto the
 * legacy speaker list. An unsigned attempt throws. A receipt that would open
 * the gate still throws, because this build does not rewrite G8 speakers.
 */
export function promoteFloorAdmittedToProductionSpeakers<T>(params: {
  legacySpeakers: T;
  floorAdmittedAgentIds: readonly string[];
  protocol?: string | null;
  shadowStage?: string | null;
  episodeStore?: boolean;
  runtimeNamespace?: boolean;
  handoffContract?: boolean;
  drivesProductionDecision?: boolean;
  receipt?: Partial<FloorLiveCutoverReceipt> | null;
}): T {
  const refusal = floorLiveProductionRefusal(params);
  if (refusal) {
    throw new FloorLiveCutoverRefusedError(refusal);
  }
  void params.legacySpeakers;
  void params.floorAdmittedAgentIds;
  throw new FloorLiveCutoverRefusedError(
    "P0 G1: Floor production speaker rewrite is not wired. collaboration.floor.protocol is not floor.",
  );
}

export type FloorShadowSpeakerCarrier = {
  tier0: unknown;
  tier1: unknown;
  tier2: unknown;
  executionBots: unknown;
  roundPlan: unknown;
  primaryQueue: unknown;
};

const SPEAKER_KEYS = [
  "tier0",
  "tier1",
  "tier2",
  "executionBots",
  "roundPlan",
  "primaryQueue",
] as const satisfies readonly (keyof FloorShadowSpeakerCarrier)[];

/**
 * Shadow attachment may add floorShadow. It must keep the G8 speaker fields
 * as the same references. A replaced list is a production Floor attempt and
 * fails closed.
 */
export function assertFloorShadowDidNotReplaceSpeakers<T extends FloorShadowSpeakerCarrier>(
  legacy: T,
  attached: T,
): T {
  if (attached === legacy) {
    return attached;
  }
  for (const key of SPEAKER_KEYS) {
    if (attached[key] !== legacy[key]) {
      throw new FloorLiveCutoverRefusedError(
        floorLiveProductionRefusal(null) ??
          "P0 G1: refused Floor production speakers. Shadow must not replace G8 lists.",
      );
    }
  }
  return attached;
}

/** Runtime check for a bid join result. Literal false stays a no-op. */
export function assertBidDoesNotDriveProduction(drivesProductionDecision: boolean): void {
  if (drivesProductionDecision) {
    throw new FloorLiveCutoverRefusedError(
      floorLiveProductionRefusal({ drivesProductionDecision: true }) ??
        "P0 G1: refused Floor production speakers.",
    );
  }
}
