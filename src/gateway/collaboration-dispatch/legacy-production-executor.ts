import type {
  CollaborationFloorProtocol,
  CollaborationLaneMode,
} from "../../config/types.collaboration.js";
import type { OpenBotConfig } from "../../config/types.js";
import { guardFloorProductionSpeakers } from "./floor-live-cutover.js";

export const LEGACY_PRIMARY_SUPPLEMENT_EXECUTOR = "legacy-primary-supplement" as const;

export type ProductionCollaborationExecutor = typeof LEGACY_PRIMARY_SUPPLEMENT_EXECUTOR;

/**
 * Floor bids must not drive who speaks. Typed as boolean so a later edit that
 * sets it true is a real branch, not a silent constant. G8 keeps it false.
 */
export const FLOOR_DRIVES_PRODUCTION_DECISION: boolean = false;

export type CollaborationCutoverFlags = Readonly<{
  floorProtocol: CollaborationFloorProtocol | "unset";
  shadowStage: "A" | "B" | "unset";
  episodeStore: boolean;
  runtimeNamespace: boolean;
  handoffContract: boolean;
  dispatchLane: CollaborationLaneMode | "unset";
  floorDrivesProductionDecision: boolean;
}>;

/** Read cutover flags without applying them. Omitted config is the default-off view. */
export function readCollaborationCutoverFlags(cfg?: OpenBotConfig): CollaborationCutoverFlags {
  const collaboration = cfg?.collaboration;
  const protocol = collaboration?.floor?.protocol;
  const shadowStage = collaboration?.floor?.shadowStage;
  const dispatchLane = collaboration?.lane?.dispatch;
  return {
    floorProtocol:
      protocol === "legacy" || protocol === "shadow" || protocol === "floor" ? protocol : "unset",
    shadowStage: shadowStage === "A" || shadowStage === "B" ? shadowStage : "unset",
    episodeStore: collaboration?.episodeStore === true,
    runtimeNamespace: collaboration?.runtimeNamespace === true,
    handoffContract: collaboration?.task?.handoffContract === true,
    dispatchLane:
      dispatchLane === "legacy" || dispatchLane === "shadow" || dispatchLane === "effective"
        ? dispatchLane
        : "unset",
    floorDrivesProductionDecision: FLOOR_DRIVES_PRODUCTION_DECISION,
  };
}

/**
 * P0 G8 production executor for a group collaboration round.
 *
 * Always Legacy Primary → Supplement (optional wrap), the path
 * `executeCollaborationRound` advances. Floor L0/L1/L2, Episode Store, runtime
 * namespace, and HandoffContract are implemented; default flags do not select
 * them, and `collaboration.floor.protocol=floor` is ignored here. Floor bids
 * keep `drivesProductionDecision` false. P0 G1 refuses to promote Floor
 * admitted lists: the cutover default is off, and a casual boolean is not a
 * signed receipt. This function does not flip flag defaults.
 */
export function resolveProductionCollaborationExecutor(
  cfg?: OpenBotConfig,
): ProductionCollaborationExecutor {
  const flags = readCollaborationCutoverFlags(cfg);
  if (flags.floorDrivesProductionDecision) {
    throw new Error("P0 G8: Floor bids must not drive the production collaboration executor");
  }
  guardFloorProductionSpeakers({
    protocol: flags.floorProtocol === "unset" ? null : flags.floorProtocol,
    shadowStage: flags.shadowStage === "unset" ? null : flags.shadowStage,
    episodeStore: flags.episodeStore,
    runtimeNamespace: flags.runtimeNamespace,
    handoffContract: flags.handoffContract,
    drivesProductionDecision: flags.floorDrivesProductionDecision,
  });
  return LEGACY_PRIMARY_SUPPLEMENT_EXECUTOR;
}

/**
 * Refuse any executor id other than Legacy Primary/Supplement.
 * Omitted means the caller is already on that path (existing round-runtime tests).
 */
export function assertLegacyProductionExecutor(executor: string | undefined): void {
  if (executor === undefined) {
    return;
  }
  if (executor !== LEGACY_PRIMARY_SUPPLEMENT_EXECUTOR) {
    throw new Error(
      `P0 G8: production collaboration executor must be ${LEGACY_PRIMARY_SUPPLEMENT_EXECUTOR}, got ${executor}`,
    );
  }
}
