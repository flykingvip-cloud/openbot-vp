import { describe, expect, it, vi } from "vitest";
import { GatewayRequestError } from "../../gateway.ts";
import {
  fetchSeatAiRules,
  saveSeatAiRules,
  seatAiRulesUiMaxLength,
  SEAT_AI_RULES_UI_MAXLENGTH_SLACK,
} from "./seat-ai-rules-api.ts";

describe("seat-ai-rules-api", () => {
  it("returns null when get fails", async () => {
    const client = {
      request: vi.fn().mockRejectedValue(new Error("no seat")),
    };
    await expect(fetchSeatAiRules(client as never)).resolves.toBeNull();
  });

  it("maps gateway rejections into SeatAiRulesSaveError", async () => {
    const client = {
      request: vi.fn().mockRejectedValue(
        new GatewayRequestError({
          code: "INVALID_REQUEST",
          message: "seat_rule_max_chars_500",
          details: { rejections: [{ reason: "seat_rule_max_chars_500" }] },
        }),
      ),
    };
    await expect(saveSeatAiRules(client as never, [{ text: "x".repeat(501) }])).rejects.toEqual(
      expect.objectContaining({
        name: "SeatAiRulesSaveError",
        rejections: [{ reason: "seat_rule_max_chars_500" }],
      }),
    );
    expect(client.request).toHaveBeenCalledWith("seat-rules.set", {
      rules: [{ text: "x".repeat(501) }],
    });
  });

  it("returns saved payload on success", async () => {
    const payload = {
      tenantId: "t",
      seatId: "s",
      rules: [{ id: "1", text: "be brief" }],
      updatedAt: "2026-10-08T00:00:00.000Z",
      limits: { maxChars: 500, maxTotalChars: 2000, maxCount: 8 },
    };
    const client = { request: vi.fn().mockResolvedValue(payload) };
    await expect(saveSeatAiRules(client as never, [{ text: "be brief" }])).resolves.toEqual(
      payload,
    );
  });
});

describe("seatAiRulesUiMaxLength", () => {
  it("is slightly looser than server maxChars and does not change server constants", () => {
    expect(SEAT_AI_RULES_UI_MAXLENGTH_SLACK).toBe(200);
    expect(seatAiRulesUiMaxLength(500)).toBe(700);
    // server limits stay 500/2000/8 — UI slack only
    expect(seatAiRulesUiMaxLength(500)).toBeGreaterThan(500);
  });
});
