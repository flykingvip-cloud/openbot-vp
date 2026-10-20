// @vitest-environment node
// Feature: model-entitlement-chain, P3 任务 13（AOR 保集合重排）
import * as fc from "fast-check";
import { describe, expect, it } from "vitest";
import { applyPreferredModelOrder } from "./model-fallback.js";
import type { ModelCandidate } from "./model-fallback.types.js";

function cand(provider: string, model: string): ModelCandidate {
  return { provider, model };
}

const setOf = (cands: readonly ModelCandidate[]): string[] =>
  [...new Set(cands.map((c) => `${c.provider}/${c.model}`))].toSorted();

describe("applyPreferredModelOrder", () => {
  it("命中顺序者前置，未命中者保持相对次序", () => {
    const candidates = [
      cand("anthropic", "claude-opus-4-6"),
      cand("openai", "gpt-5.4"),
      cand("openai", "gpt-5.4-mini"),
    ];
    const reordered = applyPreferredModelOrder(candidates, [
      "openai/gpt-5.4-mini",
      "anthropic/claude-opus-4-6",
    ]);
    expect(reordered.map((c) => `${c.provider}/${c.model}`)).toEqual([
      "openai/gpt-5.4-mini",
      "anthropic/claude-opus-4-6",
      "openai/gpt-5.4",
    ]);
  });

  it("不在偏好顺序中的候选不被剔除（集合恒等）", () => {
    const candidates = [cand("a", "x"), cand("b", "y"), cand("c", "z")];
    const reordered = applyPreferredModelOrder(candidates, ["c/z"]);
    expect(reordered[0]).toEqual(cand("c", "z"));
    expect(setOf(reordered)).toEqual(setOf(candidates));
  });

  it("Property：重排恒为保集合（不增删候选）", () => {
    const arbCand = fc
      .tuple(fc.constantFrom("a", "b", "c"), fc.constantFrom("x", "y", "z"))
      .map(([p, m]) => cand(p, m));
    fc.assert(
      fc.property(
        fc.uniqueArray(arbCand, { selector: (c) => `${c.provider}/${c.model}` }),
        fc.array(fc.constantFrom("a/x", "b/y", "c/z", "a/y", "unknown/model")),
        (candidates, preferred) => {
          const reordered = applyPreferredModelOrder(candidates, preferred);
          expect(reordered).toHaveLength(candidates.length);
          expect(setOf(reordered)).toEqual(setOf(candidates));
        },
      ),
      { numRuns: 150 },
    );
  });
});
