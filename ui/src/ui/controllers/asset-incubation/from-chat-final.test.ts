import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ensureAssetSuggestionPatternRuntime } from "../asset-suggestion-trigger.ts";
import { decideIncubationFromChatFinal } from "./from-chat-final.ts";
import { clearSessionIncubationEventsForTests } from "./session-event-store.ts";

const weeklyPayload = {
  state: "final" as const,
  message: {
    role: "assistant" as const,
    artifactId: "artifact-1",
    text: "任务完成总结\n\n# 周报\n1. 进展",
  },
};

describe("decideIncubationFromChatFinal", () => {
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
    clearSessionIncubationEventsForTests();
    vi.unstubAllGlobals();
  });

  it("returns L2 for a single artifact completion", () => {
    const decision = decideIncubationFromChatFinal({
      runId: "run-1",
      sessionKey: "agent:main:main",
      ...weeklyPayload,
    });
    expect(decision.level).toBe("L2");
    expect(decision.evidence.recurrenceCount).toBe(1);
  });

  it("returns L3 after three ingests for the same scope", () => {
    const owner = {};
    const runtime = ensureAssetSuggestionPatternRuntime(owner, null, false);
    const payload = {
      runId: "run-1",
      sessionKey: "agent:main:main",
      ...weeklyPayload,
    };
    decideIncubationFromChatFinal({ ...payload, runId: "run-1" }, runtime);
    decideIncubationFromChatFinal({ ...payload, runId: "run-2" }, runtime);
    const third = decideIncubationFromChatFinal({ ...payload, runId: "run-3" }, runtime);
    expect(third.level).toBe("L3");
    expect(third.evidence.recurrenceCount).toBe(3);
  });

  it("returns L3 on the third cross-session completion with the same fingerprint", () => {
    const owner = {};
    const runtime = ensureAssetSuggestionPatternRuntime(owner, null, false);
    const sessions = ["agent:a:main", "agent:b:main", "agent:c:main"];

    decideIncubationFromChatFinal(
      { runId: "run-a", sessionKey: sessions[0], ...weeklyPayload },
      runtime,
    );
    const second = decideIncubationFromChatFinal(
      { runId: "run-b", sessionKey: sessions[1], ...weeklyPayload },
      runtime,
    );
    expect(second.level).toBe("L2");
    expect(second.evidence.recurrenceCount).toBe(2);

    const third = decideIncubationFromChatFinal(
      { runId: "run-c", sessionKey: sessions[2], ...weeklyPayload },
      runtime,
    );
    expect(third.level).toBe("L3");
    expect(third.evidence.recurrenceCount).toBe(3);
    expect(third.signalTrace.some((entry) => entry.kind.includes("recurrence"))).toBe(true);
  });
});
