import { describe, expect, it } from "vitest";
import { toAIFriendlyError } from "./pw-tools-core.shared.js";

describe("toAIFriendlyError", () => {
  it("reports a covered target before the visibility timeout branch", () => {
    const error = new Error(
      "Timeout 8000ms exceeded.\n" +
        "Call log:\n" +
        "- waiting for locator('aria-ref=e165') to be visible\n" +
        "- element is not receiving pointer events\n" +
        '- <div class="modal"> intercepts pointer events',
    );
    expect(toAIFriendlyError(error, "e165").message).toBe(
      'Element "e165" is covered by an overlay — snapshot again and close it.',
    );
  });

  it("keeps a plain visibility timeout as not found", () => {
    const error = new Error("Timeout 8000ms exceeded. waiting for locator to be visible");
    expect(toAIFriendlyError(error, "e126").message).toContain("not found or not visible");
  });
});
