/**
 * active-mode.ts — Tip B live LaneMode lookup for tool-policy hooks.
 *
 * Updated when lanes are created / mode-set / updated. Tool construction reads
 * this synchronously so accept|review mutex can deny write without async I/O.
 * Feature flag OFF → resolve returns disabled (zero behavior change).
 */

import { isDeliveryLaneEnabled } from "./feature.js";
import type { DeliveryLane, LaneMode } from "./types.js";

export type ActiveDeliveryLaneMode = {
  enabled: boolean;
  laneId?: string;
  mode?: LaneMode;
  agentId?: string;
};

/** agentId → active lane mode (last attach/setMode/update for that agent). */
const byAgentId = new Map<string, { laneId: string; mode: LaneMode }>();

/** laneId → mode (authoritative for that lane). */
const byLaneId = new Map<string, { mode: LaneMode; agentId?: string }>();

export function rememberDeliveryLaneMode(
  lane: Pick<DeliveryLane, "laneId" | "mode" | "agentId">,
): void {
  const laneId = lane.laneId.trim();
  if (!laneId) {
    return;
  }
  const agentId = lane.agentId?.trim() || undefined;
  byLaneId.set(laneId, { mode: lane.mode, agentId });
  if (agentId) {
    byAgentId.set(agentId, { laneId, mode: lane.mode });
  }
}

export function forgetDeliveryLaneMode(laneId: string): void {
  const id = laneId.trim();
  const prev = byLaneId.get(id);
  byLaneId.delete(id);
  if (prev?.agentId) {
    const cur = byAgentId.get(prev.agentId);
    if (cur?.laneId === id) {
      byAgentId.delete(prev.agentId);
    }
  }
}

/** Test / process reset helper. */
export function resetDeliveryLaneActiveModeForTests(): void {
  byAgentId.clear();
  byLaneId.clear();
}

/**
 * Resolve the LaneMode that tool-policy should enforce for this turn.
 * Explicit overrides win; otherwise agentId / laneId registry; flag OFF → disabled.
 */
export function resolveActiveDeliveryLaneMode(input?: {
  agentId?: string | null;
  laneId?: string | null;
  /** Explicit mode from caller (tests / future turn context). */
  mode?: LaneMode | null;
  env?: NodeJS.ProcessEnv;
  readConfig?: () => boolean;
}): ActiveDeliveryLaneMode {
  const enabled = isDeliveryLaneEnabled(input?.env ?? process.env, input?.readConfig);
  if (!enabled) {
    return { enabled: false };
  }
  if (input?.mode) {
    return {
      enabled: true,
      mode: input.mode,
      laneId: input.laneId?.trim() || undefined,
      agentId: input.agentId?.trim() || undefined,
    };
  }
  const laneId = input?.laneId?.trim();
  if (laneId) {
    const hit = byLaneId.get(laneId);
    if (hit) {
      return { enabled: true, laneId, mode: hit.mode, agentId: hit.agentId };
    }
  }
  const agentId = input?.agentId?.trim();
  if (agentId) {
    const hit = byAgentId.get(agentId);
    if (hit) {
      return { enabled: true, laneId: hit.laneId, mode: hit.mode, agentId };
    }
  }
  return { enabled: true };
}
