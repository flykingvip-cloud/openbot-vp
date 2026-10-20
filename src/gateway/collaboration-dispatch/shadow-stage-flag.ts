/**
 * Floor Runtime v2.1 §5.8 shadow stage flag.
 * Plan name `collab.floor.shadowStage` → `collaboration.floor.shadowStage`.
 * "A" is Shadow-A. "B" is Shadow-B (`B@rate` = B + bidSampleRate + bidDailyTokenCap).
 * Unset / anything else = off. Reads the in-memory runtime snapshot when cfg
 * is omitted so the decide hot path does not call loadConfig.
 */
import { getRuntimeConfigSnapshot } from "../../config/config.js";
import type { OpenBotConfig } from "../../config/types.js";

export type CollabFloorShadowStage = "A" | "B";

export type CollabFloorShadowConfig = {
  stage: CollabFloorShadowStage | null;
  /** 0..1. Unset or non-finite = 0 (no samples). */
  bidSampleRate: number;
  /** Per-group daily token ceiling. Unset or negative = 0 (no model calls). */
  bidDailyTokenCap: number;
};

function clampRate(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return 0;
  }
  return Math.min(1, Math.max(0, value));
}

function clampCap(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    return 0;
  }
  return Math.floor(value);
}

const SHADOW_OFF: CollabFloorShadowConfig = {
  stage: null,
  bidSampleRate: 0,
  bidDailyTokenCap: 0,
};

/**
 * Plan `B@rate` is shadowStage "B" plus bidSampleRate and bidDailyTokenCap.
 * No snapshot and no cfg = off. Does not call loadConfig.
 */
export function readCollabFloorShadowConfig(cfg?: OpenBotConfig): CollabFloorShadowConfig {
  try {
    const resolved = cfg ?? getRuntimeConfigSnapshot();
    if (!resolved) {
      return SHADOW_OFF;
    }
    const floor = resolved.collaboration?.floor;
    const raw = floor?.shadowStage;
    const stage = raw === "A" || raw === "B" ? raw : null;
    return {
      stage,
      bidSampleRate: clampRate(floor?.bidSampleRate),
      bidDailyTokenCap: clampCap(floor?.bidDailyTokenCap),
    };
  } catch {
    return SHADOW_OFF;
  }
}

export function isCollabFloorShadowStageA(cfg?: OpenBotConfig): boolean {
  return readCollabFloorShadowConfig(cfg).stage === "A";
}

export function isCollabFloorShadowStageB(cfg?: OpenBotConfig): boolean {
  return readCollabFloorShadowConfig(cfg).stage === "B";
}
