// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import {
  buildStewardTemplateSuggestion,
  buildWorkbenchStewardSuggestion,
  computeStewardSignalSignature,
  DEFAULT_STEWARD_SUGGESTION_THROTTLE_MS,
  type StewardSuggestionCache,
  type StewardSuggestionCacheEntry,
  type WorkbenchStewardSuggestionSignals,
} from "./steward-suggestion-read-model.js";

type SignalOverrides = {
  ackRequiredCount?: number;
  taskCount?: number;
  governanceCount?: number;
  inviteCount?: number;
  pendingTotal?: number;
  pendingItems?: Array<{ id: string }>;
  conflictCount?: number;
  attentionCount?: number;
  noticesTotal?: number;
  decisionCount?: number;
  reviewCount?: number;
  needsResponseCount?: number;
  activeCount?: number;
  upcomingItems?: Array<{ id: string }>;
};

function signals(over: SignalOverrides = {}): WorkbenchStewardSuggestionSignals {
  return {
    pending: {
      ackRequiredCount: over.ackRequiredCount ?? 0,
      taskCount: over.taskCount ?? 0,
      governanceCount: over.governanceCount ?? 0,
      inviteCount: over.inviteCount ?? 0,
      totalCount: over.pendingTotal ?? 0,
      ...(over.pendingItems ? { items: over.pendingItems } : {}),
    },
    notices: {
      conflictCount: over.conflictCount ?? 0,
      attentionCount: over.attentionCount ?? 0,
      totalCount: over.noticesTotal ?? 0,
    },
    upcoming: {
      decisionCount: over.decisionCount ?? 0,
      reviewCount: over.reviewCount ?? 0,
      needsResponseCount: over.needsResponseCount ?? 0,
      activeCount: over.activeCount ?? 0,
      ...(over.upcomingItems ? { items: over.upcomingItems } : {}),
    },
  };
}

function makeCache(): {
  cache: StewardSuggestionCache;
  store: Map<string, StewardSuggestionCacheEntry>;
} {
  const store = new Map<string, StewardSuggestionCacheEntry>();
  return {
    store,
    cache: {
      get: (key) => store.get(key),
      set: (key, entry) => {
        store.set(key, entry);
      },
    },
  };
}

describe("steward suggestion — deterministic template (§7.4)", () => {
  it("prioritizes ack > decision > review > task > conflict > response > attention", () => {
    expect(
      buildStewardTemplateSuggestion(signals({ ackRequiredCount: 2, decisionCount: 5 })),
    ).toEqual({
      kind: "ack",
      text: "有 2 项待确认任务需要你先处理",
    });
    expect(buildStewardTemplateSuggestion(signals({ decisionCount: 3, reviewCount: 9 }))).toEqual({
      kind: "decision",
      text: "3 个协作群在等你拍板",
    });
    expect(buildStewardTemplateSuggestion(signals({ reviewCount: 1, taskCount: 9 }))).toEqual({
      kind: "review",
      text: "1 个协作群等你复核",
    });
    expect(buildStewardTemplateSuggestion(signals({ taskCount: 4, conflictCount: 9 }))).toEqual({
      kind: "task",
      text: "你有 4 项待处理任务",
    });
    expect(
      buildStewardTemplateSuggestion(signals({ conflictCount: 2, needsResponseCount: 9 })),
    ).toEqual({ kind: "conflict", text: "知识库有 2 处冲突待解决" });
    expect(
      buildStewardTemplateSuggestion(signals({ needsResponseCount: 6, attentionCount: 9 })),
    ).toEqual({ kind: "response", text: "6 个协作群需要你回应" });
    expect(buildStewardTemplateSuggestion(signals({ attentionCount: 7 }))).toEqual({
      kind: "attention",
      text: "7 处知识待关注",
    });
  });

  it("returns null when all signals are zero (bar hides itself)", () => {
    expect(buildStewardTemplateSuggestion(signals())).toBeNull();
  });
});

describe("steward suggestion — signature", () => {
  it("is stable for identical signals and changes when a count changes", () => {
    const a = computeStewardSignalSignature(signals({ taskCount: 2 }));
    const b = computeStewardSignalSignature(signals({ taskCount: 2 }));
    const c = computeStewardSignalSignature(signals({ taskCount: 3 }));
    expect(a).toBe(b);
    expect(a).not.toBe(c);
  });

  it("changes when the lead item id changes even if counts are equal", () => {
    const a = computeStewardSignalSignature(
      signals({ taskCount: 1, pendingItems: [{ id: "task-1" }] }),
    );
    const b = computeStewardSignalSignature(
      signals({ taskCount: 1, pendingItems: [{ id: "task-2" }] }),
    );
    expect(a).not.toBe(b);
  });
});

describe("steward suggestion — dedup + cache", () => {
  it("serves the cached suggestion when signals are unchanged (no LLM)", async () => {
    const { cache } = makeCache();
    const generateSuggestionText = vi.fn(async () => "llm text");
    const params = {
      actorKey: "user-1",
      signals: signals({ taskCount: 2 }),
      deps: { cache, now: () => 1_000, throttleMs: 0, generateSuggestionText },
    };

    const first = await buildWorkbenchStewardSuggestion(params);
    expect(first.fromCache).toBe(false);
    expect(first.llmUsed).toBe(true);
    expect(generateSuggestionText).toHaveBeenCalledTimes(1);

    // Same signals → served from cache, LLM not called again.
    const second = await buildWorkbenchStewardSuggestion(params);
    expect(second.fromCache).toBe(true);
    expect(second.llmUsed).toBe(false);
    expect(second.suggestion).toEqual(first.suggestion);
    expect(generateSuggestionText).toHaveBeenCalledTimes(1);
  });

  it("recomputes when the signature changes", async () => {
    const { cache } = makeCache();
    const first = await buildWorkbenchStewardSuggestion({
      actorKey: "user-1",
      signals: signals({ taskCount: 2 }),
      deps: { cache, now: () => 1_000 },
    });
    expect(first.suggestion?.text).toBe("你有 2 项待处理任务");

    const second = await buildWorkbenchStewardSuggestion({
      actorKey: "user-1",
      signals: signals({ taskCount: 5 }),
      deps: { cache, now: () => 2_000 },
    });
    expect(second.fromCache).toBe(false);
    expect(second.suggestion?.text).toBe("你有 5 项待处理任务");
  });
});

describe("steward suggestion — deterministic only (M4a, no seam)", () => {
  it("produces a template suggestion with source=template and llmUsed=false", async () => {
    const { cache } = makeCache();
    const result = await buildWorkbenchStewardSuggestion({
      actorKey: "user-1",
      signals: signals({ decisionCount: 1 }),
      deps: { cache, now: () => 1_000 },
    });
    expect(result.llmUsed).toBe(false);
    expect(result.suggestion).toMatchObject({
      kind: "decision",
      source: "template",
      text: "1 个协作群在等你拍板",
      generatedAtMs: 1_000,
    });
  });

  it("returns a null suggestion (and caches it) when nothing is worth surfacing", async () => {
    const { cache, store } = makeCache();
    const result = await buildWorkbenchStewardSuggestion({
      actorKey: "user-1",
      signals: signals(),
      deps: { cache, now: () => 1_000 },
    });
    expect(result.suggestion).toBeNull();
    expect(store.get("user-1")?.suggestion).toBeNull();
  });
});

describe("steward suggestion — gated LLM seam (M4b behavior)", () => {
  it("uses the seam text when the signature changed and throttle elapsed", async () => {
    const { cache } = makeCache();
    const generateSuggestionText = vi.fn(async () => "先把 2 项待确认任务清掉");
    const result = await buildWorkbenchStewardSuggestion({
      actorKey: "user-1",
      signals: signals({ ackRequiredCount: 2 }),
      deps: { cache, now: () => 10_000, throttleMs: 0, generateSuggestionText },
    });
    expect(generateSuggestionText).toHaveBeenCalledTimes(1);
    expect(result.llmUsed).toBe(true);
    expect(result.suggestion).toMatchObject({
      kind: "ack",
      source: "llm",
      text: "先把 2 项待确认任务清掉",
    });
  });

  it("does NOT call the seam when there is nothing to say (null template)", async () => {
    const { cache } = makeCache();
    const generateSuggestionText = vi.fn(async () => "should not be called");
    const result = await buildWorkbenchStewardSuggestion({
      actorKey: "user-1",
      signals: signals(),
      deps: { cache, now: () => 10_000, throttleMs: 0, generateSuggestionText },
    });
    expect(generateSuggestionText).not.toHaveBeenCalled();
    expect(result.suggestion).toBeNull();
  });

  it("falls back to the template when the seam returns null (non-enterprise / denied)", async () => {
    const { cache } = makeCache();
    const generateSuggestionText = vi.fn(async () => null);
    const result = await buildWorkbenchStewardSuggestion({
      actorKey: "user-1",
      signals: signals({ taskCount: 3 }),
      deps: { cache, now: () => 10_000, throttleMs: 0, generateSuggestionText },
    });
    expect(generateSuggestionText).toHaveBeenCalledTimes(1);
    expect(result.llmUsed).toBe(false);
    expect(result.suggestion).toMatchObject({ source: "template", text: "你有 3 项待处理任务" });
  });

  it("falls back to the template when the seam throws", async () => {
    const { cache } = makeCache();
    const generateSuggestionText = vi.fn(async () => {
      throw new Error("model unavailable");
    });
    const result = await buildWorkbenchStewardSuggestion({
      actorKey: "user-1",
      signals: signals({ taskCount: 3 }),
      deps: { cache, now: () => 10_000, throttleMs: 0, generateSuggestionText },
    });
    expect(result.llmUsed).toBe(false);
    expect(result.suggestion).toMatchObject({ source: "template", text: "你有 3 项待处理任务" });
  });

  it("throttles the seam: a signature change within the window skips the LLM", async () => {
    const { cache } = makeCache();
    const generateSuggestionText = vi.fn(async () => "llm wording");
    const throttleMs = DEFAULT_STEWARD_SUGGESTION_THROTTLE_MS;

    // t=0: signature change, throttle elapsed (never run) → seam called.
    const first = await buildWorkbenchStewardSuggestion({
      actorKey: "user-1",
      signals: signals({ taskCount: 1 }),
      deps: { cache, now: () => 0, throttleMs, generateSuggestionText },
    });
    expect(first.llmUsed).toBe(true);
    expect(generateSuggestionText).toHaveBeenCalledTimes(1);

    // t=1min: signature changed again but throttle window not elapsed → template.
    const second = await buildWorkbenchStewardSuggestion({
      actorKey: "user-1",
      signals: signals({ taskCount: 2 }),
      deps: { cache, now: () => 60_000, throttleMs, generateSuggestionText },
    });
    expect(generateSuggestionText).toHaveBeenCalledTimes(1);
    expect(second.llmUsed).toBe(false);
    expect(second.suggestion).toMatchObject({ source: "template", text: "你有 2 项待处理任务" });

    // t=11min: throttle elapsed again → seam called once more.
    const third = await buildWorkbenchStewardSuggestion({
      actorKey: "user-1",
      signals: signals({ taskCount: 3 }),
      deps: { cache, now: () => throttleMs + 60_000, throttleMs, generateSuggestionText },
    });
    expect(generateSuggestionText).toHaveBeenCalledTimes(2);
    expect(third.llmUsed).toBe(true);
  });
});
