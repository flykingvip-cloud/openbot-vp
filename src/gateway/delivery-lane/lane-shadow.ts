/**
 * lane-shadow.ts — Tip F (P2): orchestration plane shadow-observes Lane events.
 *
 * ORCHESTRATION_LIVE_INVOKE must remain false. This module never dispatches,
 * enqueues, or invokes tools — observe-only.
 */

import { ORCHESTRATION_LIVE_INVOKE } from "../../task-orchestration/types.js";
import type { LaneEvent, LaneEventKind } from "./events.js";

export type LaneShadowObservation = {
  schemaVersion: 1;
  observed: true;
  eventKind: LaneEventKind;
  laneId: string;
  /** Always false in this build — live invoke frozen. */
  invoke: false;
  enqueue: false;
  liveInvokeFrozen: boolean;
  orchestrationLiveInvoke: false;
};

/**
 * Shadow-observe a DeliveryLane event for the dormant orchestration plane.
 * Safe to call from webhook adapters; never throws into callers when wrapped.
 */
export function observeLaneEventShadow(
  event: Pick<LaneEvent, "kind" | "laneId">,
): LaneShadowObservation {
  // Hard freeze: Tip F must not flip this constant.
  if (ORCHESTRATION_LIVE_INVOKE) {
    throw new Error("ORCHESTRATION_LIVE_INVOKE must stay false (Tip F shadow-only)");
  }
  return {
    schemaVersion: 1,
    observed: true,
    eventKind: event.kind,
    laneId: event.laneId.trim(),
    invoke: false,
    enqueue: false,
    liveInvokeFrozen: true,
    orchestrationLiveInvoke: false,
  };
}
