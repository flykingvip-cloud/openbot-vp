/**
 * Registration seam so floor-shadow can observe decision writes without a
 * cycle through episode-decision-record.
 * Unregistered (flag-off processes that never import floor-shadow) = no-op.
 */
import type { OpenBotConfig } from "../../config/types.js";
import type { CollaborationIntentKind } from "./episode-intent.js";
import type { EpisodeNeed } from "./need-resolver.js";

export type FloorShadowBeatFill = {
  intent: CollaborationIntentKind;
  need: EpisodeNeed;
  outcome: {
    roundId: string;
    respondedAgentIds: string[];
    usefulAgentIds: string[];
    noReply: string[];
    duplicates: string[];
    timeouts: string[];
    firstUsefulAtMs?: number;
    qualityClassifierVersion: "useful-v1";
  };
};

type Filler = {
  isEnabled: (cfg?: OpenBotConfig) => boolean;
  fill: (signals: unknown) => FloorShadowBeatFill;
};

type Sink = {
  isEnabled: (cfg?: OpenBotConfig) => boolean;
  record: (record: unknown, cfg?: OpenBotConfig) => Promise<void>;
};

let filler: Filler | null = null;
let sink: Sink | null = null;

export function registerFloorShadowBeatFiller(next: Filler | null): void {
  filler = next;
}

export function registerFloorShadowDecisionSink(next: Sink | null): void {
  sink = next;
}

/** Flag-off or unregistered: null. A filler throw returns null (fail-closed). */
export function fillFloorShadowBeat(
  signals: unknown,
  cfg?: OpenBotConfig,
): FloorShadowBeatFill | null {
  if (signals == null || !filler) {
    return null;
  }
  try {
    if (!filler.isEnabled(cfg)) {
      return null;
    }
    return filler.fill(signals);
  } catch {
    return null;
  }
}

/** Flag-off or unregistered: no-op. A sink throw is swallowed by the caller. */
export async function recordFloorShadowDecision(
  record: unknown,
  cfg?: OpenBotConfig,
): Promise<void> {
  if (!sink) {
    return;
  }
  if (!sink.isEnabled(cfg)) {
    return;
  }
  await sink.record(record, cfg);
}
