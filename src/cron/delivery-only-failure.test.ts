import { describe, expect, it } from "vitest";
import { isCronDeliveryOnlyFailure, isCronDeliveryToolError } from "./delivery-only-failure.js";

describe("isCronDeliveryOnlyFailure", () => {
  it("detects delivery errors with agent summary", () => {
    expect(
      isCronDeliveryOnlyFailure({
        status: "error",
        error: "⚠️ ✉️ Message failed",
        summary: "A".repeat(50),
      }),
    ).toBe(true);
  });

  it("detects canvas and nodes delivery tool errors", () => {
    expect(isCronDeliveryToolError("⚠️ 🖼️ Canvas failed")).toBe(true);
    expect(isCronDeliveryToolError("⚠️ 📱 Nodes failed")).toBe(true);
    expect(
      isCronDeliveryOnlyFailure({
        status: "error",
        error: "⚠️ 🖼️ Canvas failed",
        summary: "A".repeat(50),
      }),
    ).toBe(true);
  });

  it("rejects true execution failures without summary", () => {
    expect(
      isCronDeliveryOnlyFailure({
        status: "error",
        error: "LLM request timed out",
        summary: "short",
      }),
    ).toBe(false);
  });
});
