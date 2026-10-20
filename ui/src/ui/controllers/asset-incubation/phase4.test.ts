import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { loadLocalAdoptionOverlay } from "./adoption-sync.ts";
import {
  ackWeeklyDigest,
  buildLocalWeeklyDigest,
  clearDigestStorageForTests,
  currentWeekKey,
  scheduleDigestWithSync,
  shouldShowWeeklyDigest,
} from "./digest-engine.ts";

describe("asset-incubation phase4 digest-engine", () => {
  const storage = new Map<string, string>();

  beforeEach(() => {
    storage.clear();
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => {
        storage.set(key, value);
      },
      removeItem: (key: string) => {
        storage.delete(key);
      },
    });
  });

  afterEach(() => {
    clearDigestStorageForTests();
    vi.unstubAllGlobals();
  });

  it("shows digest until acknowledged for current week", () => {
    const digest = buildLocalWeeklyDigest({
      reviewSuggestions: [
        {
          id: "review:weekly",
          kind: "review",
          label: "周报",
          summary: "值得回顾",
          fingerprint: "weekly",
          recurrenceCount: 3,
        },
      ],
    });
    expect(shouldShowWeeklyDigest(digest)).toBe(true);
    ackWeeklyDigest(digest.weekKey);
    expect(shouldShowWeeklyDigest(digest)).toBe(false);
  });

  it("uses stable week key format", () => {
    expect(currentWeekKey(Date.parse("2026-06-18T10:00:00"))).toMatch(/^week-\d+$/);
  });

  it("syncs admin_recommend digest entries into local adoption overlay", async () => {
    const digest = await scheduleDigestWithSync({
      client: {
        request: async () => ({
          weekKey: "week-123",
          builtAt: Date.now(),
          headline: "本周有 1 项资产值得回顾",
          entries: [
            {
              id: "admin:cap-9",
              kind: "admin_recommend",
              label: "推荐能力",
              summary: "平台推荐",
              capabilityId: "cap-9",
            },
          ],
        }),
      } as never,
    });
    expect(digest.entries).toHaveLength(1);
    const adoption = loadLocalAdoptionOverlay({ capabilityId: "cap-9" });
    expect(adoption.adminRecommended).toBe(true);
  });
});
