import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ASSET_SUGGESTION_DISMISS_TTL_MS,
  clearAssetSuggestionDismissalsForTests,
  dismissAssetSuggestion,
  isAssetSuggestionDismissed,
} from "./suggestion-dismiss.ts";

describe("asset suggestion dismiss", () => {
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
    clearAssetSuggestionDismissalsForTests();
    vi.unstubAllGlobals();
  });

  it("suppresses the same context and session after dismiss", () => {
    dismissAssetSuggestion({
      contextId: "artifact-1",
      sessionKey: "agent:main:main",
    });
    expect(
      isAssetSuggestionDismissed({
        contextId: "artifact-1",
        sessionKey: "agent:other:main",
      }),
    ).toBe(true);
    expect(
      isAssetSuggestionDismissed({
        contextId: "other-artifact",
        sessionKey: "agent:main:main",
      }),
    ).toBe(true);
    expect(
      isAssetSuggestionDismissed({
        contextId: "other-artifact",
        sessionKey: "agent:other:main",
      }),
    ).toBe(false);
  });

  it("expires dismissals after the TTL window", () => {
    const now = 1_700_000_000_000;
    dismissAssetSuggestion({
      contextId: "artifact-1",
      sessionKey: "agent:main:main",
      now,
      ttlMs: ASSET_SUGGESTION_DISMISS_TTL_MS,
    });
    expect(
      isAssetSuggestionDismissed({
        contextId: "artifact-1",
        sessionKey: "agent:main:main",
        now: now + ASSET_SUGGESTION_DISMISS_TTL_MS - 1,
      }),
    ).toBe(true);
    expect(
      isAssetSuggestionDismissed({
        contextId: "artifact-1",
        sessionKey: "agent:main:main",
        now: now + ASSET_SUGGESTION_DISMISS_TTL_MS + 1,
      }),
    ).toBe(false);
  });
});
