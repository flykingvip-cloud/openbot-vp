/**
 * Floor P3 C1 — L2 bid empty-body under reasoning-model-like completions.
 * Production Shadow-B stays observational; these tests do not enable protocol=floor.
 */
import { describe, expect, test } from "vitest";
import {
  FLOOR_BID_ANSWER_MAX_TOKENS,
  FLOOR_BID_MAX_TOKENS,
  FLOOR_BID_REASONING_HEADROOM_TOKENS,
  extractFloorBidTextFromContent,
  floorBidCompletionOptions,
} from "./floor-bid-model.js";
import { parseFloorBidModelText } from "./floor-bid.js";

const BID_JSON =
  '{"intent":"answer","novelty":0.7,"confidence":0.8,"gist":"同步进度","estimatedTokens":40,"evidenceRefs":[]}';

describe("floor-bid-model Floor P3 C1 empty-body budget", () => {
  test("reserves answer tokens beyond the historical 160 thinking-only cap", () => {
    expect(FLOOR_BID_ANSWER_MAX_TOKENS).toBe(160);
    expect(FLOOR_BID_REASONING_HEADROOM_TOKENS).toBeGreaterThan(0);
    expect(FLOOR_BID_MAX_TOKENS).toBe(
      FLOOR_BID_ANSWER_MAX_TOKENS + FLOOR_BID_REASONING_HEADROOM_TOKENS,
    );
    // Historical failure: output=160 filled with thinking only. Headroom must
    // leave room for a short JSON body after a full 160-token thinking preamble.
    expect(FLOOR_BID_MAX_TOKENS).toBeGreaterThan(FLOOR_BID_ANSWER_MAX_TOKENS);
    expect(FLOOR_BID_MAX_TOKENS - FLOOR_BID_ANSWER_MAX_TOKENS).toBeGreaterThanOrEqual(160);
  });

  test("floorBidCompletionOptions asks for minimal reasoning and the raised maxTokens", () => {
    const signal = AbortSignal.timeout(2_500);
    const options = floorBidCompletionOptions(signal);
    expect(options.maxTokens).toBe(FLOOR_BID_MAX_TOKENS);
    expect(options.temperature).toBe(0);
    expect(options.reasoning).toBe("minimal");
    expect(options.signal).toBe(signal);
  });

  test("thinking-only content (reasoning-model empty body) extracts no text", () => {
    const text = extractFloorBidTextFromContent([
      { type: "thinking", thinking: "x".repeat(FLOOR_BID_ANSWER_MAX_TOKENS) },
    ]);
    expect(text).toBe("");
    expect(parseFloorBidModelText(text)).toBeNull();
  });

  test("thinking then text yields a parseable bid (reasoning-model-like success path)", () => {
    const text = extractFloorBidTextFromContent([
      { type: "thinking", thinking: "plan the bid briefly" },
      { type: "text", text: BID_JSON },
    ]);
    expect(text).toBe(BID_JSON);
    const parsed = parseFloorBidModelText(text);
    expect(parsed).not.toBeNull();
    expect(parsed?.intent).toBe("answer");
    expect(parsed?.gist).toContain("同步");
  });

  test("truncation under the old 160-token budget cannot leave a parseable body after thinking", () => {
    // Simulate: model spends the entire old budget on thinking; no text block.
    const oldBudgetContent = [
      { type: "thinking", thinking: "t".repeat(FLOOR_BID_ANSWER_MAX_TOKENS) },
    ];
    expect(extractFloorBidTextFromContent(oldBudgetContent)).toBe("");

    // Simulate: raised budget allows thinking (160) + short JSON text.
    const raisedBudgetContent = [
      { type: "thinking", thinking: "t".repeat(FLOOR_BID_ANSWER_MAX_TOKENS) },
      { type: "text", text: BID_JSON },
    ];
    const recovered = extractFloorBidTextFromContent(raisedBudgetContent);
    expect(recovered).toBe(BID_JSON);
    expect(parseFloorBidModelText(recovered)).not.toBeNull();
  });
});
