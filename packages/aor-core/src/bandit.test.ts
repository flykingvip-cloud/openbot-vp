import { describe, expect, it } from "vitest";
import { BanditFeedbackStore } from "./bandit.js";

describe("BanditFeedbackStore", () => {
  it("updates arm stats from evaluator scores", () => {
    let n = 0;
    const store = new BanditFeedbackStore({
      rng: () => {
        n += 1;
        return 0.5;
      },
    });
    const model = { provider: "openai", id: "gpt-5.4-mini" };
    store.record(model, "summarization", {
      taskType: "summarization",
      score: 1,
      signals: {},
    });
    const stats = store.armStats(model, "summarization");
    expect(stats?.trials).toBe(1);
    expect(store.quality(model, "summarization")).toBeGreaterThan(0.5);
  });

  it("apply() injects sampled scores into profiles", () => {
    const store = new BanditFeedbackStore({ rng: () => 0.9 });
    const profiles = store.apply([
      {
        ref: { provider: "openai", id: "gpt-5.4-mini" },
        cost: { inputPerMtok: 1, outputPerMtok: 1 },
        taskTypeScores: { summarization: 0.5 },
      },
    ]);
    expect(profiles[0]?.taskTypeScores.summarization).toBeGreaterThan(0);
  });
});
