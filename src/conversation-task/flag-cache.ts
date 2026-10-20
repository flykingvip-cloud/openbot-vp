/**
 * ConversationTask Runtime — flag hot-read cache (P2, per p2-ops-review.md O1).
 *
 * Flags are hot-read through a small in-process cache with TTL = 3s (hard cap
 * 5s) so a config change takes effect within seconds without a restart. Any read
 * error (corrupt config / permission denied / read timeout) fails **safe-off**:
 * the flag reads as disabled. `invalidate()` drops the cache so a config write is
 * observed immediately.
 *
 * The cache never turns `activation` / `projection` / `authorization` ON by
 * itself — it only reflects the underlying reader, and those remain OFF in
 * production until their phase is approved.
 */

import { isConversationTaskFlagEnabled, type ConversationTaskFlag } from "./feature.js";

export const FLAG_CACHE_DEFAULT_TTL_MS = 3_000;
export const FLAG_CACHE_MAX_TTL_MS = 5_000;

/** Underlying flag reader. May throw; the cache converts a throw to `false`. */
export type FlagReader = (flag: ConversationTaskFlag) => boolean;

type CacheEntry = { value: boolean; expiresAtMs: number };

export type FlagCacheOptions = {
  ttlMs?: number;
  reader?: FlagReader;
  now?: () => number;
};

function clampTtl(ttlMs: number): number {
  if (!Number.isFinite(ttlMs) || ttlMs < 0) {
    return FLAG_CACHE_DEFAULT_TTL_MS;
  }
  return Math.min(ttlMs, FLAG_CACHE_MAX_TTL_MS);
}

export class ConversationTaskFlagCache {
  private readonly ttlMs: number;
  private readonly reader: FlagReader;
  private readonly now: () => number;
  private readonly entries = new Map<ConversationTaskFlag, CacheEntry>();

  constructor(options: FlagCacheOptions = {}) {
    this.ttlMs = clampTtl(options.ttlMs ?? FLAG_CACHE_DEFAULT_TTL_MS);
    this.reader = options.reader ?? ((flag) => isConversationTaskFlagEnabled(flag));
    this.now = options.now ?? Date.now;
  }

  /**
   * Read a flag through the cache. Returns the cached value while fresh; on a
   * miss re-reads the underlying reader. A reader error is treated as OFF
   * (fail-safe-off) and that OFF is cached for the TTL so a broken config is not
   * hammered.
   */
  isEnabled(flag: ConversationTaskFlag): boolean {
    const nowMs = this.now();
    const cached = this.entries.get(flag);
    if (cached && nowMs < cached.expiresAtMs) {
      return cached.value;
    }
    let value: boolean;
    try {
      value = this.reader(flag);
    } catch {
      value = false; // fail-safe-off
    }
    this.entries.set(flag, { value, expiresAtMs: nowMs + this.ttlMs });
    return value;
  }

  /** Invalidate one flag (or all) so the next read observes a config change. */
  invalidate(flag?: ConversationTaskFlag): void {
    if (flag) {
      this.entries.delete(flag);
    } else {
      this.entries.clear();
    }
  }
}
