import { describe, expect, it } from "vitest";
import { resolveLaneBudget } from "./lane-budget.js";

describe("resolveLaneBudget", () => {
  it("keeps the lane floor when the context window is small or omitted", () => {
    expect(resolveLaneBudget("act").targetTokens).toBe(16_000);
    expect(resolveLaneBudget("act").admissionBudgetTokens).toBe(12_800);
    expect(resolveLaneBudget("chat", 8_000).targetTokens).toBe(6_000);
    expect(resolveLaneBudget("act", 8_000).targetTokens).toBe(16_000);
    expect(resolveLaneBudget("retrieve", 4_000).targetTokens).toBe(10_000);
  });

  it("scales from the context window and caps act at 48k", () => {
    const act = resolveLaneBudget("act", 128_000);
    expect(act.targetTokens).toBe(32_000);
    expect(act.admissionBudgetTokens).toBe(25_600);

    const capped = resolveLaneBudget("act", 1_000_000);
    expect(capped.targetTokens).toBe(48_000);
    expect(capped.admissionBudgetTokens).toBe(38_400);

    const chat = resolveLaneBudget("chat", 128_000);
    expect(chat.targetTokens).toBe(12_000);
    expect(chat.admissionBudgetTokens).toBe(9_600);
    expect(chat.targetTokens).toBeLessThan(act.targetTokens);

    const retrieve = resolveLaneBudget("retrieve", 128_000);
    expect(retrieve.targetTokens).toBe(20_000);
    expect(retrieve.admissionBudgetTokens).toBe(16_000);
  });
});
