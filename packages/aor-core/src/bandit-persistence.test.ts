import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  PersistentBanditFeedbackStore,
  readBanditPersistedState,
  writeBanditPersistedState,
} from "./bandit-persistence.js";
import { BanditFeedbackStore } from "./bandit.js";

describe("PersistentBanditFeedbackStore", () => {
  it("persists arms across store instances", () => {
    const dir = mkdtempSync(join(tmpdir(), "aor-bandit-"));
    const path = join(dir, "bandit.json");
    try {
      const first = new PersistentBanditFeedbackStore(path);
      const model = { provider: "openai", id: "gpt-5.4-mini" };
      first.record(model, "summarization", {
        taskType: "summarization",
        score: 1,
        signals: {},
      });

      const second = new PersistentBanditFeedbackStore(path);
      expect(second.quality(model, "summarization")).toBeGreaterThan(0.5);
      expect(second.learningSnapshot()).toHaveLength(1);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("round-trips export/import on BanditFeedbackStore", () => {
    const store = new BanditFeedbackStore({ rng: () => 0.5 });
    const model = { provider: "anthropic", id: "claude-opus-4-6" };
    store.record(model, "coding.review", {
      taskType: "coding.review",
      score: 0.8,
      signals: {},
    });
    const state = store.exportPersistedState();
    const restored = new BanditFeedbackStore();
    restored.importPersistedState(state);
    expect(restored.quality(model, "coding.review")).toBeCloseTo(
      store.quality(model, "coding.review") ?? 0,
    );
  });

  it("writeBanditPersistedState creates parent dirs", () => {
    const dir = mkdtempSync(join(tmpdir(), "aor-bandit-"));
    const path = join(dir, "nested", "bandit.json");
    try {
      const store = new BanditFeedbackStore();
      writeBanditPersistedState(path, store.exportPersistedState());
      expect(readBanditPersistedState(path)?.version).toBe(1);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
