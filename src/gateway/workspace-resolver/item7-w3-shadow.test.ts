import { describe, expect, it } from "vitest";
import { scheduleItem7W3CatalogSynthesisShadow } from "./item7-w3-shadow.js";

describe("item7 W3 catalog synthesis shadow", () => {
  it("schedules without throwing when env is off", () => {
    expect(() =>
      scheduleItem7W3CatalogSynthesisShadow({
        ledgerId: "S17",
        existingResourceId: null,
      }),
    ).not.toThrow();
  });
});
