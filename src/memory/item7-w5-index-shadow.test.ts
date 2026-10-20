import { describe, expect, it } from "vitest";
import { scheduleItem7W5IndexShadow } from "./item7-w5-index-shadow.js";

describe("item7 W5 index shadow", () => {
  it("schedules without throwing when env is off", () => {
    expect(() =>
      scheduleItem7W5IndexShadow({
        ledgerId: "S36",
        handleResourceId: null,
      }),
    ).not.toThrow();
  });
});
