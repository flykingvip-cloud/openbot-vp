/**
 * P1-A2 (Floor Runtime v2.1 §4.2 / §4.3 Q5): keep policy-migration results across the
 * operating-state refresh in syncGroupOperatingState (shared.ts), which rebuilds the
 * state from the space profile on every sync.
 *
 * Only groups stamped with `policyRevision` (i.e. touched by a PolicyMigration) are
 * affected; for every other group the refreshed state is returned unchanged, so
 * pre-P1-A2 refresh behaviour is byte-identical.
 */
import type { GatewayCollaborationGroupOperatingState } from "./operating-state-types.js";

type State = GatewayCollaborationGroupOperatingState;

export function carryPolicyRevision(existing: State | null | undefined, refreshed: State): State {
  if (typeof existing?.policyRevision !== "number") {
    return refreshed;
  }
  // refreshed mode is null only when an existing group's profile carries none; keep the
  // migration-materialised literal in that case (Q5 step ①).
  const carriedMode = existing.groupProfile?.collaborationMode?.trim() || null;
  return {
    ...refreshed,
    groupProfile: {
      ...refreshed.groupProfile,
      collaborationMode: refreshed.groupProfile.collaborationMode ?? carriedMode,
    },
    policyRevision: existing.policyRevision,
  };
}
