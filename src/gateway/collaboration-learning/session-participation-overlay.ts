/**
 * Session participation overlay: per-botId dictionary on the shared
 * `space:<groupId>` session entry.
 *
 * AS-IS bug: a single ParticipationOverlay on the shared session was overwritten
 * as bots refreshed/rotated, so same-round dispatch could read another bot's
 * overlay/capabilities ("轮转糊边").
 *
 * Store shape (v1 bag):
 *   { v: 1, byBotId: { [botId]: ParticipationOverlay } }
 * Legacy single ParticipationOverlay is still accepted on read and migrated on write.
 */

import type { ParticipationOverlay } from "@openbot/collaboration-runtime";

export const PARTICIPATION_OVERLAY_BAG_VERSION = 1 as const;

export type CollaborationParticipationOverlayBag = {
  v: typeof PARTICIPATION_OVERLAY_BAG_VERSION;
  byBotId: Record<string, ParticipationOverlay>;
};

/** Session field: legacy single overlay OR v1 per-bot bag. */
export type SessionParticipationOverlayField =
  | ParticipationOverlay
  | CollaborationParticipationOverlayBag;

export function isCollaborationParticipationOverlayBag(
  value: SessionParticipationOverlayField | null | undefined,
): value is CollaborationParticipationOverlayBag {
  if (!value || typeof value !== "object") {
    return false;
  }
  const candidate = value as CollaborationParticipationOverlayBag;
  return (
    candidate.v === PARTICIPATION_OVERLAY_BAG_VERSION &&
    candidate.byBotId !== null &&
    typeof candidate.byBotId === "object" &&
    !Array.isArray(candidate.byBotId)
  );
}

export function isLegacyParticipationOverlay(
  value: SessionParticipationOverlayField | null | undefined,
): value is ParticipationOverlay {
  if (!value || typeof value !== "object" || isCollaborationParticipationOverlayBag(value)) {
    return false;
  }
  const candidate = value;
  return typeof candidate.botId === "string" && typeof candidate.groupId === "string";
}

/** Normalize any stored field into a mutable byBotId map (empty if absent). */
export function normalizeParticipationOverlaysByBotId(
  value: SessionParticipationOverlayField | null | undefined,
): Record<string, ParticipationOverlay> {
  if (!value) {
    return {};
  }
  if (isCollaborationParticipationOverlayBag(value)) {
    const next: Record<string, ParticipationOverlay> = {};
    for (const [key, overlay] of Object.entries(value.byBotId)) {
      const botId = overlay?.botId?.trim() || key.trim();
      if (!botId || !overlay) {
        continue;
      }
      next[botId] = overlay;
    }
    return next;
  }
  if (isLegacyParticipationOverlay(value)) {
    const botId = value.botId.trim();
    return botId ? { [botId]: value } : {};
  }
  return {};
}

/**
 * Resolve the overlay for one bot. Never returns another bot's overlay.
 * When botId is omitted and only a legacy single overlay exists, returns that
 * overlay for backward compatibility with non-discussion readers.
 */
export function resolveSessionParticipationOverlay(params: {
  field?: SessionParticipationOverlayField | null;
  botId?: string | null;
}): ParticipationOverlay | undefined {
  const botId = params.botId?.trim();
  const byBotId = normalizeParticipationOverlaysByBotId(params.field);

  if (botId) {
    const direct = byBotId[botId];
    if (direct) {
      return direct;
    }
    // Case-insensitive fallback (agent ids are often lowercased in dispatch).
    const lowered = botId.toLowerCase();
    for (const [key, overlay] of Object.entries(byBotId)) {
      if (key.toLowerCase() === lowered || overlay.botId?.trim().toLowerCase() === lowered) {
        return overlay;
      }
    }
    return undefined;
  }

  const values = Object.values(byBotId);
  return values.length === 1 ? values[0] : undefined;
}

/** Group id from bag or legacy single overlay (any bot entry). */
export function resolveSessionParticipationGroupId(
  field?: SessionParticipationOverlayField | null,
): string | undefined {
  if (!field) {
    return undefined;
  }
  if (isLegacyParticipationOverlay(field)) {
    return field.groupId?.trim() || undefined;
  }
  if (isCollaborationParticipationOverlayBag(field)) {
    for (const overlay of Object.values(field.byBotId)) {
      const groupId = overlay?.groupId?.trim();
      if (groupId) {
        return groupId;
      }
    }
  }
  return undefined;
}

/** Upsert one bot's overlay into the v1 bag (preserves peers). */
export function upsertSessionParticipationOverlay(params: {
  existing?: SessionParticipationOverlayField | null;
  overlay: ParticipationOverlay;
}): CollaborationParticipationOverlayBag {
  const botId = params.overlay.botId.trim();
  const byBotId = normalizeParticipationOverlaysByBotId(params.existing);
  if (botId) {
    byBotId[botId] = params.overlay;
  }
  return {
    v: PARTICIPATION_OVERLAY_BAG_VERSION,
    byBotId,
  };
}

/**
 * Strip private-run / ephemeral keys that must never land in GROUP_PUBLIC.
 * Used as a defensive filter when serializing session-adjacent payloads.
 */
export function omitPrivateRunBagKeys<T extends Record<string, unknown>>(
  value: T,
): Omit<T, "__privateRunBag" | "CollaborationPrivateRunBag" | "privateRunBag"> {
  const {
    __privateRunBag: _marker,
    CollaborationPrivateRunBag: _ctx,
    privateRunBag: _bag,
    ...rest
  } = value as T & {
    __privateRunBag?: unknown;
    CollaborationPrivateRunBag?: unknown;
    privateRunBag?: unknown;
  };
  return rest;
}
