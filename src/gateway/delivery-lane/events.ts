/**
 * events.ts — Tip F (P2) internal tip/PR events → DeliveryLane stage advance.
 *
 * Minimal slice: callers (future GH webhook / cron) feed LaneEvent snapshots via
 * `lane.event.apply`. Does not open real GitHub webhooks or flip feature flags.
 * Merge ≠ cutover; requestMerge / MergePort remain Tip C gates.
 */

import { updateTask } from "../supervisor/store.js";
import { observeLaneEventShadow, type LaneShadowObservation } from "./lane-shadow.js";
import { buildFocusSummary, buildLaneProjection } from "./projection.js";
import { DeliveryLaneError } from "./service.js";
import { getLane, updateLane } from "./store.js";
import type { DeliveryLane, LaneProjection, LaneStage } from "./types.js";

/** Internal event kinds (tip/PR shaped). Not a third phase vocabulary. */
export type LaneEventKind =
  | "tip.opened"
  | "tip.pushed"
  | "pr.opened"
  | "pr.review_requested"
  | "pr.approved"
  | "pr.checks_green"
  | "pr.merged";

export const LANE_EVENT_KINDS: readonly LaneEventKind[] = [
  "tip.opened",
  "tip.pushed",
  "pr.opened",
  "pr.review_requested",
  "pr.approved",
  "pr.checks_green",
  "pr.merged",
] as const;

export type LaneEventSource = "internal" | "webhook" | "test";

export type LaneEvent = {
  kind: LaneEventKind;
  laneId: string;
  /** Optional tip/PR head for match-head refresh. */
  tipSha?: string;
  headSha?: string;
  prNumber?: number;
  at?: string;
  source?: LaneEventSource;
};

export type LaneLastEvent = {
  kind: LaneEventKind;
  at: string;
  source: LaneEventSource;
};

const EVENT_STAGE: Partial<Record<LaneEventKind, LaneStage>> = {
  "tip.opened": "drafting",
  "tip.pushed": "implementing",
  "pr.opened": "reviewing",
  "pr.review_requested": "reviewing",
  "pr.approved": "accepting",
  "pr.checks_green": "accepting",
  "pr.merged": "merged",
};

/** Monotonic stage order for board advance (never regress via events). */
const STAGE_RANK: Record<LaneStage, number> = {
  drafting: 0,
  implementing: 1,
  reviewing: 2,
  accepting: 3,
  merge_ready: 4,
  merged: 5,
  blocked: -1,
  abandoned: -1,
};

export function isLaneEventKind(value: string): value is LaneEventKind {
  return (LANE_EVENT_KINDS as readonly string[]).includes(value);
}

export function suggestStageForLaneEvent(kind: LaneEventKind): LaneStage | null {
  return EVENT_STAGE[kind] ?? null;
}

export function canAdvanceStage(from: LaneStage, to: LaneStage): boolean {
  if (from === "blocked" || from === "abandoned") {
    return false;
  }
  if (to === "blocked" || to === "abandoned") {
    return true;
  }
  return STAGE_RANK[to] >= STAGE_RANK[from];
}

async function projectOntoTask(
  lane: DeliveryLane,
  opts: { supervisorStoreDir?: string; focusSummary?: string },
): Promise<LaneProjection> {
  const projection = buildLaneProjection(lane, opts.focusSummary);
  if (!lane.taskId?.trim()) {
    return projection;
  }
  try {
    await updateTask(
      lane.taskId,
      (task) => ({
        ...task,
        laneId: lane.laneId,
        laneProjection: projection,
      }),
      opts.supervisorStoreDir,
    );
  } catch (err) {
    if (err instanceof Error && /not found/i.test(err.message)) {
      return projection;
    }
    throw err;
  }
  return projection;
}

export type ApplyLaneEventInput = {
  event: LaneEvent;
  storeDir?: string;
  supervisorStoreDir?: string;
};

export type ApplyLaneEventResult = {
  lane: DeliveryLane;
  projection: LaneProjection;
  advanced: boolean;
  suggestedStage: LaneStage | null;
  /** Orchestration plane shadow observation (never invokes). */
  shadow: LaneShadowObservation;
};

/**
 * Apply an internal tip/PR event to advance DeliveryLane board stage.
 * Never calls MergePort / gh; never enables feature flags; never live-invokes orch.
 */
export async function applyLaneEvent(input: ApplyLaneEventInput): Promise<ApplyLaneEventResult> {
  const laneId = input.event.laneId.trim();
  if (!laneId) {
    throw new DeliveryLaneError("event.laneId is required");
  }
  if (!isLaneEventKind(input.event.kind)) {
    throw new DeliveryLaneError(
      `unknown event kind: ${String(input.event.kind)}`,
      "INVALID_REQUEST",
    );
  }

  const current = await getLane(laneId, input.storeDir);
  if (!current) {
    throw new DeliveryLaneError(`delivery lane "${laneId}" not found`, "NOT_FOUND");
  }

  const suggested = suggestStageForLaneEvent(input.event.kind);
  const tipSha = input.event.tipSha?.trim();
  const headSha = input.event.headSha?.trim() || tipSha;
  const prNumber =
    typeof input.event.prNumber === "number" && Number.isFinite(input.event.prNumber)
      ? input.event.prNumber
      : undefined;
  const lastEvent: LaneLastEvent = {
    kind: input.event.kind,
    at: input.event.at ?? new Date().toISOString(),
    source: input.event.source ?? "internal",
  };

  let nextStage = current.stage;
  if (suggested && canAdvanceStage(current.stage, suggested) && suggested !== current.stage) {
    // Only advance forward (or same-rank noop already excluded).
    if (STAGE_RANK[suggested] > STAGE_RANK[current.stage]) {
      nextStage = suggested;
    }
  }
  const advanced = nextStage !== current.stage;

  const saved = await updateLane(
    laneId,
    (lane) => ({
      ...lane,
      stage: nextStage,
      ...(tipSha ? { tipSha } : {}),
      ...(headSha ? { headSha } : {}),
      ...(typeof prNumber === "number" ? { prNumber } : {}),
      lastEvent,
    }),
    input.storeDir,
  );

  const projection = await projectOntoTask(saved, {
    supervisorStoreDir: input.supervisorStoreDir,
    focusSummary: buildFocusSummary(saved),
  });
  const shadow = observeLaneEventShadow({ kind: input.event.kind, laneId });
  return { lane: saved, projection, advanced, suggestedStage: suggested, shadow };
}
