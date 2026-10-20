import { describe, expect, it } from "vitest";
import { scheduleItem7W4StewardHelperShadow } from "./item7-w4-shadow.js";

describe("item7 W4 steward helper shadow", () => {
  it("schedules without throwing when env is off", () => {
    expect(() =>
      scheduleItem7W4StewardHelperShadow({
        ledgerId: "S24",
        catalogResourceId: null,
      }),
    ).not.toThrow();
  });
});
