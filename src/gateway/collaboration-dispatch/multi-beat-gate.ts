/**
 * P5 — multi-Beat Episode gate (scaffold).
 *
 * Inventory-first: state table already has `next_beat → BID_ADMISSION`, G2
 * single-beat runtime hard-refuses applying `next_beat`, Facilitator denied
 * `next_beat` by default, and L1 tuning hardcodes `maxBeatsPerEpisode: 1`.
 * There is still no multi-beat production controller.
 *
 * This module only opens an explicit raise gate:
 *   collaboration.episode.maxBeats (default unset = 1, hard ceiling 12)
 *
 * When maxBeats > 1:
 *   - EffectivePolicy may record the raised ceiling (via policy compiler input)
 *   - Facilitator may record next_beat as authorized (observation only)
 * When maxBeats === 1 (default):
 *   - Facilitator next_beat stays denied
 *
 * Non-goals: Floor live cutover, multi-beat controller / production loop,
 * changing G2 single-beat runtime to apply next_beat, HA.
 */
import type { OpenBotConfig } from "../../config/types.js";
import type { EpisodeFacilitatorGateKind } from "./episode-decision-record.js";

/** Default / flag-off ceiling: single Beat only. */
export const MULTI_BEAT_DEFAULT_MAX = 1;

/**
 * Hard melt aligned with SYSTEM_INVARIANTS.maxVisibleRepliesCeiling (12).
 * Raising above this is clamped — never a silent unbounded loop.
 */
export const MULTI_BEAT_HARD_CEILING = 12;

/**
 * Plan flag `collab.episode.maxBeats` → `collaboration.episode.maxBeats`.
 * Unset / non-finite / <1 → 1. Values above the hard ceiling clamp down.
 */
export function resolveMaxBeatsPerEpisode(cfg?: OpenBotConfig | null): number {
  const raw = cfg?.collaboration?.episode?.maxBeats;
  if (typeof raw !== "number" || !Number.isFinite(raw)) {
    return MULTI_BEAT_DEFAULT_MAX;
  }
  const floored = Math.floor(raw);
  if (floored < MULTI_BEAT_DEFAULT_MAX) {
    return MULTI_BEAT_DEFAULT_MAX;
  }
  if (floored > MULTI_BEAT_HARD_CEILING) {
    return MULTI_BEAT_HARD_CEILING;
  }
  return floored;
}

/** True only when an explicit config raise is above the single-beat default. */
export function isCollabMultiBeatGateOpen(cfg?: OpenBotConfig | null): boolean {
  return resolveMaxBeatsPerEpisode(cfg) > MULTI_BEAT_DEFAULT_MAX;
}

/**
 * Clamp a raw maxBeats value the same way config resolve does.
 * Used by the policy compiler when GroupPolicyInput carries an override.
 */
export function clampMaxBeatsPerEpisode(raw: number | null | undefined): number {
  if (typeof raw !== "number" || !Number.isFinite(raw)) {
    return MULTI_BEAT_DEFAULT_MAX;
  }
  const floored = Math.floor(raw);
  if (floored < MULTI_BEAT_DEFAULT_MAX) {
    return MULTI_BEAT_DEFAULT_MAX;
  }
  if (floored > MULTI_BEAT_HARD_CEILING) {
    return MULTI_BEAT_HARD_CEILING;
  }
  return floored;
}

/**
 * Facilitator observation outcome for `next_beat`.
 * Authorized only when the raise gate is open (maxBeats > 1).
 * Authorization here is ledger/observation only — G2 single-beat runtime still
 * refuses to apply `next_beat` (no multi-beat controller in this PR).
 */
export function facilitatorNextBeatOutcome(
  maxBeatsPerEpisode: number = MULTI_BEAT_DEFAULT_MAX,
): Extract<EpisodeFacilitatorGateKind, "authorized" | "denied"> {
  return clampMaxBeatsPerEpisode(maxBeatsPerEpisode) > MULTI_BEAT_DEFAULT_MAX
    ? "authorized"
    : "denied";
}
