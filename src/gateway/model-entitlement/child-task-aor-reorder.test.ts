// @vitest-environment node
import type { ModelProfile } from "@openbot/aor-core";
import { describe, expect, it } from "vitest";
import { reorderAuthorizedModelsForChildTask } from "./child-task-aor-reorder.js";

const CHEAP: ModelProfile = {
  ref: { provider: "api-proxy-deepseek", id: "cheap" },
  cost: { inputPerMtok: 0.1, outputPerMtok: 0.2 },
  taskTypeScores: { tool_use: 0.75 },
};
const PREMIUM: ModelProfile = {
  ref: { provider: "api-proxy-deepseek", id: "premium" },
  cost: { inputPerMtok: 10, outputPerMtok: 20 },
  taskTypeScores: { coding: 0.8, reasoning: 0.85 },
};

describe("reorderAuthorizedModelsForChildTask (parent summary → child refactor)", () => {
  it("reorders inside parent allowlist for child coding.refactor; does not expand rights", () => {
    const parentOrder = ["api-proxy-deepseek/cheap", "api-proxy-deepseek/premium"];
    const child = reorderAuthorizedModelsForChildTask({
      taskText: "帮我重构这段支付回调",
      authorizedModelIds: parentOrder,
      parentPreferredModelOrder: parentOrder, // parent summarization put cheap first
      mode: "aor_enhanced",
      selectorStrategy: "best_quality",
      catalog: [CHEAP, PREMIUM],
    });
    expect(child.categoryId).toBe("coding.refactor");
    expect(child.classificationSource).toBe("task_text");
    // Discriminative: child refactor prefers premium; parent order had cheap first.
    expect(child.preferredModelOrder[0]).toBe("api-proxy-deepseek/premium");
    expect(child.preferredModelOrder[0]).not.toBe(parentOrder[0]);
    expect(child.preferredModelOrder.toSorted()).toEqual(parentOrder.toSorted());
    expect(child.allowlist.every((id) => parentOrder.includes(id))).toBe(true);
    expect(child.capabilityPlan.authorizedModelIds).toEqual(parentOrder);
    // No entitlement expansion.
    expect(child.allowlist.length).toBeLessThanOrEqual(parentOrder.length);
  });

  it("never introduces models outside the parent authorized set", () => {
    const child = reorderAuthorizedModelsForChildTask({
      taskText: "帮我重构这段支付回调",
      authorizedModelIds: ["api-proxy-deepseek/cheap"],
      parentPreferredModelOrder: [
        "api-proxy-deepseek/cheap",
        "api-proxy-deepseek/premium", // parent order noise outside allowlist
      ],
      mode: "aor_enhanced",
      selectorStrategy: "best_quality",
      catalog: [CHEAP, PREMIUM],
    });
    expect(child.preferredModelOrder).toEqual(["api-proxy-deepseek/cheap"]);
    expect(child.allowlist).toEqual(["api-proxy-deepseek/cheap"]);
    expect(child.preferredModelOrder).not.toContain("api-proxy-deepseek/premium");
  });

  it("native mode keeps authorized set order without AOR re-score", () => {
    const child = reorderAuthorizedModelsForChildTask({
      taskText: "帮我重构这段支付回调",
      authorizedModelIds: ["api-proxy-deepseek/cheap", "api-proxy-deepseek/premium"],
      mode: "native",
      catalog: [CHEAP, PREMIUM],
    });
    expect(child.preferredModelOrder[0]).toBe("api-proxy-deepseek/cheap");
    expect(child.categoryId).toBe("coding.refactor");
  });
});
