import { describe, expect, it } from "vitest";
import type { ConversationTaskFlag } from "./feature.js";
import { ConversationTaskFlagCache, FLAG_CACHE_MAX_TTL_MS } from "./flag-cache.js";

describe("ConversationTaskFlagCache — fail-safe-off (O1)", () => {
  it("treats a reader error as OFF for corrupt config / permission / timeout", () => {
    for (const err of [
      new Error("config corrupt: unexpected token"),
      new Error("EACCES: permission denied"),
      new Error("read timed out"),
    ]) {
      const cache = new ConversationTaskFlagCache({
        reader: () => {
          throw err;
        },
      });
      expect(cache.isEnabled("activation")).toBe(false);
    }
  });
});

describe("ConversationTaskFlagCache — cache + invalidate (O1)", () => {
  it("caches within TTL and re-reads after invalidate (config write observed)", () => {
    let value = true;
    const cache = new ConversationTaskFlagCache({
      ttlMs: 3_000,
      now: () => 0,
      reader: () => value,
    });
    expect(cache.isEnabled("detection")).toBe(true);
    value = false; // config changed
    expect(cache.isEnabled("detection")).toBe(true); // still cached, old value
    cache.invalidate("detection");
    expect(cache.isEnabled("detection")).toBe(false); // re-read after invalidate
  });

  it("expires the cache entry after the TTL", () => {
    let now = 0;
    let value = true;
    const cache = new ConversationTaskFlagCache({
      ttlMs: 3_000,
      now: () => now,
      reader: () => value,
    });
    expect(cache.isEnabled("qualification")).toBe(true);
    value = false;
    now = 2_999;
    expect(cache.isEnabled("qualification")).toBe(true); // within TTL
    now = 3_001;
    expect(cache.isEnabled("qualification")).toBe(false); // TTL elapsed => re-read
  });

  it("clamps the TTL to the 5s hard cap", () => {
    let now = 0;
    let reads = 0;
    const cache = new ConversationTaskFlagCache({
      ttlMs: 60_000, // requested well above the cap
      now: () => now,
      reader: () => {
        reads++;
        return true;
      },
    });
    cache.isEnabled("detection");
    now = FLAG_CACHE_MAX_TTL_MS + 1; // just past the hard cap
    cache.isEnabled("detection");
    expect(reads).toBe(2); // cap forced a re-read, proving TTL <= 5s
  });

  it("invalidate() with no argument clears every flag", () => {
    const seen: ConversationTaskFlag[] = [];
    const cache = new ConversationTaskFlagCache({
      now: () => 0,
      reader: (flag) => {
        seen.push(flag);
        return false;
      },
    });
    cache.isEnabled("detection");
    cache.isEnabled("qualification");
    cache.invalidate();
    cache.isEnabled("detection");
    expect(seen.filter((f) => f === "detection")).toHaveLength(2);
  });
});
