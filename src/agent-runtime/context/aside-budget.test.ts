import { describe, expect, it } from "vitest";
import { selectAsideTurnsWithinCharBudget, type AsideDialogueTurn } from "./aside-budget.js";

const turn = (text: string, id: string): AsideDialogueTurn => ({
  atMs: 1,
  runId: id,
  role: "user",
  text,
  messageId: id,
});

describe("aside body budget compatibility", () => {
  it("keeps default and UTF-16 selection semantics", () => {
    const turns = [turn("😀".repeat(80), "emoji")];
    expect(selectAsideTurnsWithinCharBudget(turns)).toEqual(turns);
    expect(selectAsideTurnsWithinCharBudget(turns, -1)).toEqual(
      selectAsideTurnsWithinCharBudget(turns, 64),
    );
    expect(selectAsideTurnsWithinCharBudget(turns, 64)[0].text).toBe(
      `${turns[0].text.slice(0, 57)}…`,
    );
  });
  it("keeps a contiguous newest suffix in chronological order", () => {
    const turns = [turn("a".repeat(40), "a"), turn("b".repeat(20), "b"), turn("c", "c")];
    expect(selectAsideTurnsWithinCharBudget(turns, 64)).toEqual(turns.slice(1));
    expect(turns[0].text).toHaveLength(40);
  });
  it("truncates the newest oversized turn and retains its identity", () => {
    const source = turn("x".repeat(100), "latest");
    const selected = selectAsideTurnsWithinCharBudget([source], 64);
    expect(selected[0]).toEqual({ ...source, text: `${"x".repeat(57)}…` });
    expect(source.text).toHaveLength(100);
  });
  it("preserves the existing minimum budget, labels and separator accounting", () => {
    expect(selectAsideTurnsWithinCharBudget([], 0)).toEqual([]);
    const turns = [turn("a".repeat(25), "a"), turn("b".repeat(26), "b")];
    expect(selectAsideTurnsWithinCharBudget(turns, 1)).toEqual(turns);
    expect(selectAsideTurnsWithinCharBudget([turn("x".repeat(60), "x")], 64)[0].text).toHaveLength(
      58,
    );
  });
});
