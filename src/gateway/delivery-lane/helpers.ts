/**
 * helpers.ts — Tip E Lane helper quota (maxLaneHelpers ≤ 2).
 *
 * Product cap for path-2 "分身有界": concurrent helpers per lane ≤ 2.
 * Does NOT claim personal_subagent satisfies independent accept/review.
 * Feature flag still default OFF at RPC (delivery-lane enabled gate).
 */

import { loadConfig } from "../../config/config.js";
import { updateTask } from "../supervisor/store.js";
import { buildFocusSummary, buildLaneProjection } from "./projection.js";
import { DeliveryLaneError } from "./service.js";
import { getLane, updateLane } from "./store.js";
import type { DeliveryLane, LaneHelper, LaneHelperKind, LaneProjection } from "./types.js";

/** Tip E: max concurrent helpers per DeliveryLane (path-2 分身配额). */
export const DEFAULT_LANE_MAX_HELPERS = 2;

export function resolveLaneMaxHelpers(): number {
  try {
    const raw = loadConfig().gateway?.deliveryLane?.maxLaneHelpers;
    if (typeof raw === "number" && Number.isFinite(raw)) {
      return Math.max(1, Math.floor(raw));
    }
  } catch {
    // config unavailable in unit tests — use default
  }
  return DEFAULT_LANE_MAX_HELPERS;
}

export type AttachLaneHelperInput = {
  laneId: string;
  agentId: string;
  kind?: LaneHelperKind;
  storeDir?: string;
  supervisorStoreDir?: string;
  /** Override cap (tests). */
  maxHelpers?: number;
};

export type DetachLaneHelperInput = {
  laneId: string;
  agentId: string;
  storeDir?: string;
  supervisorStoreDir?: string;
};

function nowIso(): string {
  return new Date().toISOString();
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

export function countActiveLaneHelpers(lane: DeliveryLane): number {
  return (lane.helpers ?? []).filter((h) => !h.detachedAt).length;
}

/**
 * Register a helper on the lane. Refuses when active helpers would exceed max (default 2).
 */
export async function attachLaneHelper(input: AttachLaneHelperInput): Promise<{
  lane: DeliveryLane;
  projection: LaneProjection;
  maxHelpers: number;
}> {
  const agentId = input.agentId.trim();
  if (!agentId) {
    throw new DeliveryLaneError("helper agentId is required");
  }
  const maxHelpers =
    typeof input.maxHelpers === "number"
      ? Math.max(1, Math.floor(input.maxHelpers))
      : resolveLaneMaxHelpers();
  const kind: LaneHelperKind = input.kind ?? "helper";

  const current = await getLane(input.laneId, input.storeDir);
  if (!current) {
    throw new DeliveryLaneError(`delivery lane "${input.laneId}" not found`, "NOT_FOUND");
  }

  const active = (current.helpers ?? []).filter((h) => !h.detachedAt);
  if (active.some((h) => h.agentId === agentId)) {
    const projection = await projectOntoTask(current, {
      supervisorStoreDir: input.supervisorStoreDir,
      focusSummary: buildFocusSummary(current),
    });
    return { lane: current, projection, maxHelpers };
  }
  if (active.length >= maxHelpers) {
    throw new DeliveryLaneError(
      `lane helper cap refused: already ${active.length} active (maxLaneHelpers=${maxHelpers})`,
      "REFUSED",
    );
  }

  const helper: LaneHelper = {
    agentId,
    kind,
    attachedAt: nowIso(),
  };

  const saved = await updateLane(
    input.laneId,
    (lane) => ({
      ...lane,
      helpers: [
        ...(lane.helpers ?? []).filter((h) => h.agentId !== agentId || Boolean(h.detachedAt)),
        helper,
      ],
    }),
    input.storeDir,
  );
  const projection = await projectOntoTask(saved, {
    supervisorStoreDir: input.supervisorStoreDir,
    focusSummary: buildFocusSummary(saved),
  });
  return { lane: saved, projection, maxHelpers };
}

export async function detachLaneHelper(input: DetachLaneHelperInput): Promise<{
  lane: DeliveryLane;
  projection: LaneProjection;
}> {
  const agentId = input.agentId.trim();
  const current = await getLane(input.laneId, input.storeDir);
  if (!current) {
    throw new DeliveryLaneError(`delivery lane "${input.laneId}" not found`, "NOT_FOUND");
  }
  const saved = await updateLane(
    input.laneId,
    (lane) => ({
      ...lane,
      helpers: (lane.helpers ?? []).map((h) =>
        h.agentId === agentId && !h.detachedAt ? { ...h, detachedAt: nowIso() } : h,
      ),
    }),
    input.storeDir,
  );
  const projection = await projectOntoTask(saved, {
    supervisorStoreDir: input.supervisorStoreDir,
    focusSummary: buildFocusSummary(saved),
  });
  return { lane: saved, projection };
}
